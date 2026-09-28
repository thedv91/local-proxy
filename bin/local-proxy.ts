#!/usr/bin/env bun
import { join } from "node:path";
import { parseArgs } from "node:util";
import packageJson from "../package.json";
import { DEFAULT_ADMIN_PORT, runLocalProxy } from "../src/main";

const usage = `Usage: local-proxy [--port <admin port>]

Proxy remote APIs behind local HTTPS domains served by portless.
Needs Bun, and portless with its proxy running (portless proxy start).

Options:
  -p, --port <port>  Admin UI and API port (default ${DEFAULT_ADMIN_PORT})
  -h, --help         Show this help
  -v, --version      Show the version`;

const { values } = parseArgs({
  options: {
    port: { type: "string", short: "p" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

if (values.help) {
  console.log(usage);
  process.exit(0);
}
if (values.version) {
  console.log(packageJson.version);
  process.exit(0);
}

const adminPort = values.port === undefined ? DEFAULT_ADMIN_PORT : Number(values.port);
if (!Number.isInteger(adminPort) || adminPort < 1 || adminPort > 65535) {
  console.error(`local-proxy: invalid --port "${values.port}"\n\n${usage}`);
  process.exit(2);
}

// Built by `bun run build` (run automatically before packing).
await runLocalProxy({ ui: { builtDir: join(import.meta.dir, "..", "dist", "web") }, adminPort });
