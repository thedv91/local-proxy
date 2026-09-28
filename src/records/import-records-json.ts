import { renameSync } from "node:fs";
import { recordsFileSchema } from "./schema";
import type { RecordStore } from "./store";

/**
 * Move records from the records.json file that local-proxy used before the
 * database into the store, once. The file is renamed afterwards so records
 * deleted later do not come back on the next start.
 */
export async function importRecordsJson(store: RecordStore, path: string): Promise<number> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return 0;
  }
  const { records, ownedAliases } = recordsFileSchema.parse(await file.json());
  const existingIds = new Set(store.list().map((record) => record.id));
  const newRecords = records.filter((record) => !existingIds.has(record.id));
  for (const record of newRecords) {
    store.insert(record);
  }
  for (const name of ownedAliases) {
    store.claimAlias(name);
  }
  renameSync(path, `${path}.imported`);
  return newRecords.length;
}
