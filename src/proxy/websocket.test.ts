import { expect, mock, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { type WebSocketBridge, webSocketBridgeHandlers } from "./websocket";

function fakeBrowserSide(bridge: WebSocketBridge) {
  const client = { data: bridge, send: mock(), close: mock() };
  return client as unknown as ServerWebSocket<WebSocketBridge> & typeof client;
}

test("opening the browser side delivers messages the upstream sent before it existed", () => {
  const bridge: WebSocketBridge = {
    upstream: {} as WebSocket,
    client: null,
    pending: ["first", "second"],
    upstreamClose: null,
  };
  const client = fakeBrowserSide(bridge);

  webSocketBridgeHandlers.open?.(client);

  expect(client.send.mock.calls).toEqual([["first"], ["second"]]);
  expect(bridge.pending).toEqual([]);
  expect(bridge.client).toBe(client);
  expect(client.close).not.toHaveBeenCalled();
});

test("an upstream that closed before the browser side opened closes it with the same code", () => {
  const bridge: WebSocketBridge = {
    upstream: {} as WebSocket,
    client: null,
    pending: ["last words"],
    upstreamClose: { code: 4002, reason: "gone" },
  };
  const client = fakeBrowserSide(bridge);

  webSocketBridgeHandlers.open?.(client);

  expect(client.send.mock.calls).toEqual([["last words"]]);
  expect(client.close.mock.calls).toEqual([[4002, "gone"]]);
});

test("close codes that may not be sent become a plain close", () => {
  const upstream = { close: mock() };
  const bridge = { upstream } as unknown as WebSocketBridge;

  webSocketBridgeHandlers.close?.(fakeBrowserSide(bridge), 1006, "");
  webSocketBridgeHandlers.close?.(fakeBrowserSide(bridge), 4000, "done");

  expect(upstream.close.mock.calls).toEqual([[], [4000, "done"]]);
});
