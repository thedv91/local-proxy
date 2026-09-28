import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import type { ProxyRecord, RecordOptions } from "../records/schema";
import { upstreamFailureResponse } from "./handle-request";
import { buildUpstreamHeaders } from "./headers";
import { joinUpstreamUrl } from "./upstream-url";

type Message = string | ArrayBuffer | Uint8Array;

/** One browser WebSocket and the upstream WebSocket it is relayed to. */
export interface WebSocketBridge {
  upstream: WebSocket;
  /** Null until Bun opens the browser side, just after the upgrade. */
  client: ServerWebSocket<WebSocketBridge> | null;
  /** Upstream messages that arrived before the browser side opened. */
  pending: Message[];
  /** Set when the upstream closed before the browser side opened. */
  upstreamClose: { code: number; reason: string } | null;
}

// The client builds its own handshake; these belong to the browser's handshake.
const BROWSER_HANDSHAKE_HEADERS = [
  "sec-websocket-extensions",
  "sec-websocket-key",
  "sec-websocket-protocol",
  "sec-websocket-version",
];

// bun-types defers to the DOM lib's WebSocket when tsconfig includes it (the UI
// needs it), which hides Bun's constructor overload that takes headers and TLS.
const BunWebSocket = WebSocket as unknown as new (
  url: string,
  options: Bun.WebSocketOptions,
) => WebSocket;

export function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

/**
 * Connect to the upstream first and only then accept the browser's upgrade,
 * so a refused or unreachable upstream still gets a 502/504 and the browser
 * receives the subprotocol the upstream picked.
 */
export async function handleWebSocketUpgrade(
  record: ProxyRecord,
  request: Request,
  server: Server<WebSocketBridge>,
): Promise<Response | undefined> {
  const upstreamUrl = joinUpstreamUrl(record.source, new URL(request.url)).replace(/^http/, "ws");
  const bridge = openUpstream(upstreamUrl, request, record.options);
  try {
    await upstreamOpened(bridge.upstream, record.options.timeoutSeconds);
  } catch (error) {
    // Browsers do not apply CORS to WebSockets.
    return upstreamFailureResponse(record, upstreamUrl, error, false, null);
  }

  const { protocol } = bridge.upstream;
  const accepted = server.upgrade(request, {
    data: bridge,
    headers: protocol ? { "sec-websocket-protocol": protocol } : undefined,
  });
  if (!accepted) {
    bridge.upstream.close();
    return new Response("local-proxy: WebSocket upgrade failed", { status: 400 });
  }
  return undefined;
}

/** The browser side of every bridge; Bun.serve takes one handler set per server. */
export const webSocketBridgeHandlers: WebSocketHandler<WebSocketBridge> = {
  open(client) {
    const bridge = client.data;
    bridge.client = client;
    for (const message of bridge.pending) {
      client.send(message);
    }
    bridge.pending = [];
    if (bridge.upstreamClose) {
      closeWith(client, bridge.upstreamClose.code, bridge.upstreamClose.reason);
    }
  },
  message(client, message) {
    client.data.upstream.send(message);
  },
  close(client, code, reason) {
    closeWith(client.data.upstream, code, reason);
  },
};

function openUpstream(url: string, request: Request, options: RecordOptions): WebSocketBridge {
  const headers = buildUpstreamHeaders(request.headers, options);
  for (const name of BROWSER_HANDSHAKE_HEADERS) {
    headers.delete(name);
  }
  const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((protocol) => protocol.trim())
    .filter(Boolean);

  const upstreamOptions: Bun.WebSocketOptions = {
    headers: Object.fromEntries(headers),
    protocols,
    // Same opt-in as for HTTP requests; flagged in the UI.
    ...(options.skipTlsVerify && { tls: { rejectUnauthorized: false } }),
  };
  const upstream = new BunWebSocket(url, upstreamOptions);
  upstream.binaryType = "arraybuffer";
  const bridge: WebSocketBridge = { upstream, client: null, pending: [], upstreamClose: null };

  // Attached before the socket opens: a message the upstream sends right after
  // its handshake can arrive before the browser side exists, and is queued.
  upstream.onmessage = (event) => {
    if (bridge.client) {
      bridge.client.send(event.data);
    } else {
      bridge.pending.push(event.data);
    }
  };
  upstream.onclose = (event) => {
    if (bridge.client) {
      closeWith(bridge.client, event.code, event.reason);
    } else {
      bridge.upstreamClose = { code: event.code, reason: event.reason };
    }
  };
  return bridge;
}

function upstreamOpened(upstream: WebSocket, timeoutSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      upstream.close();
      // Same error fetch raises on AbortSignal.timeout, so the failure maps to 504.
      reject(new DOMException("WebSocket handshake timed out", "TimeoutError"));
    }, timeoutSeconds * 1000);
    upstream.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    upstream.onerror = (event) => {
      clearTimeout(timer);
      reject(new Error((event as ErrorEvent).message || "WebSocket connection failed"));
    };
  });
}

/**
 * 1005 (no status), 1006 (abnormal) and 1015 (TLS failure) only describe a
 * close that happened; they may not be sent in a close frame.
 */
function closeWith(
  socket: WebSocket | ServerWebSocket<WebSocketBridge>,
  code: number,
  reason: string,
) {
  if (code === 1005 || code === 1006 || code === 1015) {
    socket.close();
  } else {
    socket.close(code, reason);
  }
}
