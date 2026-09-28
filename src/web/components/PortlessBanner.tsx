import type { PortlessStatus } from "../api";

export function PortlessBanner({ status }: { status: PortlessStatus | null }) {
  if (!status?.problem) {
    return null;
  }
  return (
    <div
      role="alert"
      className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="font-medium">
        {status.installed ? "portless proxy is not running" : "portless is not installed"}
      </p>
      <p className="mt-1">{status.problem}</p>
      <p className="mt-1 text-amber-800 dark:text-amber-200">
        Records still listen on 127.0.0.1, but their local domains will not resolve until this is
        fixed.
      </p>
    </div>
  );
}
