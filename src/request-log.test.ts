import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./database";
import { type LogEntry, RequestLog } from "./request-log";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "local-proxy-log-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function entry(path: string): Omit<LogEntry, "seq"> {
  return {
    time: "2026-09-28T04:00:00.000Z",
    recordId: "r1",
    domain: "api.localhost",
    method: "GET",
    path,
    status: 200,
    latencyMs: 12,
  };
}

test("returns entries after a sequence number, oldest first", () => {
  const log = new RequestLog(openDatabase(":memory:"));
  log.add(entry("/a"));
  log.add(entry("/b"));
  log.add(entry("/c"));

  expect(log.since(0)).toEqual([
    { ...entry("/a"), seq: 1 },
    { ...entry("/b"), seq: 2 },
    { ...entry("/c"), seq: 3 },
  ]);
  expect(log.since(2).map((e) => e.path)).toEqual(["/c"]);
});

test("one poll returns only the newest 200", () => {
  const log = new RequestLog(openDatabase(":memory:"));
  for (let i = 1; i <= 250; i++) {
    log.add(entry(`/${i}`));
  }
  const page = log.since(0);
  expect(page).toHaveLength(200);
  expect(page[0]?.path).toBe("/51");
  expect(page.at(-1)?.path).toBe("/250");
});

test("keeps only the configured number of entries", () => {
  const db = openDatabase(":memory:");
  const log = new RequestLog(db, 3);
  for (let i = 1; i <= 5; i++) {
    log.add(entry(`/${i}`));
  }
  expect(log.since(0).map((e) => e.path)).toEqual(["/3", "/4", "/5"]);
  expect(db.query("SELECT count(*) AS n FROM request_log").get()).toEqual({ n: 3 });
});

test("survives a restart and keeps counting from the last sequence number", () => {
  const path = join(dir, "local-proxy.db");
  const db = openDatabase(path);
  const log = new RequestLog(db, 1);
  log.add(entry("/before"));
  log.add(entry("/kept"));
  db.close();

  const reopened = new RequestLog(openDatabase(path), 1);
  expect(reopened.since(0)).toEqual([{ ...entry("/kept"), seq: 2 }]);
  reopened.add(entry("/after"));
  expect(reopened.since(0)).toEqual([{ ...entry("/after"), seq: 3 }]);
});
