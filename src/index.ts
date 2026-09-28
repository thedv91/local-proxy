// `bun dev` / `bun start` from this repo. The published package starts from bin/local-proxy.ts.
import { DEFAULT_ADMIN_PORT, runLocalProxy } from "./main";
import index from "./web/index.html";

await runLocalProxy({ ui: index, adminPort: DEFAULT_ADMIN_PORT });
