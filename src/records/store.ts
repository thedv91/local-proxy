import type { Database } from "bun:sqlite";
import { type ProxyRecord, type RecordInput, recordOptionsSchema } from "./schema";

export class RecordNotFoundError extends Error {}

// A type alias, not an interface: bun:sqlite only binds objects with an index signature.
type RecordRow = {
  id: string;
  source: string;
  domain: string;
  enabled: number;
  port: number | null;
  options: string;
};

/** Records and owned alias names in the local-proxy database. */
export class RecordStore {
  constructor(private readonly db: Database) {}

  /** In the order they were added. */
  list(): ProxyRecord[] {
    return this.db.query<RecordRow, []>("SELECT * FROM records ORDER BY rowid").all().map(toRecord);
  }

  get(id: string): ProxyRecord {
    const row = this.db.query<RecordRow, [string]>("SELECT * FROM records WHERE id = ?").get(id);
    if (!row) {
      throw new RecordNotFoundError(`No record with id ${id}`);
    }
    return toRecord(row);
  }

  add(input: RecordInput): ProxyRecord {
    const record: ProxyRecord = { ...input, id: crypto.randomUUID(), port: null };
    this.insert(record);
    return record;
  }

  /** Store a record as is, keeping its id and port. */
  insert(record: ProxyRecord): void {
    this.db
      .query(
        `INSERT INTO records (id, source, domain, enabled, port, options)
         VALUES ($id, $source, $domain, $enabled, $port, $options)`,
      )
      .run(toRow(record));
  }

  update(id: string, input: RecordInput): ProxyRecord {
    const { port } = this.get(id);
    const record: ProxyRecord = { ...input, id, port };
    this.db
      .query(
        `UPDATE records
         SET source = $source, domain = $domain, enabled = $enabled, port = $port, options = $options
         WHERE id = $id`,
      )
      .run(toRow(record));
    return record;
  }

  setPort(id: string, port: number): ProxyRecord {
    this.get(id);
    this.db.query("UPDATE records SET port = ? WHERE id = ?").run(port, id);
    return this.get(id);
  }

  remove(id: string): void {
    this.get(id);
    this.db.query("DELETE FROM records WHERE id = ?").run(id);
  }

  ownedAliases(): string[] {
    return this.db
      .query<{ name: string }, []>("SELECT name FROM owned_aliases ORDER BY rowid")
      .all()
      .map((row) => row.name);
  }

  claimAlias(name: string): void {
    this.db.query("INSERT OR IGNORE INTO owned_aliases (name) VALUES (?)").run(name);
  }

  releaseAlias(name: string): void {
    this.db.query("DELETE FROM owned_aliases WHERE name = ?").run(name);
  }
}

function toRow(record: ProxyRecord): RecordRow {
  return {
    id: record.id,
    source: record.source,
    domain: record.domain,
    enabled: record.enabled ? 1 : 0,
    port: record.port,
    options: JSON.stringify(record.options),
  };
}

function toRecord(row: RecordRow): ProxyRecord {
  return {
    id: row.id,
    source: row.source,
    domain: row.domain,
    enabled: row.enabled === 1,
    port: row.port,
    // Parsed through the schema so options added later get their defaults.
    options: recordOptionsSchema.parse(JSON.parse(row.options)),
  };
}
