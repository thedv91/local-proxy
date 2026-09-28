import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../database";
import { DEFAULT_OPTIONS, type RecordInput } from "./schema";
import { RecordNotFoundError, RecordStore } from "./store";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "local-proxy-store-"));
  path = join(dir, "nested", "local-proxy.db");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const input: RecordInput = {
  source: "https://api.example.com",
  domain: "api.localhost",
  enabled: true,
  options: DEFAULT_OPTIONS,
};

test("starts empty", () => {
  const store = new RecordStore(openDatabase(path));
  expect(store.list()).toEqual([]);
  expect(store.ownedAliases()).toEqual([]);
});

test("add, edit, set port and remove survive reopening the database", () => {
  const db = openDatabase(path);
  const store = new RecordStore(db);
  const added = store.add(input);
  const second = store.add({ ...input, domain: "cars.localhost" });
  store.update(added.id, { ...input, source: "https://api.example.com/v2", enabled: false });
  store.setPort(added.id, 41234);
  store.remove(second.id);
  store.claimAlias("api");
  db.close();

  const reopened = new RecordStore(openDatabase(path));
  expect(reopened.list()).toEqual([
    { ...input, id: added.id, source: "https://api.example.com/v2", enabled: false, port: 41234 },
  ]);
  expect(reopened.ownedAliases()).toEqual(["api"]);

  reopened.releaseAlias("api");
  expect(reopened.ownedAliases()).toEqual([]);
});

test("lists records in the order they were added", () => {
  const store = new RecordStore(openDatabase(":memory:"));
  const domains = ["b.localhost", "a.localhost", "c.localhost"];
  for (const domain of domains) {
    store.add({ ...input, domain });
  }
  expect(store.list().map((record) => record.domain)).toEqual(domains);
});

test("editing keeps the persisted port", () => {
  const store = new RecordStore(openDatabase(":memory:"));
  const added = store.add(input);
  store.setPort(added.id, 40000);
  expect(store.update(added.id, { ...input, domain: "api2.localhost" }).port).toBe(40000);
});

test("claiming an alias twice keeps one entry", () => {
  const store = new RecordStore(openDatabase(":memory:"));
  store.claimAlias("api");
  store.claimAlias("api");
  expect(store.ownedAliases()).toEqual(["api"]);
});

test("unknown ids are reported", () => {
  const store = new RecordStore(openDatabase(":memory:"));
  expect(() => store.remove("missing")).toThrow(RecordNotFoundError);
  expect(() => store.setPort("missing", 1)).toThrow(RecordNotFoundError);
});

test("stored options missing a newer field get its default", () => {
  const db = openDatabase(":memory:");
  const store = new RecordStore(db);
  const added = store.add(input);
  const { skipTlsVerify: _, ...olderOptions } = DEFAULT_OPTIONS;
  db.query("UPDATE records SET options = ? WHERE id = ?").run(
    JSON.stringify(olderOptions),
    added.id,
  );
  expect(store.get(added.id).options).toEqual(DEFAULT_OPTIONS);
});
