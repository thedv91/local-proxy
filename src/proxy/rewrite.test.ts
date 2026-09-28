import { describe, expect, test } from "bun:test";
import { rewriteLocation, rewriteSetCookie } from "./rewrite";

describe("rewriteSetCookie", () => {
  test("drops Domain and makes the cookie cross-site", () => {
    expect(
      rewriteSetCookie("session=abc; Domain=.example.com; Path=/; HttpOnly; SameSite=Lax"),
    ).toBe("session=abc; Path=/; HttpOnly; Secure; SameSite=None");
  });

  test("does not duplicate an existing Secure", () => {
    expect(rewriteSetCookie("a=1; Secure; Max-Age=60")).toBe(
      "a=1; Max-Age=60; Secure; SameSite=None",
    );
  });

  test("keeps values that contain = and commas in Expires", () => {
    expect(rewriteSetCookie("t=x=y; Expires=Wed, 21 Oct 2026 07:28:00 GMT")).toBe(
      "t=x=y; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Secure; SameSite=None",
    );
  });
});

describe("rewriteLocation", () => {
  const local = "https://api-car.localhost";

  test("maps the source origin to the local domain", () => {
    expect(
      rewriteLocation("https://api.example.com/login?next=%2F", "https://api.example.com", local),
    ).toBe("https://api-car.localhost/login?next=%2F");
  });

  test("strips the source base path", () => {
    const source = "https://api.example.com/v1";
    expect(rewriteLocation("https://api.example.com/v1/cars/7", source, local)).toBe(
      "https://api-car.localhost/cars/7",
    );
    expect(rewriteLocation("/v1/cars", source, local)).toBe("https://api-car.localhost/cars");
    expect(rewriteLocation("https://api.example.com/v1", source, local)).toBe(
      "https://api-car.localhost/",
    );
  });

  test.each([
    ["another origin", "https://auth.example.com/login"],
    ["outside the base path", "https://api.example.com/v2/cars"],
    ["a path outside the base path", "/auth/login"],
    ["a relative path", "next?page=2"],
  ])("leaves %s unchanged", (_, location) => {
    expect(rewriteLocation(location, "https://api.example.com/v1", local)).toBe(location);
  });
});
