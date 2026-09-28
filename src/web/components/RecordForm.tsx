import { type FormEvent, type ReactNode, useId, useState } from "react";
import { checkDomain, defaultDomainFromSource } from "../../records/domain";
import {
  CORS_MODES,
  type CorsMode,
  DEFAULT_OPTIONS,
  type ProxyRecord,
  type RecordInput,
  type RecordOptions,
  sourceSchema,
} from "../../records/schema";
import { ApiError } from "../api";

interface RecordFormProps {
  /** The record being edited, or null to add one. */
  record: ProxyRecord | null;
  servedTlds: string[];
  onSubmit: (input: RecordInput) => Promise<void>;
  onCancel: () => void;
}

export function RecordForm({ record, servedTlds, onSubmit, onCancel }: RecordFormProps) {
  const [source, setSource] = useState(record?.source ?? "");
  const [domain, setDomain] = useState(record?.domain ?? "");
  // Keep suggesting a domain from the source until the user types their own.
  const [domainEdited, setDomainEdited] = useState(record !== null);
  const [enabled, setEnabled] = useState(record?.enabled ?? true);
  const [options, setOptions] = useState<RecordOptions>(record?.options ?? DEFAULT_OPTIONS);
  const [serverError, setServerError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const ids = { source: useId(), domain: useId(), cors: useId(), timeout: useId() };

  const sourceCheck = sourceSchema.safeParse(source);
  const sourceError = source && !sourceCheck.success ? sourceCheck.error.issues[0]?.message : null;
  const domainCheck = checkDomain(domain, servedTlds);
  const domainError = domain && !domainCheck.ok ? domainCheck.error : null;
  const canSubmit = sourceCheck.success && domainCheck.ok && !submitting;

  function changeSource(value: string) {
    setSource(value);
    if (!domainEdited) {
      setDomain(defaultDomainFromSource(value));
    }
  }

  function changeOption<K extends keyof RecordOptions>(key: K, value: RecordOptions[K]) {
    setOptions((current) => ({ ...current, [key]: value }));
  }

  function changeCors(cors: CorsMode) {
    // Origin/Referer are dropped by default only when CORS is answered locally.
    setOptions((current) => ({ ...current, cors, dropOriginReferer: cors === "reflect" }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setServerError(null);
    try {
      await onSubmit({ source, domain, enabled, options });
    } catch (error) {
      setServerError(error instanceof ApiError ? error : new ApiError("", String(error)));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold">{record ? "Edit record" : "Add record"}</h2>

      <Field
        id={ids.source}
        label="Source"
        hint="Upstream base URL, may include a base path"
        error={sourceError}
      >
        <input
          id={ids.source}
          value={source}
          onChange={(event) => changeSource(event.target.value)}
          placeholder="https://api.example.com/v1"
          className={inputClass}
        />
      </Field>

      <Field
        id={ids.domain}
        label="Local domain"
        hint={`Served TLDs: ${servedTlds.map((tld) => `.${tld}`).join(", ")}`}
        error={domainError}
      >
        <input
          id={ids.domain}
          value={domain}
          onChange={(event) => {
            setDomainEdited(true);
            setDomain(event.target.value);
          }}
          placeholder="api.localhost"
          className={inputClass}
        />
      </Field>

      <Checkbox label="Enabled" checked={enabled} onChange={setEnabled} />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">CORS</legend>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={ids.cors}>Mode</label>
          <select
            id={ids.cors}
            value={options.cors}
            onChange={(event) => changeCors(event.target.value as CorsMode)}
            className={inputClass}
          >
            {CORS_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode === "reflect"
                  ? "Reflect (answer CORS locally)"
                  : "Pass-through (upstream decides)"}
              </option>
            ))}
          </select>
        </div>
        <Checkbox
          label="Drop Origin and Referer toward upstream"
          checked={options.dropOriginReferer}
          onChange={(value) => changeOption("dropOriginReferer", value)}
        />
      </fieldset>

      <ExtraHeaders
        headers={options.extraHeaders}
        onChange={(headers) => changeOption("extraHeaders", headers)}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Responses</legend>
        <Checkbox
          label="Rewrite Set-Cookie (drop Domain, set Secure; SameSite=None)"
          checked={options.rewriteSetCookie}
          onChange={(value) => changeOption("rewriteSetCookie", value)}
        />
        <Checkbox
          label="Rewrite Location redirects that point at the source"
          checked={options.rewriteLocation}
          onChange={(value) => changeOption("rewriteLocation", value)}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Connection</legend>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={ids.timeout}>Timeout (seconds)</label>
          <input
            id={ids.timeout}
            type="number"
            min={1}
            max={600}
            value={options.timeoutSeconds}
            onChange={(event) => changeOption("timeoutSeconds", Number(event.target.value))}
            className={`${inputClass} w-28`}
          />
        </div>
        <Checkbox
          label="Skip upstream TLS verification"
          checked={options.skipTlsVerify}
          onChange={(value) => changeOption("skipTlsVerify", value)}
        />
        {options.skipTlsVerify && (
          <p className="text-xs text-red-600 dark:text-red-400">
            Any certificate is accepted, so traffic to this upstream can be intercepted. Use only
            for self-signed staging servers.
          </p>
        )}
      </fieldset>

      {serverError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {serverError.message}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </button>
        <button type="submit" disabled={!canSubmit} className={primaryButtonClass}>
          {record ? "Save" : "Add"}
        </button>
      </div>
    </form>
  );
}

function ExtraHeaders({
  headers,
  onChange,
}: {
  headers: RecordOptions["extraHeaders"];
  onChange: (headers: RecordOptions["extraHeaders"]) => void;
}) {
  function update(index: number, change: Partial<{ name: string; value: string }>) {
    onChange(headers.map((header, i) => (i === index ? { ...header, ...change } : header)));
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Extra request headers</legend>
      <p className="text-xs text-zinc-500">
        Added to every upstream request. Stored in plain text in
        ~/.config/local-proxy/local-proxy.db.
      </p>
      {headers.map((header, index) => (
        // Rows have no stable id; they are only added at the end or removed.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <div key={index} className="flex gap-2">
          <input
            aria-label="Header name"
            value={header.name}
            onChange={(event) => update(index, { name: event.target.value })}
            placeholder="X-Api-Key"
            className={`${inputClass} w-1/3`}
          />
          <input
            aria-label="Header value"
            value={header.value}
            onChange={(event) => update(index, { value: event.target.value })}
            className={`${inputClass} flex-1`}
          />
          <button
            type="button"
            aria-label={`Remove header ${header.name}`}
            onClick={() => onChange(headers.filter((_, i) => i !== index))}
            className={secondaryButtonClass}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...headers, { name: "", value: "" }])}
        className={`${secondaryButtonClass} self-start`}
      >
        Add header
      </button>
    </fieldset>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  error: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      ) : (
        <span className="text-xs text-zinc-500">{hint}</span>
      )}
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-zinc-900 dark:accent-zinc-100"
      />
      {label}
    </label>
  );
}

const inputClass =
  "rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const primaryButtonClass =
  "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const secondaryButtonClass =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
