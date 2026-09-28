import type { ProxyRecord } from "../records/schema";
import {
  applyReflectCors,
  buildResponseHeaders,
  buildUpstreamHeaders,
  isPreflight,
  preflightResponse,
} from "./headers";
import { rewriteLocation, rewriteSetCookie } from "./rewrite";
import { joinUpstreamUrl } from "./upstream-url";

/** Forward one request from a record's local domain to its upstream and shape the response. */
export async function handleProxyRequest(record: ProxyRecord, request: Request): Promise<Response> {
  const { options } = record;
  const reflectCors = options.cors === "reflect";
  const origin = request.headers.get("origin");

  if (reflectCors && isPreflight(request)) {
    return preflightResponse(request);
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = joinUpstreamUrl(record.source, incomingUrl);
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: buildUpstreamHeaders(request.headers, options),
      body: await readRequestBody(request),
      // Bun decompresses by default but keeps `content-encoding: gzip`, so the
      // browser would try to gunzip plain bytes (ERR_CONTENT_DECODING_FAILED).
      decompress: false,
      // Redirects must reach the browser (and the Location rewrite), not be followed here.
      redirect: "manual",
      // Bun's fetch has no timeout option; the abort surfaces as a TimeoutError (→ 504).
      // The signal also covers the streamed body, so the limit is for the whole response.
      signal: AbortSignal.timeout(options.timeoutSeconds * 1000),
      // Opt-in per record for self-signed staging upstreams; flagged in the UI.
      ...(options.skipTlsVerify && { tls: { rejectUnauthorized: false } }),
    });
  } catch (error) {
    return upstreamFailureResponse(record, upstreamUrl, error, reflectCors, origin);
  }

  const headers = buildResponseHeaders(upstream.headers);
  if (options.rewriteSetCookie) {
    // getSetCookie keeps cookies apart; get("set-cookie") joins them with commas.
    const cookies = upstream.headers.getSetCookie();
    headers.delete("set-cookie");
    for (const cookie of cookies) {
      headers.append("set-cookie", rewriteSetCookie(cookie));
    }
  }
  const location = headers.get("location");
  if (options.rewriteLocation && location) {
    headers.set("location", rewriteLocation(location, record.source, localOrigin(request)));
  }
  if (reflectCors) {
    applyReflectCors(headers, origin);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function readRequestBody(request: Request): Promise<ArrayBuffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }
  return request.arrayBuffer();
}

/**
 * The origin the browser used. portless keeps the Host header and reports its
 * own scheme in X-Forwarded-Proto; without portless (tests, direct calls) the
 * listener's plain http applies.
 */
function localOrigin(request: Request): string {
  const url = new URL(request.url);
  const scheme = request.headers.get("x-forwarded-proto") ?? url.protocol.slice(0, -1);
  return `${scheme}://${url.host}`;
}

export function upstreamFailureResponse(
  record: ProxyRecord,
  upstreamUrl: string,
  error: unknown,
  reflectCors: boolean,
  origin: string | null,
): Response {
  const timedOut = error instanceof DOMException && error.name === "TimeoutError";
  const reason = error instanceof Error ? error.message : String(error);
  const message = timedOut
    ? `local-proxy: ${record.domain} timed out after ${record.options.timeoutSeconds}s waiting for ${upstreamUrl}`
    : `local-proxy: ${record.domain} could not reach ${upstreamUrl}: ${reason}`;
  const headers = new Headers({ "content-type": "text/plain; charset=utf-8" });
  if (reflectCors) {
    // Keep CORS on errors so the browser shows this message instead of a CORS failure.
    applyReflectCors(headers, origin);
  }
  return new Response(message, { status: timedOut ? 504 : 502, headers });
}
