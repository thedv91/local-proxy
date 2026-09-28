// Names portless treats as subcommands (portless 0.15.6, src/cli.ts).
export const RESERVED_NAMES = [
  "run",
  "get",
  "alias",
  "hosts",
  "list",
  "doctor",
  "trust",
  "clean",
  "prune",
  "proxy",
  "service",
] as const;

export type DomainCheck = { ok: true; name: string; tld: string } | { ok: false; error: string };

// Same pattern and limits as portless's parseHostname (src/utils.ts).
const namePattern = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const MAX_LABEL_LENGTH = 63;
const MAX_HOSTNAME_LENGTH = 253;

/**
 * Split a local domain into the portless alias name and the TLD, and check both
 * against portless's rules and the TLDs its proxy serves.
 */
export function checkDomain(input: string, servedTlds: readonly string[]): DomainCheck {
  const domain = input.trim().toLowerCase();
  if (!domain) {
    return { ok: false, error: "Domain is required" };
  }

  // Longest match first: a served TLD may itself contain dots, e.g. "dev.example.com".
  const tld = [...servedTlds]
    .sort((a, b) => b.length - a.length)
    .find((candidate) => domain.endsWith(`.${candidate}`));
  if (!tld) {
    return { ok: false, error: unservedTldMessage(domain, servedTlds) };
  }

  const name = domain.slice(0, -(tld.length + 1));
  if (name.includes("..") || !namePattern.test(name)) {
    return {
      ok: false,
      error: `Invalid name "${name}": use lowercase letters, digits, hyphens and dots`,
    };
  }
  const longLabel = name.split(".").find((label) => label.length > MAX_LABEL_LENGTH);
  if (longLabel) {
    return {
      ok: false,
      error: `Label "${longLabel}" is longer than ${MAX_LABEL_LENGTH} characters`,
    };
  }
  if (domain.length > MAX_HOSTNAME_LENGTH) {
    return { ok: false, error: `Domain is longer than ${MAX_HOSTNAME_LENGTH} characters` };
  }
  if ((RESERVED_NAMES as readonly string[]).includes(name)) {
    return { ok: false, error: `"${name}" is reserved by portless` };
  }
  // portless strips a served TLD from the end of an alias name before adding each
  // TLD back, so "api.localhost.test" would register "api.test", not what was typed.
  const nameEndsInTld = servedTlds.some((served) => name === served || name.endsWith(`.${served}`));
  if (nameEndsInTld) {
    return { ok: false, error: `Name "${name}" must not end with a portless TLD` };
  }

  return { ok: true, name, tld };
}

function unservedTldMessage(domain: string, servedTlds: readonly string[]): string {
  const guessedTld = domain.includes(".") ? domain.slice(domain.lastIndexOf(".") + 1) : domain;
  const served = servedTlds.map((tld) => `.${tld}`).join(", ");
  const tldFlags = [...servedTlds, guessedTld].map((tld) => `--tld ${tld}`).join(" ");
  return (
    `TLD ".${guessedTld}" is not served by portless (serving ${served}). ` +
    `Enable it with: portless proxy stop && portless proxy start ${tldFlags}`
  );
}

/** "https://api.example.com/v1" → "api.localhost" */
export function defaultDomainFromSource(source: string): string {
  if (!URL.canParse(source.trim())) {
    return "";
  }
  const firstLabel = new URL(source.trim()).hostname.split(".")[0];
  return firstLabel ? `${firstLabel}.localhost` : "";
}
