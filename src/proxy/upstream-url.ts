/** Source base URL (trailing slash trimmed) + the incoming path and query. */
export function joinUpstreamUrl(source: string, incoming: URL): string {
  return source.replace(/\/+$/, "") + incoming.pathname + incoming.search;
}
