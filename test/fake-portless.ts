import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Write a stand-in for the portless binary. It records its arguments and keeps
 * routes.json the way `portless alias` does (pid 0, .localhost only), both in
 * $PORTLESS_STATE_DIR.
 *
 * Create it once per test file: macOS scans a new executable on its first run,
 * which costs ~400 ms.
 */
export async function installFakePortless(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "local-proxy-fake-portless-"));
  const bin = join(dir, "portless");
  await Bun.write(
    bin,
    `#!${process.execPath}
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const stateDir = process.env.PORTLESS_STATE_DIR;
const args = process.argv.slice(2);
appendFileSync(join(stateDir, "calls.jsonl"), JSON.stringify(args) + "\\n");
const routesPath = join(stateDir, "routes.json");
const routes = existsSync(routesPath) ? JSON.parse(readFileSync(routesPath, "utf8")) : [];
if (args[0] === "alias" && args[1] === "--remove") {
  const hostname = args[2] + ".localhost";
  writeFileSync(routesPath, JSON.stringify(routes.filter((r) => r.hostname !== hostname)));
} else if (args[0] === "alias") {
  const hostname = args[1] + ".localhost";
  const others = routes.filter((r) => r.hostname !== hostname);
  writeFileSync(routesPath, JSON.stringify([...others, { hostname, port: Number(args[2]), pid: 0 }]));
}
`,
  );
  await chmod(bin, 0o755);
  return bin;
}

export type Route = { hostname: string; port: number; pid: number };

/** A fresh portless state directory with helpers to inspect what the fake binary did. */
export async function createPortlessState() {
  const stateDir = await mkdtemp(join(tmpdir(), "local-proxy-portless-state-"));
  const routesFile = () => Bun.file(join(stateDir, "routes.json"));

  return {
    stateDir,
    async calls(): Promise<string[][]> {
      const file = Bun.file(join(stateDir, "calls.jsonl"));
      if (!(await file.exists())) {
        return [];
      }
      const lines = (await file.text()).trim().split("\n");
      return lines.map((line) => JSON.parse(line));
    },
    async routes(): Promise<Route[]> {
      return (await routesFile().exists()) ? routesFile().json() : [];
    },
    async writeRoutes(routes: Route[]): Promise<void> {
      await Bun.write(routesFile(), JSON.stringify(routes));
    },
  };
}
