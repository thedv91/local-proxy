import { join } from "node:path";
import { z } from "zod";

export interface PortlessConfig {
  /** Binary to run; tests point this at a fake script. */
  bin: string;
  /** portless state directory, ~/.portless unless PORTLESS_STATE_DIR is set. */
  stateDir: string;
}

export interface PortlessStatus {
  installed: boolean;
  proxyRunning: boolean;
  proxyPort: number | null;
  tlds: string[];
  /** What is wrong and how to fix it, or null when portless is ready. */
  problem: string | null;
}

export class AliasConflictError extends Error {}

// This file mirrors how portless 0.15.6 reads its own state (src/cli-utils.ts
// discoverState, src/routes.ts). portless has no machine-readable status
// command, so the state files are the only source of the port, TLDs and routes.
const DEFAULT_TLD = "localhost";
const DEFAULT_PROXY_PORT = 443;
const PROBE_TIMEOUT_MS = 1000;

const routesSchema = z.array(z.object({ hostname: z.string(), port: z.number(), pid: z.number() }));

export function createPortless(config: PortlessConfig) {
  async function status(): Promise<PortlessStatus> {
    const tlds = await servedTlds();
    const installed = await isInstalled();
    if (!installed) {
      return {
        installed,
        proxyRunning: false,
        proxyPort: null,
        tlds,
        problem: `portless is not installed ("${config.bin}" not found). Install it with: npm install -g portless`,
      };
    }
    const proxyPort = await readProxyPort();
    const proxyRunning = await isProxyRunning(proxyPort);
    return {
      installed,
      proxyRunning,
      proxyPort: proxyRunning ? proxyPort : null,
      tlds,
      problem: proxyRunning
        ? null
        : "The portless proxy is not running. Start it with: portless proxy start",
    };
  }

  /**
   * Throw when `<name>.<any served TLD>` is an alias another app registered.
   * portless overwrites an existing alias silently, and its --force kills
   * whichever process owns a route, so neither protects other apps' names.
   * Routes owned by a live process (pid ≠ 0) are left to portless, which
   * refuses them without --force.
   */
  async function assertAliasAvailable(name: string, ownedNames: readonly string[]) {
    if (ownedNames.includes(name)) {
      return;
    }
    const hostnames = await hostnamesFor(name);
    const routes = await readRoutes();
    const foreign = routes.find((route) => route.pid === 0 && hostnames.includes(route.hostname));
    if (foreign) {
      throw new AliasConflictError(
        `${foreign.hostname} is already a portless alias (port ${foreign.port}) that local-proxy did not create. ` +
          `Pick another domain, or remove it with: portless alias --remove ${name}`,
      );
    }
  }

  async function addAlias(name: string, port: number) {
    await run(["alias", name, String(port)]);
  }

  async function removeAlias(name: string) {
    const hostnames = await hostnamesFor(name);
    const routes = await readRoutes();
    const hasAlias = routes.some((route) => route.pid === 0 && hostnames.includes(route.hostname));
    // `alias --remove` exits 1 when there is nothing to remove.
    if (hasAlias) {
      await run(["alias", "--remove", name]);
    }
  }

  async function hostnamesFor(name: string): Promise<string[]> {
    return (await servedTlds()).map((tld) => `${name}.${tld}`);
  }

  async function run(args: string[]): Promise<void> {
    let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
    try {
      child = Bun.spawn([config.bin, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        // The binary must write the same state dir this module reads.
        env: { ...process.env, PORTLESS_STATE_DIR: config.stateDir },
      });
    } catch (error) {
      throw new Error(`Could not run "${config.bin}": ${(error as Error).message}`);
    }
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    if (exitCode !== 0) {
      throw new Error(`portless ${args.join(" ")} failed (exit ${exitCode}): ${stderr.trim()}`);
    }
  }

  async function isInstalled(): Promise<boolean> {
    return run(["--version"]).then(
      () => true,
      () => false,
    );
  }

  /** proxy.tlds is newline/comma separated or a JSON array; proxy.tld is the older single-TLD file. */
  async function servedTlds(): Promise<string[]> {
    const tldsFile = Bun.file(join(config.stateDir, "proxy.tlds"));
    if (await tldsFile.exists()) {
      const raw = (await tldsFile.text()).trim();
      const tlds: unknown[] = raw.startsWith("[") ? JSON.parse(raw) : raw.split(/[\n,]/);
      const valid = tlds
        .filter((tld): tld is string => typeof tld === "string")
        .map((tld) => tld.trim().toLowerCase())
        .filter(Boolean);
      if (valid.length > 0) {
        return [...new Set(valid)];
      }
    }
    const tldFile = Bun.file(join(config.stateDir, "proxy.tld"));
    if (await tldFile.exists()) {
      return [(await tldFile.text()).trim() || DEFAULT_TLD];
    }
    return [DEFAULT_TLD];
  }

  async function readProxyPort(): Promise<number> {
    const portFile = Bun.file(join(config.stateDir, "proxy.port"));
    if (!(await portFile.exists())) {
      return DEFAULT_PROXY_PORT;
    }
    return Number.parseInt(await portFile.text(), 10) || DEFAULT_PROXY_PORT;
  }

  async function readRoutes() {
    const routesFile = Bun.file(join(config.stateDir, "routes.json"));
    if (!(await routesFile.exists())) {
      return [];
    }
    const parsed = routesSchema.safeParse(await routesFile.json().catch(() => null));
    return parsed.success ? parsed.data : [];
  }

  return { status, servedTlds, assertAliasAvailable, addAlias, removeAlias };
}

export type Portless = ReturnType<typeof createPortless>;

/**
 * The proxy answers every request with `X-Portless: 1`. Its TLS listener also
 * accepts plain HTTP, so one http probe covers both modes.
 */
async function isProxyRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: "HEAD",
      // The TLS proxy answers plain HTTP with a 302 to https://127.0.0.1/, whose
      // certificate does not cover that IP. Following it would fail the probe.
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.headers.get("x-portless") === "1";
  } catch {
    return false;
  }
}
