import type { RecordOptions } from "../records/schema";

// RFC 9110 §7.6.1 connection-specific headers, plus the non-standard proxy-connection.
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

// Added by the portless proxy in front of each listener. Dropped for the same
// reason as Host: the upstream should see a request as if it were called directly.
const PORTLESS_ADDED_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-portless-hops",
];

// Upstream response headers that bind behavior to the host the browser talked
// to. Passed through, they would apply to the local domain: Alt-Svc sends the
// browser to HTTP/3 on 127.0.0.1:443, which portless does not serve, and the
// reporting headers make it send the local domain's network errors upstream.
const UPSTREAM_HOST_BOUND_HEADERS = ["alt-svc", "nel", "report-to", "reporting-endpoints"];

/** Copy headers without hop-by-hop ones, including any the Connection header names. */
export function withoutHopByHop(headers: Headers): Headers {
  const result = new Headers(headers);
  const listedInConnection = (headers.get("connection") ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  for (const name of [...HOP_BY_HOP_HEADERS, ...listedInConnection]) {
    result.delete(name);
  }
  return result;
}

export function buildUpstreamHeaders(incoming: Headers, options: RecordOptions): Headers {
  const headers = withoutHopByHop(incoming);
  // Without its own Host, fetch sets the upstream's host from the URL.
  headers.delete("host");
  for (const name of PORTLESS_ADDED_HEADERS) {
    headers.delete(name);
  }
  if (options.dropOriginReferer) {
    // Upstream origin allowlists only know the real frontends, so they would
    // reject a request that carries a local origin such as http://localhost:5100.
    headers.delete("origin");
    headers.delete("referer");
  }
  for (const { name, value } of options.extraHeaders) {
    headers.set(name, value);
  }
  return headers;
}

export function buildResponseHeaders(upstream: Headers): Headers {
  const headers = withoutHopByHop(upstream);
  for (const name of UPSTREAM_HOST_BOUND_HEADERS) {
    headers.delete(name);
  }
  return headers;
}

export function isPreflight(request: Request): boolean {
  return request.method === "OPTIONS" && request.headers.has("access-control-request-method");
}

/** Answer a CORS preflight locally, allowing whatever the browser asked for. */
export function preflightResponse(request: Request): Response {
  const headers = new Headers({
    "access-control-allow-methods": request.headers.get("access-control-request-method") ?? "",
    "access-control-max-age": "600",
    vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  });
  const requestedHeaders = request.headers.get("access-control-request-headers");
  if (requestedHeaders) {
    headers.set("access-control-allow-headers", requestedHeaders);
  }
  setReflectedOrigin(headers, request.headers.get("origin"));
  return new Response(null, { status: 204, headers });
}

/** Replace the upstream's CORS headers with ones that allow the calling origin. */
export function applyReflectCors(headers: Headers, origin: string | null): void {
  for (const name of [...headers.keys()]) {
    if (name.startsWith("access-control-")) {
      headers.delete(name);
    }
  }
  // "*" is taken literally on credentialed requests, so list the real names.
  const exposed = [...headers.keys()].filter((name) => name !== "set-cookie");
  if (exposed.length > 0) {
    headers.set("access-control-expose-headers", exposed.join(", "));
  }
  setReflectedOrigin(headers, origin);
  const varies = (headers.get("vary") ?? "").split(",").map((name) => name.trim().toLowerCase());
  if (!varies.includes("origin")) {
    headers.append("vary", "Origin");
  }
}

function setReflectedOrigin(headers: Headers, origin: string | null): void {
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
  }
}
