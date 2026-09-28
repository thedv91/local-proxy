import { homedir } from "node:os";
import { join } from "node:path";
import { type AdminUi, startAdminServer } from "./admin/server";
import { openDatabase } from "./database";
import { createLocalProxy } from "./local-proxy";
import { importRecordsJson } from "./records/import-records-json";
import { RecordStore } from "./records/store";

export const DEFAULT_ADMIN_PORT = 7777;

/** Start the admin UI and every enabled record; remove the aliases again on SIGINT/SIGTERM. */
export async function runLocalProxy({ ui, adminPort }: { ui: AdminUi; adminPort: number }) {
  const configDir = join(homedir(), ".config", "local-proxy");
  const db = openDatabase(join(configDir, "local-proxy.db"));
  const imported = await importRecordsJson(new RecordStore(db), join(configDir, "records.json"));
  if (imported > 0) {
    console.log(`local-proxy: imported ${imported} records from records.json into local-proxy.db`);
  }

  const localProxy = createLocalProxy({
    db,
    adminPort,
    portless: {
      bin: "portless",
      // Same override portless itself honors.
      stateDir: process.env.PORTLESS_STATE_DIR ?? join(homedir(), ".portless"),
    },
  });
  const admin = startAdminServer(localProxy, adminPort, ui);
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
}
