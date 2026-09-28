import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../database";
import { importRecordsJson } from "./import-records-json";
import { DEFAULT_OPTIONS, type ProxyRecord } from "./schema";
import { RecordStore } from "./store";

let dir: string;
let jsonPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "local-proxy-import-"));
  jsonPath = join(dir, "records.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const record: ProxyRecord = {
  id: "281db5c8-c31b-4b7c-9b7d-3bb3eb8ef198",
  source: "https://httpbin.org",
  domain: "httpbin.localhost",
  enabled: true,
  port: 51525,
  options: DEFAULT_OPTIONS,
};

test("imports records and owned aliases once, then renames the file", async () => {
  await Bun.write(
    jsonPath,
    JSON.stringify({ version: 1, ownedAliases: ["local-proxy", "httpbin"], records: [record] }),
  );
  const store = new RecordStore(openDatabase(":memory:"));

  expect(await importRecordsJson(store, jsonPath)).toBe(1);

  expect(store.list()).toEqual([record]);
  expect(store.ownedAliases()).toEqual(["local-proxy", "httpbin"]);
  expect(await Bun.file(jsonPath).exists()).toBe(false);
  expect(await Bun.file(`${jsonPath}.imported`).exists()).toBe(true);
  expect(await importRecordsJson(store, jsonPath)).toBe(0);
});

test("skips records the database already has", async () => {
  await Bun.write(jsonPath, JSON.stringify({ version: 1, records: [record] }));
  const store = new RecordStore(openDatabase(":memory:"));
  store.insert(record);

  expect(await importRecordsJson(store, jsonPath)).toBe(0);
  expect(store.list()).toEqual([record]);
});

test("does nothing without a records.json", async () => {
  const store = new RecordStore(openDatabase(":memory:"));
  expect(await importRecordsJson(store, jsonPath)).toBe(0);
  expect(store.list()).toEqual([]);
});
