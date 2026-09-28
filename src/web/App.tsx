import { useEffect, useState } from "react";
import type { RecordInput } from "../records/schema";
import {
  deleteRecord,
  fetchLog,
  fetchRecords,
  fetchStatus,
  type LogEntry,
  type PortlessStatus,
  type RecordView,
  saveRecord,
} from "./api";
import { PortlessBanner } from "./components/PortlessBanner";
import { RecordForm } from "./components/RecordForm";
import { RecordsTable } from "./components/RecordsTable";
import { RequestLog } from "./components/RequestLog";

const STATUS_POLL_MS = 5000;
const LOG_POLL_MS = 1000;
const MAX_LOG_ENTRIES = 200;

type Editing = { record: RecordView | null } | null;

export function App() {
  const [records, setRecords] = useState<RecordView[]>([]);
  const [status, setStatus] = useState<PortlessStatus | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [editing, setEditing] = useState<Editing>(null);

  async function reloadRecords() {
    setRecords(await fetchRecords());
  }

  useEffect(() => {
    fetchRecords().then(setRecords);
    const refreshStatus = () => fetchStatus().then(setStatus);
    refreshStatus();
    const timer = setInterval(refreshStatus, STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let lastSeq = 0;
    const timer = setInterval(async () => {
      const entries = await fetchLog(lastSeq);
      if (entries.length > 0) {
        lastSeq = entries.at(-1)?.seq ?? lastSeq;
        setLog((current) => [...current, ...entries].slice(-MAX_LOG_ENTRIES));
      }
    }, LOG_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  async function submit(input: RecordInput) {
    await saveRecord(input, editing?.record?.id ?? null);
    setEditing(null);
    await reloadRecords();
  }

  async function toggle(record: RecordView) {
    const { source, domain, options } = record;
    await saveRecord(
      { source, domain, options, enabled: !record.enabled },
      record.id,
    );
    await reloadRecords();
  }

  async function remove(record: RecordView) {
    if (window.confirm(`Delete ${record.domain}?`)) {
      await deleteRecord(record.id);
      await reloadRecords();
    }
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Local Proxy</h1>
          <p className="text-sm text-zinc-500">
            Remote APIs behind local HTTPS domains
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({ record: null })}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Add record
        </button>
      </header>

      <PortlessBanner status={status} />
      <RecordsTable
        records={records}
        onToggle={toggle}
        onEdit={(record) => setEditing({ record })}
        onDelete={remove}
      />
      <RequestLog entries={log} />

      {editing && (
        <div className="fixed inset-0 z-10 flex justify-end bg-black/30">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editing.record ? "Edit record" : "Add record"}
            className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl dark:bg-zinc-950"
          >
            <RecordForm
              record={editing.record}
              servedTlds={status?.tlds ?? ["localhost"]}
              onSubmit={submit}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </main>
  );
}
