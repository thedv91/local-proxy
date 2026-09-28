import type { RecordView } from "../local-proxy";
import type { PortlessStatus } from "../portless/portless";
import type { ProxyRecord, RecordInput } from "../records/schema";
import type { LogEntry } from "../request-log";

export type { LogEntry, PortlessStatus, RecordView };

export class ApiError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchRecords(): Promise<RecordView[]> {
  return request("/api/records");
}

export async function fetchStatus(): Promise<PortlessStatus> {
  return request("/api/status");
}

export async function fetchLog(after: number): Promise<LogEntry[]> {
  return request(`/api/log?after=${after}`);
}

export async function saveRecord(input: RecordInput, id: string | null): Promise<ProxyRecord> {
  return request(id ? `/api/records/${id}` : "/api/records", {
    method: id ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteRecord(id: string): Promise<void> {
  await request(`/api/records/${id}`, { method: "DELETE" });
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 204) {
    return undefined as T;
  }
  const body = await response.json();
  if (!response.ok) {
    throw new ApiError(body.field ?? "", body.error ?? `Request failed (${response.status})`);
  }
  return body as T;
}
