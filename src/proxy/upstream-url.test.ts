import { expect, test } from "bun:test";
import { joinUpstreamUrl } from "./upstream-url";

test.each([
  ["https://api.example.com", "/users?page=2", "https://api.example.com/users?page=2"],
  ["https://api.example.com/", "/users", "https://api.example.com/users"],
  ["https://api.example.com/v1", "/users/7?q=a%20b", "https://api.example.com/v1/users/7?q=a%20b"],
  ["https://api.example.com/v1/", "/", "https://api.example.com/v1/"],
])("%s + %s", (source, incoming, expected) => {
  expect(joinUpstreamUrl(source, new URL(incoming, "http://api.localhost"))).toBe(expected);
});
