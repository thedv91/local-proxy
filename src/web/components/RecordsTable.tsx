import { type ReactNode, useState } from "react";
import type { RecordView } from "../api";

interface RecordsTableProps {
  records: RecordView[];
  onToggle: (record: RecordView) => void;
  onEdit: (record: RecordView) => void;
  onDelete: (record: RecordView) => void;
}

export function RecordsTable({ records, onToggle, onEdit, onDelete }: RecordsTableProps) {
  if (records.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
        No records yet. Add one to proxy a remote API behind a local domain.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
          <tr>
            <th className="px-3 py-2 font-medium">Domain</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Options</th>
            <th className="px-3 py-2 font-medium">Enabled</th>
            <th className="px-3 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {records.map((record) => (
            <tr key={record.id} className="align-top">
              <td className="px-3 py-2">
                <DomainCell record={record} />
              </td>
              <td className="max-w-xs break-all px-3 py-2 text-zinc-600 dark:text-zinc-400">
                {record.source}
              </td>
              <td className="px-3 py-2">
                <OptionBadges record={record} />
              </td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={record.enabled}
                  aria-label={`Enable ${record.domain}`}
                  onClick={() => onToggle(record)}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
                    record.enabled ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${
                      record.enabled ? "translate-x-4.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onEdit(record)}
                  className="rounded px-2 py-1 text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(record)}
                  className="rounded px-2 py-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DomainCell({ record }: { record: RecordView }) {
  const [copied, setCopied] = useState(false);
  const url = `https://${record.domain}`;

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <a href={url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
          {record.domain}
        </a>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${url}`}
          className="rounded border border-zinc-200 px-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {record.listening && record.port !== null && (
        <p className="mt-0.5 text-xs text-zinc-500">127.0.0.1:{record.port}</p>
      )}
      {record.error && (
        <p className="mt-0.5 max-w-sm text-xs text-red-600 dark:text-red-400">{record.error}</p>
      )}
    </div>
  );
}

function OptionBadges({ record }: { record: RecordView }) {
  const { options } = record;
  const headerCount = options.extraHeaders.length;
  return (
    <ul className="flex flex-wrap gap-1">
      <Badge>{options.cors === "reflect" ? "CORS reflect" : "CORS pass-through"}</Badge>
      {options.dropOriginReferer && <Badge>No Origin/Referer</Badge>}
      {headerCount > 0 && (
        <Badge>
          +{headerCount} header{headerCount > 1 ? "s" : ""}
        </Badge>
      )}
      {options.rewriteSetCookie && <Badge>Cookie rewrite</Badge>}
      {options.rewriteLocation && <Badge>Location rewrite</Badge>}
      <Badge>{options.timeoutSeconds}s timeout</Badge>
      {options.skipTlsVerify && <Badge warning>TLS verify off</Badge>}
    </ul>
  );
}

function Badge({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return (
    <li
      className={`rounded px-1.5 py-0.5 text-xs ${
        warning
          ? "bg-red-100 font-medium text-red-800 dark:bg-red-950 dark:text-red-200"
          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
      }`}
    >
      {children}
    </li>
  );
}
