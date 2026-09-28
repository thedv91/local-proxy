import type { Database } from "bun:sqlite";
import type { Server } from "bun";
import { createPortless, type PortlessConfig } from "./portless/portless";
import { handleProxyRequest } from "./proxy/handle-request";
import {
  handleWebSocketUpgrade,
  isWebSocketUpgrade,
  type WebSocketBridge,
  webSocketBridgeHandlers,
} from "./proxy/websocket";
import { checkDomain } from "./records/domain";
import { type ProxyRecord, type RecordInput, recordInputSchema } from "./records/schema";
import { RecordStore } from "./records/store";
import { RequestLog } from "./request-log";

export interface LocalProxyConfig {
  db: Database;
  adminPort: number;
  portless: PortlessConfig;
}

/** portless name of the admin UI: https://local-proxy.localhost */
export const ADMIN_ALIAS = "local-proxy";

export class ValidationError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

export interface RecordView extends ProxyRecord {
  listening: boolean;
  /** Why the listener or the alias could not start. */
  error: string | null;
}

interface RunningRecord {
  server: Server<WebSocketBridge>;
  /** Null when the alias could not be registered. */
  alias: string | null;
}

export function createLocalProxy(config: LocalProxyConfig) {
  const store = new RecordStore(config.db);
  const portless = createPortless(config.portless);
  const requestLog = new RequestLog(config.db);
  const running = new Map<string, RunningRecord>();
  const errors = new Map<string, string>();

  async function startAll(): Promise<void> {
    await registerAlias(ADMIN_ALIAS, config.adminPort).catch((error) =>
      console.error(`local-proxy: admin alias not registered: ${errorMessage(error)}`),
    );
    for (const record of store.list()) {
      if (record.enabled) {
        await startRecord(record);
      }
    }
    await removeLeftoverAliases();
  }

  async function addRecord(body: unknown): Promise<ProxyRecord> {
    const input = await validateInput(body, null);
    const record = store.add(input);
    if (record.enabled) {
      await startRecord(record);
    }
    return store.get(record.id);
  }

  async function updateRecord(id: string, body: unknown): Promise<ProxyRecord> {
    const previous = store.get(id);
    const input = await validateInput(body, id);
    await stopRecord(previous);
    const record = store.update(id, input);
    if (record.enabled) {
      await startRecord(record);
    }
    return store.get(id);
  }

  async function removeRecord(id: string): Promise<void> {
    await stopRecord(store.get(id));
    store.remove(id);
  }

  /** Stop every listener and remove every alias this tool registered. */
  async function shutdown(): Promise<void> {
    for (const record of store.list()) {
      await stopRecord(record);
    }
    await unregisterAlias(ADMIN_ALIAS);
  }

  function listRecords(): RecordView[] {
    return store.list().map((record) => ({
      ...record,
      listening: running.has(record.id),
      error: errors.get(record.id) ?? null,
    }));
  }

  async function startRecord(record: ProxyRecord): Promise<void> {
    errors.delete(record.id);
    const server = listen(record);
    running.set(record.id, { server, alias: null });
    const port = server.port as number;
    if (port !== record.port) {
      store.setPort(record.id, port);
    }

    try {
      const domain = checkDomain(record.domain, await portless.servedTlds());
      if (!domain.ok) {
        throw new Error(domain.error);
      }
      await registerAlias(domain.name, port);
      running.set(record.id, { server, alias: domain.name });
    } catch (error) {
      errors.set(record.id, errorMessage(error));
      console.error(`local-proxy: ${record.domain}: ${errorMessage(error)}`);
    }
  }

  async function stopRecord(record: ProxyRecord): Promise<void> {
    const current = running.get(record.id);
    if (!current) {
      return;
    }
    running.delete(record.id);
    errors.delete(record.id);
    await current.server.stop(true);
    if (current.alias) {
      await unregisterAlias(current.alias);
    }
  }

  /** One Bun.serve per record on 127.0.0.1; portless routes the record's domain to it. */
  function listen(record: ProxyRecord): Server<WebSocketBridge> {
    const serve = (port: number) =>
      Bun.serve({
        hostname: "127.0.0.1",
        port,
        // Bun closes a connection after 10 idle seconds by default, which would
        // cut requests shorter than the record's timeout. The upstream fetch
        // enforces the timeout instead.
        idleTimeout: 0,
        fetch: (request, server) => proxyAndLog(record, request, server),
        websocket: webSocketBridgeHandlers,
      });

    if (record.port === null) {
      return serve(0);
    }
    try {
      return serve(record.port);
    } catch (error) {
      if ((error as { code?: string }).code !== "EADDRINUSE") {
        throw error;
      }
      return serve(0);
    }
  }

  async function proxyAndLog(
    record: ProxyRecord,
    request: Request,
    server: Server<WebSocketBridge>,
  ): Promise<Response | undefined> {
    const started = performance.now();
    const isWebSocket = isWebSocketUpgrade(request);
    // An accepted WebSocket upgrade has no Response; Bun answers 101 itself.
    const response = isWebSocket
      ? await handleWebSocketUpgrade(record, request, server)
      : await handleProxyRequest(record, request);
    const url = new URL(request.url);
    requestLog.add({
      time: new Date().toISOString(),
      recordId: record.id,
      domain: record.domain,
      method: isWebSocket ? "WS" : request.method,
      path: url.pathname + url.search,
      status: response?.status ?? 101,
      latencyMs: Math.round(performance.now() - started),
    });
    return response;
  }

  /**
   * Claim the name before calling portless, so a crash between the two still
   * leaves the name recorded as ours and the next start may take it back.
   */
  async function registerAlias(name: string, port: number): Promise<void> {
    await portless.assertAliasAvailable(name, store.ownedAliases());
    store.claimAlias(name);
    try {
      await portless.addAlias(name, port);
    } catch (error) {
      store.releaseAlias(name);
      throw error;
    }
  }

  async function unregisterAlias(name: string): Promise<void> {
    try {
      await portless.removeAlias(name);
      store.releaseAlias(name);
    } catch (error) {
      console.error(`local-proxy: could not remove alias ${name}: ${errorMessage(error)}`);
    }
  }

  /** Aliases we still own from a previous run that ended without cleanup. */
  async function removeLeftoverAliases(): Promise<void> {
    const inUse = new Set([ADMIN_ALIAS, ...[...running.values()].map((entry) => entry.alias)]);
    for (const name of store.ownedAliases()) {
      if (!inUse.has(name)) {
        await unregisterAlias(name);
      }
    }
  }

  async function validateInput(body: unknown, recordId: string | null): Promise<RecordInput> {
    const parsed = recordInputSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ValidationError(issue?.path.join(".") ?? "", issue?.message ?? "Invalid record");
    }

    const tlds = await portless.servedTlds();
    const domain = checkDomain(parsed.data.domain, tlds);
    if (!domain.ok) {
      throw new ValidationError("domain", domain.error);
    }
    if (domain.name === ADMIN_ALIAS) {
      throw new ValidationError("domain", `"${ADMIN_ALIAS}" is used by the admin UI`);
    }
    // portless registers a name under every served TLD, so api.localhost and
    // api.test would both claim the name "api".
    const sameName = store.list().find((record) => {
      const other = checkDomain(record.domain, tlds);
      return record.id !== recordId && other.ok && other.name === domain.name;
    });
    if (sameName) {
      throw new ValidationError(
        "domain",
        `The name "${domain.name}" is already used by ${sameName.domain}; portless registers a name under every TLD it serves`,
      );
    }
    return parsed.data;
  }

  return {
    startAll,
    addRecord,
    updateRecord,
    removeRecord,
    shutdown,
    listRecords,
    requestLog,
    portlessStatus: portless.status,
  };
}

export type LocalProxy = ReturnType<typeof createLocalProxy>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
