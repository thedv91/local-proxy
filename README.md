# local-proxy

A local dev tool that puts remote APIs behind local HTTPS domains. Point your frontend's API base URL at `https://api-car.localhost` and local-proxy forwards each request to the real API, answering CORS locally and adjusting headers, cookies and redirects as configured per record.

[portless](https://github.com/vercel-labs/portless) provides the domains and HTTPS. It can only route a name to a local port, so local-proxy runs one listener per record on `127.0.0.1` and registers it with `portless alias <name> <port>`.

## Install

Requires Bun 1.4 and Node 24 (for portless).

```sh
npm install -g portless
```

local-proxy is published as `local-api-proxy`. Run it without installing:

```sh
bunx local-api-proxy
```

`npx local-api-proxy` also works when Bun is on your PATH: the `local-proxy` command runs its TypeScript with Bun. To keep the command around, install it globally with `bun add -g local-api-proxy` and run `local-proxy`.

## Start portless

```sh
portless proxy start
```

The proxy binds port 443, so the first start asks for sudo. It also creates a local CA in `~/.portless` and trusts it for your user. By default it serves `.localhost`. To serve other TLDs, pass every TLD you want, including `localhost` if you still need it:

```sh
portless proxy stop
portless proxy start --tld localhost --tld test
```

`portless doctor` checks the proxy, DNS and CA trust.

## Run local-proxy

```sh
local-proxy              # or: bunx local-api-proxy
local-proxy --port 8080  # admin UI and API on another port
local-proxy --help
```

The admin UI and JSON API listen on http://127.0.0.1:7777 unless `--port` says otherwise. local-proxy also registers itself as https://local-proxy.localhost.

On startup it starts every enabled record and registers its alias again. Ctrl+C (SIGINT) or SIGTERM removes the aliases it registered. Records and the request log live in a SQLite database, `~/.config/local-proxy/local-proxy.db`. If a `records.json` from an earlier version is there, its records are imported on the first start and the file is renamed to `records.json.imported`.

If portless is missing or its proxy is not running, the UI shows a banner and stderr says how to fix it. Records still listen on `127.0.0.1:<port>`, but their domains will not resolve.

## Add a record

Click "Add record" and fill in:

- Source: the upstream base URL, which may include a base path, e.g. `https://api.example.com/v1`.
- Local domain: suggested from the source host (`api.localhost` for the example above). The part before the TLD becomes the portless name, and the TLD must be one the proxy serves.

portless registers a name under every TLD it serves, so `api.localhost` and `api.test` would both claim the name `api`. local-proxy rejects the second one. It also refuses a name that another app already registered as a portless alias, and never uses `--force`, which would kill the process that owns a route.

Each record gets its own port. The port is saved and reused after a restart unless something else has taken it.

## Record options

- Enabled: turn a record off without deleting it. Its listener stops and its alias is removed.
- CORS mode:
  - Reflect (default): local-proxy answers preflight requests itself without calling upstream. On responses it replaces the upstream's `Access-Control-*` headers, echoes the request's `Origin` with `Access-Control-Allow-Credentials: true`, exposes the response headers, and adds `Vary: Origin`.
  - Pass-through: CORS is left entirely to the upstream.
- Drop Origin/Referer: removes both headers from upstream requests, so an upstream origin allowlist does not reject `http://localhost:5100`. On by default in reflect mode.
- Extra request headers: added to or overriding headers on every upstream request. They are stored in plain text in `local-proxy.db`.
- Rewrite Set-Cookie: removes `Domain` and sets `Secure; SameSite=None`, so upstream cookies stick on the local domain even though the frontend runs on a different site.
- Rewrite Location: a redirect to the source origin under the source base path is rewritten to the local domain, with the base path removed. `https://api.example.com/v1/login` becomes `https://api-car.localhost/login`. Other redirects are left alone.
- Timeout: seconds the whole upstream response may take, body included (default 30). A timeout before the headers arrive returns 504; a timeout while the body streams cuts the response short, so raise it for long downloads or event streams.
- Skip upstream TLS verification: accepts any upstream certificate, for self-signed staging servers. Off by default and shown as a red "TLS verify off" badge.

Every record also:

- forwards to the source base URL plus the incoming path and query;
- lets the upstream see its own `Host`, and drops the `X-Forwarded-*` headers portless adds;
- drops hop-by-hop headers in both directions and forwards everything else, including `Authorization` and `Cookie`;
- drops the upstream's `Alt-Svc`, `NEL`, `Report-To` and `Reporting-Endpoints` headers, which would otherwise send the browser to HTTP/3 on the local domain and report its network errors upstream;
- passes compressed responses through unchanged and hands redirects to the browser;
- returns 502 when the upstream cannot be reached and 504 on timeout, with a plain-text message naming the record (and CORS headers in reflect mode).

The request log keeps the last 10,000 requests across records in the database, so it survives restarts. The UI shows the newest 200.

## WebSockets

A WebSocket to `wss://api-car.localhost/socket` is relayed to the source with `ws://` or `wss://` in place of `http://` or `https://`. local-proxy opens the upstream connection first and accepts the browser's upgrade only once the upstream has, so:

- the upstream handshake follows the same header rules as HTTP requests (own `Host`, Origin dropped when that option is on, extra headers added, cookies forwarded);
- the browser gets the subprotocol the upstream picked;
- a refused handshake gives 502 and one that takes longer than the record's timeout gives 504. Bun's WebSocket client does not report the upstream's status, so the 502 message does not include it.

Text and binary messages and close codes are relayed both ways. Disabling or deleting a record closes its open WebSockets. The request log shows each connection once, as `WS` with status 101.

## Calling local domains from Node

The portless CA is trusted by your browsers, but Node does not read the system trust store. Give Node processes (SSR, scripts, tests) the CA explicitly:

```sh
NODE_EXTRA_CA_CERTS=~/.portless/ca.pem node server.js
```

## Development

```sh
bun install
bun dev             # from this repo, with UI hot reload; restart it after backend changes
bun start           # from this repo, production mode
bun run build       # bundle the UI with Tailwind into dist/web (runs before npm pack/publish)
bun test            # unit, integration and UI tests
bun run typecheck   # tsc --noEmit
bun run lint        # Biome lint and format check
bun run format      # Biome, applying fixes
```

## License

MIT. See [LICENSE](LICENSE).
