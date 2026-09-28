import { describe, expect, test } from "bun:test";
import { checkDomain, defaultDomainFromSource } from "./domain";

describe("checkDomain", () => {
  test("splits a domain into the portless name and TLD", () => {
    expect(checkDomain("api-car.localhost", ["localhost"])).toEqual({
      ok: true,
      name: "api-car",
      tld: "localhost",
    });
  });

  test("keeps dots in the name", () => {
    expect(checkDomain("api.car.test", ["localhost", "test"])).toEqual({
      ok: true,
      name: "api.car",
      tld: "test",
    });
  });

  test("prefers the longest served TLD", () => {
    expect(checkDomain("api.dev.example.com", ["com", "dev.example.com"])).toMatchObject({
      name: "api",
      tld: "dev.example.com",
    });
  });

  test("normalizes case and whitespace", () => {
    expect(checkDomain("  API.Localhost ", ["localhost"])).toMatchObject({ ok: true, name: "api" });
  });

  test("rejects a TLD the proxy does not serve and says how to enable it", () => {
    const result = checkDomain("api.car.test", ["localhost"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('TLD ".test" is not served');
      expect(result.error).toContain("portless proxy start --tld localhost --tld test");
    }
  });

  test.each(["run", "alias", "proxy", "list", "service"])(
    "rejects the reserved name %s",
    (name) => {
      const result = checkDomain(`${name}.localhost`, ["localhost"]);
      expect(result).toEqual({ ok: false, error: `"${name}" is reserved by portless` });
    },
  );

  test("allows a reserved word as one label of a longer name", () => {
    expect(checkDomain("proxy.api.localhost", ["localhost"]).ok).toBe(true);
  });

  test.each([
    ["-api.localhost", "leading hyphen"],
    ["api-.localhost", "trailing hyphen"],
    ["a..b.localhost", "empty label"],
    ["api_car.localhost", "underscore"],
    [".localhost", "empty name"],
    [`${"a".repeat(64)}.localhost`, "label over 63 characters"],
  ])("rejects %s (%s)", (domain) => {
    expect(checkDomain(domain, ["localhost"]).ok).toBe(false);
  });

  test("rejects a name ending in a served TLD, which portless would strip", () => {
    expect(checkDomain("api.localhost.test", ["localhost", "test"]).ok).toBe(false);
  });

  test("requires a domain", () => {
    expect(checkDomain("", ["localhost"])).toEqual({ ok: false, error: "Domain is required" });
  });
});

describe("defaultDomainFromSource", () => {
  test("uses the first label of the source host", () => {
    expect(defaultDomainFromSource("https://api.example.com/v1")).toBe("api.localhost");
    expect(defaultDomainFromSource("http://staging-api.car.io:8080")).toBe("staging-api.localhost");
  });

  test("returns nothing for an unparseable source", () => {
    expect(defaultDomainFromSource("api.example")).toBe("");
  });
});
