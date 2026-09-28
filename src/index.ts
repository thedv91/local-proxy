import { homedir } from "node:os";
import { join } from "node:path";
import { startAdminServer } from "./admin/server";
import { openDatabase } from "./database";
import { createLocalProxy, type LocalProxyConfig } from "./local-proxy";
import { importRecordsJson } from "./records/import-records-json";
import { RecordStore } from "./records/store";

const configDir = join(homedir(), ".config", "local-proxy");
const db = openDatabase(join(configDir, "local-proxy.db"));
const imported = await importRecordsJson(new RecordStore(db), join(configDir, "records.json"));
if (imported > 0) {
  console.log(`local-proxy: imported ${imported} records from records.json into local-proxy.db`);
}

const config: LocalProxyConfig = {
  db,
  adminPort: 7777,
  portless: {
    bin: "portless",
    // Same override portless itself honors.
    stateDir: process.env.PORTLESS_STATE_DIR ?? join(homedir(), ".portless"),
  },
};

const localProxy = createLocalProxy(config);
const admin = startAdminServer(localProxy, config.adminPort);
console.log(`local-proxy admin: ${admin.url} (https://local-proxy.localhost via portless)`);

const portless = await localProxy.portlessStatus();
if (portless.problem) {
  console.error(`local-proxy: ${portless.problem}`);
}

await localProxy.startAll();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await localProxy.shutdown();
    await admin.stop(true);
    db.close();
    process.exit(0);
  });
}
