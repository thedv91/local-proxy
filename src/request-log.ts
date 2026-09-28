import type { Database } from "bun:sqlite";

export interface LogEntry {
  seq: number;
  time: string;
  recordId: string;
  domain: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
}

const KEPT_ENTRIES = 10_000;
/** What one poll returns at most; the UI shows the same number. */
const PAGE_SIZE = 200;

/** Requests across all records, kept in the database up to the last 10,000. */
export class RequestLog {
  constructor(
    private readonly db: Database,
    private readonly keptEntries = KEPT_ENTRIES,
  ) {}

  add(entry: Omit<LogEntry, "seq">): void {
    const { lastInsertRowid } = this.db
      .query(
        `INSERT INTO request_log (time, record_id, domain, method, path, status, latency_ms)
         VALUES ($time, $recordId, $domain, $method, $path, $status, $latencyMs)`,
      )
      .run(entry);
    this.db
      .query("DELETE FROM request_log WHERE seq <= ?")
      .run(Number(lastInsertRowid) - this.keptEntries);
  }

  /** The newest entries after `seq`, at most 200, oldest first. */
  since(seq: number): LogEntry[] {
    return this.db
      .query<LogEntry, [number, number]>(
        `SELECT seq, time, record_id AS recordId, domain, method, path, status, latency_ms AS latencyMs
         FROM request_log WHERE seq > ? ORDER BY seq DESC LIMIT ?`,
      )
      .all(seq, PAGE_SIZE)
      .reverse();
  }
}
