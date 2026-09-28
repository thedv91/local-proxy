import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Server } from "bun";
import { createPortlessState, installFakePortless } from "../test/fake-portless";
import { openDatabase } from "./database";
import { createLocalProxy, type LocalProxy } from "./local-proxy";
import { DEFAULT_OPTIONS, type RecordOptions } from "./records/schema";

const LOCAL_ORIGIN = "http://localhost:5100";
const GZIP_TEXT = "hello from upstream ".repeat(20);

interface FakeUpstream {
  server: Server<undefined>;
  url: string;
  requests: Request[];
}

/** Echoes each request as JSON, plus a few special paths. */
function startUpstream(name: string): FakeUpstream {
  const requests: Request[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      requests.push(request);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/gzip")) {
        return new Response(gzipSync(GZIP_TEXT), {
          headers: { "content-encoding": "gzip", "content-type": "text/plain" },
        });
      }
      if (url.pathname.endsWith("/slow")) {
        await Bun.sleep(1500);
        return new Response("late");
      }
      return Response.json(
        {
          upstream: name,
          method: request.method,
          path: url.pathname,
          search: url.search,
          headers: Object.fromEntries(request.headers),
        },
        {
          headers: {
            "access-control-allow-origin": "https://staging.example.com",
            "access-control-allow-methods": "GET",
          },
        },
      );
    },
  });
  return { server, url: `http://127.0.0.1:${server.port}`, requests };
}

let portlessBin: string;
let portlessState: Awaited<ReturnType<typeof createPortlessState>>;
let localProxy: LocalProxy;
let upstreamA: FakeUpstream;
let upstreamB: FakeUpstream;

beforeAll(async () => {
  portlessBin = await installFakePortless();
});

beforeEach(async () => {
  portlessState = await createPortlessState();
  localProxy = createLocalProxy({
    db: openDatabase(join(portlessState.stateDir, "local-proxy.db")),
    adminPort: 7777,
    portless: { bin: portlessBin, stateDir: portlessState.stateDir },
  });
  upstreamA = startUpstream("a");
  upstreamB = startUpstream("b");
});

afterEach(async () => {
  await localProxy.shutdown();
  await upstreamA.server.stop(true);
  await upstreamB.server.stop(true);
  await rm(portlessState.stateDir, { recursive: true, force: true });
});

async function addRecord(source: string, domain: string, options: Partial<RecordOptions> = {}) {
  const record = await localProxy.addRecord({
    source,
    domain,
    enabled: true,
    options: { ...DEFAULT_OPTIONS, ...options },
  });
  return { record, url: `http://127.0.0.1:${record.port}` };
}

async function echo(response: Response) {
  return (await response.json()) as {
    upstream: string;
    path: string;
    search: string;
    headers: Record<string, string>;
  };
}

describe("forwarding", () => {
  test("forwards path and query under the source base path", async () => {
    const { url } = await addRecord(`${upstreamA.url}/v1/`, "api.localhost");
    const body = await echo(await fetch(`${url}/cars/7?color=red&page=2`));
    expect(body.path).toBe("/v1/cars/7");
    expect(body.search).toBe("?color=red&page=2");
  });

  test("upstream sees its own Host, not the local domain", async () => {
    const { url } = await addRecord(upstreamA.url, "api.localhost");
    const body = await echo(await fetch(url, { headers: { host: "api.localhost" } }));
    expect(body.headers.host).toBe(new URL(upstreamA.url).host);
  });

  test("drops Origin and Referer when the option is on, keeps them when off", async () => {
    const dropping = await addRecord(upstreamA.url, "api.localhost");
    const keeping = await addRecord(upstreamB.url, "cars.localhost", { dropOriginReferer: false });
    const headers = { origin: LOCAL_ORIGIN, referer: `${LOCAL_ORIGIN}/page` };

    const dropped = await echo(await fetch(dropping.url, { headers }));
    expect(dropped.headers.origin).toBeUndefined();
    expect(dropped.headers.referer).toBeUndefined();

    const kept = await echo(await fetch(keeping.url, { headers }));
    expect(kept.headers.origin).toBe(LOCAL_ORIGIN);
    expect(kept.headers.referer).toBe(`${LOCAL_ORIGIN}/page`);
  });

  test("sends extra headers to upstream", async () => {
    const { url } = await addRecord(upstreamA.url, "api.localhost", {
      extraHeaders: [{ name: "X-Api-Key", value: "secret" }],
    });
    const body = await echo(await fetch(url, { headers: { authorization: "Bearer t" } }));
    expect(body.headers["x-api-key"]).toBe("secret");
    expect(body.headers.authorization).toBe("Bearer t");
  });

  test("a gzip response reaches the client still compressed", async () => {
    const { url } = await addRecord(upstreamA.url, "api.localhost");
    const response = await fetch(`${url}/gzip`, { decompress: false });
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(bytes.length).toBeLessThan(GZIP_TEXT.length);
    expect(gunzipSync(bytes).toString()).toBe(GZIP_TEXT);
  });

  test("two records proxy to two upstreams at the same time", async () => {
    const a = await addRecord(upstreamA.url, "api.localhost");
    const b = await addRecord(upstreamB.url, "cars.localhost");
    const [fromA, fromB] = await Promise.all([fetch(a.url).then(echo), fetch(b.url).then(echo)]);
    expect(fromA.upstream).toBe("a");
    expect(fromB.upstream).toBe("b");
    expect(a.record.port).not.toBe(b.record.port);
  });
});

