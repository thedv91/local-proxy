import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Open (or create) the local-proxy database with every table it uses. */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true, strict: true });
  // Every proxied request inserts a log row; WAL appends instead of rewriting a rollback journal.
  db.run("PRAGMA journal_mode = WAL");

  db.run(`
    CREATE TABLE IF NOT EXISTS records (
      id      TEXT PRIMARY KEY,
      source  TEXT NOT NULL,
      domain  TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      port    INTEGER,
      options TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS owned_aliases (
      name TEXT PRIMARY KEY
    )
  `);
  // AUTOINCREMENT so seq never repeats after old rows are pruned; the UI polls with ?after=<seq>.
  db.run(`
    CREATE TABLE IF NOT EXISTS request_log (
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      time       TEXT NOT NULL,
      record_id  TEXT NOT NULL,
      domain     TEXT NOT NULL,
      method     TEXT NOT NULL,
      path       TEXT NOT NULL,
      status     INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL
    )
  `);
  return db;
}
