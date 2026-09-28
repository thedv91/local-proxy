import { describe, expect, test } from "bun:test";
import { DEFAULT_OPTIONS } from "../records/schema";
import {
  applyReflectCors,
  buildResponseHeaders,
  buildUpstreamHeaders,
  isPreflight,
  preflightResponse,
  withoutHopByHop,
} from "./headers";

describe("withoutHopByHop", () => {
  test("drops hop-by-hop headers and those named in Connection", () => {
    const headers = withoutHopByHop(
      new Headers({
        connection: "keep-alive, x-trace",
        "keep-alive": "timeout=5",
        "transfer-encoding": "chunked",
        upgrade: "h2c",
        "x-trace": "1",
        "content-type": "application/json",
      }),
    );
    expect([...headers.keys()]).toEqual(["content-type"]);
  });
});

describe("buildUpstreamHeaders", () => {
  const incoming = new Headers({
    host: "api.localhost",
    origin: "http://localhost:5100",
    referer: "http://localhost:5100/cars",
    authorization: "Bearer token",
    cookie: "session=1",
    "x-forwarded-for": "127.0.0.1",
    "x-forwarded-host": "api.localhost",
    "x-forwarded-proto": "https",
    "x-forwarded-port": "443",
    "x-portless-hops": "1",
  });

  test("drops Host and the headers portless adds, keeps credentials", () => {
    const headers = buildUpstreamHeaders(incoming, {
      ...DEFAULT_OPTIONS,
      dropOriginReferer: false,
    });
    expect(Object.fromEntries(headers)).toEqual({
      origin: "http://localhost:5100",
      referer: "http://localhost:5100/cars",
      authorization: "Bearer token",
      cookie: "session=1",
    });
  });

  test("drops Origin and Referer when the option is on", () => {
    const headers = buildUpstreamHeaders(incoming, DEFAULT_OPTIONS);
    expect(headers.has("origin")).toBe(false);
    expect(headers.has("referer")).toBe(false);
  });

  test("adds and overrides extra headers", () => {
    const headers = buildUpstreamHeaders(incoming, {
      ...DEFAULT_OPTIONS,
      extraHeaders: [
        { name: "X-Api-Key", value: "secret" },
        { name: "Authorization", value: "Basic abc" },
      ],
    });
    expect(headers.get("x-api-key")).toBe("secret");
    expect(headers.get("authorization")).toBe("Basic abc");
  });
});

describe("buildResponseHeaders", () => {
  test("drops hop-by-hop headers and ones bound to the upstream host", () => {
    const headers = buildResponseHeaders(
      new Headers({
        "alt-svc": 'h3=":443"; ma=86400',
        nel: '{"report_to":"heroku-nel","max_age":3600}',
        "report-to": '{"group":"heroku-nel","max_age":3600}',
        "reporting-endpoints": 'heroku-nel="https://nel.heroku.com/reports"',
        "transfer-encoding": "chunked",
        "content-type": "application/json",
        etag: 'W/"53"',
      }),
    );
    expect(Object.fromEntries(headers)).toEqual({
      "content-type": "application/json",
      etag: 'W/"53"',
    });
  });
});

describe("CORS reflect", () => {
  const preflight = new Request("http://api.localhost/cars", {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:5100",
      "access-control-request-method": "PATCH",
      "access-control-request-headers": "content-type, x-api-key",
    },
  });

  test("recognizes a preflight", () => {
    expect(isPreflight(preflight)).toBe(true);
    expect(isPreflight(new Request("http://api.localhost/", { method: "OPTIONS" }))).toBe(false);
  });

  test("answers a preflight with what the browser asked for", () => {
    const response = preflightResponse(preflight);
    expect(response.status).toBe(204);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "access-control-allow-origin": "http://localhost:5100",
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "PATCH",
      "access-control-allow-headers": "content-type, x-api-key",
    });
  });

  test("replaces upstream CORS headers and exposes the response headers", () => {
    const headers = new Headers({
      "access-control-allow-origin": "https://staging.example.com",
      "access-control-max-age": "60",
      "content-type": "application/json",
      "x-request-id": "abc",
      vary: "Accept-Encoding",
    });
    applyReflectCors(headers, "http://localhost:5100");
    expect(Object.fromEntries(headers)).toEqual({
      "access-control-allow-origin": "http://localhost:5100",
      "access-control-allow-credentials": "true",
      "access-control-expose-headers": "content-type, vary, x-request-id",
      "content-type": "application/json",
      "x-request-id": "abc",
      vary: "Accept-Encoding, Origin",
    });
  });

  test("does not repeat Origin when the upstream already varies on it", () => {
    const headers = new Headers({ vary: "Origin, Accept-Encoding" });
    applyReflectCors(headers, "http://localhost:5100");
    expect(headers.get("vary")).toBe("Origin, Accept-Encoding");
  });
});