describe("CORS", () => {
  test("reflect mode answers a preflight without calling upstream", async () => {
    const { url } = await addRecord(upstreamA.url, "api.localhost");
    const response = await fetch(`${url}/cars`, {
      method: "OPTIONS",
      headers: {
        origin: LOCAL_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(LOCAL_ORIGIN);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type");
    expect(upstreamA.requests).toHaveLength(0);
  });

  test("reflect mode replaces the upstream's CORS headers", async () => {
    const { url } = await addRecord(upstreamA.url, "api.localhost");
    const response = await fetch(url, { headers: { origin: LOCAL_ORIGIN } });
    expect(response.headers.get("access-control-allow-origin")).toBe(LOCAL_ORIGIN);
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
    expect(response.headers.get("vary")).toContain("Origin");
  });

  test("pass-through leaves CORS to upstream", async () => {
    const { url } = await addRecord(upstreamA.url, "api.localhost", {
      cors: "pass-through",
      dropOriginReferer: false,
    });
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: { origin: LOCAL_ORIGIN, "access-control-request-method": "POST" },
    });
    expect(upstreamA.requests).toHaveLength(1);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://staging.example.com",
    );
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET");
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("upstream failures", () => {
  test("a down upstream gives 502 with CORS headers", async () => {
    const down = Bun.serve({ port: 0, fetch: () => new Response() });
    const downUrl = `http://127.0.0.1:${down.port}`;
    await down.stop(true);

    const { url } = await addRecord(downUrl, "api.localhost");
    const response = await fetch(url, { headers: { origin: LOCAL_ORIGIN } });
    expect(response.status).toBe(502);
    expect(response.headers.get("access-control-allow-origin")).toBe(LOCAL_ORIGIN);
    expect(await response.text()).toContain("local-proxy: api.localhost could not reach");
  });

  test("a slow upstream gives 504 after the record's timeout", async () => {
    const { url } = await addRecord(upstreamA.url, "api.localhost", { timeoutSeconds: 1 });
    const response = await fetch(`${url}/slow`, { headers: { origin: LOCAL_ORIGIN } });
    expect(response.status).toBe(504);
    expect(response.headers.get("access-control-allow-origin")).toBe(LOCAL_ORIGIN);
    expect(await response.text()).toContain("api.localhost timed out after 1s");
  });
});

describe("record lifecycle", () => {
  test("adding a record registers its portless alias", async () => {
    const { record } = await addRecord(upstreamA.url, "api.car.localhost");
    expect(await portlessState.calls()).toContainEqual(["alias", "api.car", String(record.port)]);
  });

  test("disabling a record stops its listener and removes the alias", async () => {
    const { record, url } = await addRecord(upstreamA.url, "api.localhost");
    expect((await fetch(url)).ok).toBe(true);

    await localProxy.updateRecord(record.id, { ...record, enabled: false });

    expect(await portlessState.calls()).toContainEqual(["alias", "--remove", "api"]);
    expect(await portlessState.routes()).toEqual([]);
    await expect(fetch(url)).rejects.toThrow();
  });

  test("re-enabling reuses the persisted port", async () => {
    const { record } = await addRecord(upstreamA.url, "api.localhost");
    await localProxy.updateRecord(record.id, { ...record, enabled: false });
    const enabled = await localProxy.updateRecord(record.id, { ...record, enabled: true });
    expect(enabled.port).toBe(record.port);
  });

  test("refuses to take over an alias another app registered", async () => {
    await portlessState.writeRoutes([{ hostname: "api.localhost", port: 3000, pid: 0 }]);
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const { record, url } = await addRecord(upstreamA.url, "api.localhost");
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("local-proxy did not create"),
    );
    consoleError.mockRestore();

    const [view] = localProxy.listRecords();
    expect(view?.error).toContain("local-proxy did not create");
    expect(await portlessState.calls()).not.toContainEqual(["alias", "api", String(record.port)]);
    expect(await portlessState.routes()).toEqual([
      { hostname: "api.localhost", port: 3000, pid: 0 },
    ]);
    // The listener still works on 127.0.0.1.
    expect((await fetch(url)).ok).toBe(true);
  });

  test("rejects a second record with the same portless name", async () => {
    await addRecord(upstreamA.url, "api.localhost");
    await expect(addRecord(upstreamB.url, "api.localhost")).rejects.toThrow(
      'The name "api" is already used by api.localhost',
    );
  });
});

describe("startup and shutdown", () => {
  test("a restart brings enabled records back on their ports; shutdown removes every alias", async () => {
    const { record } = await addRecord(upstreamA.url, "api.localhost");
    await addRecord(upstreamB.url, "paused.localhost").then(({ record: paused }) =>
      localProxy.updateRecord(paused.id, { ...paused, enabled: false }),
    );
    await localProxy.shutdown();
    expect(await portlessState.routes()).toEqual([]);

    const restarted = createLocalProxy({
      db: openDatabase(join(portlessState.stateDir, "local-proxy.db")),
      adminPort: 7777,
      portless: { bin: portlessBin, stateDir: portlessState.stateDir },
    });
    await restarted.startAll();
    expect(await portlessState.routes()).toEqual([
      { hostname: "local-proxy.localhost", port: 7777, pid: 0 },
      { hostname: "api.localhost", port: record.port as number, pid: 0 },
    ]);
    expect((await fetch(`http://127.0.0.1:${record.port}`)).ok).toBe(true);

    await restarted.shutdown();
    expect(await portlessState.routes()).toEqual([]);
  });
});

interface WebSocketUpstream {
  url: string;
  /** Messages the upstream received, in order. */
  received: (string | Buffer)[];
  /** Close codes and reasons the upstream saw. */
  closes: { code: number; reason: string }[];
  stop: () => Promise<void>;
}

/**
 * Greets each client with its handshake headers, then echoes; "close-me"
 * closes with 4001. Accepts the last subprotocol offered.
 */
function startWebSocketUpstream(): WebSocketUpstream {
  const received: (string | Buffer)[] = [];
  const closes: { code: number; reason: string }[] = [];
  const server = Bun.serve<{ path: string; headers: Record<string, string> }>({
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === "/refuse") {
        return new Response("forbidden", { status: 403 });
      }
      // The last offered protocol, so a proxy that echoes the browser's first choice is caught.
      const protocol = request.headers.get("sec-websocket-protocol")?.split(",").at(-1)?.trim();
      server.upgrade(request, {
        data: { path: url.pathname + url.search, headers: Object.fromEntries(request.headers) },
        headers: protocol ? { "sec-websocket-protocol": protocol } : undefined,
      });
      return undefined;
    },
    websocket: {
      open(ws) {
        ws.send(JSON.stringify({ greeting: true, ...ws.data }));
      },
      message(ws, message) {
        received.push(message);
        if (message === "close-me") {
          ws.close(4001, "bye");
        } else {
          ws.send(message);
        }
      },
      close(_, code, reason) {
        closes.push({ code, reason });
      },
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    received,
    closes,
    stop: () => server.stop(true),
  };
}

// The DOM lib's WebSocket type hides Bun's constructor that takes headers.
const BunWebSocket = WebSocket as unknown as new (
  url: string,
  options: Bun.WebSocketOptions,
) => WebSocket;

/** Open a WebSocket to a record's listener and collect what it receives. */
async function connectWebSocket(listenerUrl: string, options: Bun.WebSocketOptions = {}) {
  const socket = new BunWebSocket(listenerUrl.replace(/^http/, "ws"), options);
  socket.binaryType = "arraybuffer";
  const messages: (string | ArrayBuffer)[] = [];
  socket.onmessage = (event) => messages.push(event.data);
  const closed = new Promise<CloseEvent>((resolve) => {
    socket.onclose = resolve;
  });
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  return { socket, messages, closed };
}

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await Bun.sleep(5);
  }
}

describe("WebSocket", () => {
  let wsUpstream: WebSocketUpstream;

  beforeEach(() => {
    wsUpstream = startWebSocketUpstream();
  });

  afterEach(async () => {
    await wsUpstream.stop();
  });

  test("relays text and binary both ways, including a greeting sent on connect", async () => {
    const { url } = await addRecord(`${wsUpstream.url}/v1`, "live.localhost");
    const { socket, messages } = await connectWebSocket(`${url}/socket?room=7`);

    await waitFor(() => messages.length === 1);
    expect(JSON.parse(messages[0] as string)).toMatchObject({
      greeting: true,
      path: "/v1/socket?room=7",
    });

    socket.send("ping");
    socket.send(new Uint8Array([1, 2, 3]));
    await waitFor(() => messages.length === 3);
    expect(messages[1]).toBe("ping");
    expect([...new Uint8Array(messages[2] as ArrayBuffer)]).toEqual([1, 2, 3]);
    expect(wsUpstream.received[0]).toBe("ping");
    expect(localProxy.requestLog.since(0)).toContainEqual(
      expect.objectContaining({ method: "WS", path: "/socket?room=7", status: 101 }),
    );
  });

  test("the upstream handshake follows the record's header rules", async () => {
    const { url } = await addRecord(wsUpstream.url, "live.localhost", {
      extraHeaders: [{ name: "X-Api-Key", value: "secret" }],
    });
    const { messages } = await connectWebSocket(url, {
      headers: { origin: LOCAL_ORIGIN, cookie: "session=1", host: "live.localhost" },
    });

    await waitFor(() => messages.length === 1);
    const { headers } = JSON.parse(messages[0] as string);
    expect(headers.host).toBe(new URL(wsUpstream.url).host);
    expect(headers.origin).toBeUndefined();
    expect(headers.cookie).toBe("session=1");
    expect(headers["x-api-key"]).toBe("secret");
  });

  test("passes the subprotocol the upstream picks back to the browser", async () => {
    const { url } = await addRecord(wsUpstream.url, "live.localhost");
    const { socket } = await connectWebSocket(url, {
      protocols: ["graphql-transport-ws", "graphql-ws"],
    });
    expect(socket.protocol).toBe("graphql-ws");
  });

  test("close codes and reasons travel both ways", async () => {
    const { url } = await addRecord(wsUpstream.url, "live.localhost");

    const closedByUpstream = await connectWebSocket(url);
    closedByUpstream.socket.send("close-me");
    const event = await closedByUpstream.closed;
    expect([event.code, event.reason]).toEqual([4001, "bye"]);

    const closedByBrowser = await connectWebSocket(url);
    closedByBrowser.socket.close(4000, "done");
    await waitFor(() => wsUpstream.closes.length === 2);
    expect(wsUpstream.closes[1]).toEqual({ code: 4000, reason: "done" });
  });

  test("a refused upstream handshake gives 502", async () => {
    const { url } = await addRecord(wsUpstream.url, "live.localhost");
    await expect(connectWebSocket(`${url}/refuse`)).rejects.toBeDefined();
    expect(localProxy.requestLog.since(0)).toContainEqual(
      expect.objectContaining({ method: "WS", path: "/refuse", status: 502 }),
    );
  });

  test("an upstream that never answers the handshake gives 504 after the timeout", async () => {
    const silent = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const { url } = await addRecord(`http://127.0.0.1:${silent.port}`, "live.localhost", {
      timeoutSeconds: 1,
    });
    await expect(connectWebSocket(url)).rejects.toBeDefined();
    silent.stop(true);
    expect(localProxy.requestLog.since(0)).toContainEqual(
      expect.objectContaining({ method: "WS", status: 504 }),
    );
  });

  test("disabling a record closes its open WebSockets", async () => {
    const { record, url } = await addRecord(wsUpstream.url, "live.localhost");
    const { closed } = await connectWebSocket(url);

    await localProxy.updateRecord(record.id, { ...record, enabled: false });

    await closed;
    await waitFor(() => wsUpstream.closes.length === 1);
  });
});
