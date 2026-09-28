import type { LogEntry } from "../api";

export function RequestLog({ entries }: { entries: LogEntry[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Request log{" "}
        <span className="font-normal normal-case">(newest 200 of the last 10,000 kept)</span>
      </h2>
      <div className="max-h-96 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        {entries.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-zinc-500">No requests yet.</p>
        ) : (
          <table className="w-full font-mono text-xs">
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {[...entries].reverse().map((entry) => (
                <tr key={entry.seq}>
                  <td className="whitespace-nowrap px-3 py-1 text-zinc-500">
                    {new Date(entry.time).toLocaleTimeString()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1">{entry.domain}</td>
                  <td className="px-3 py-1">{entry.method}</td>
                  <td className="max-w-md truncate px-3 py-1" title={entry.path}>
                    {entry.path}
                  </td>
                  <td className={`px-3 py-1 ${statusColor(entry.status)}`}>{entry.status}</td>
                  <td className="whitespace-nowrap px-3 py-1 text-right text-zinc-500">
                    {entry.latencyMs} ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function statusColor(status: number): string {
  if (status >= 500) return "text-red-600 dark:text-red-400";
  if (status >= 400) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}
