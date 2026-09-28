import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createPortlessState, installFakePortless } from "../../test/fake-portless";
import { AliasConflictError, createPortless } from "./portless";

let bin: string;
let state: Awaited<ReturnType<typeof createPortlessState>>;

beforeAll(async () => {
  bin = await installFakePortless();
});

beforeEach(async () => {
  state = await createPortlessState();
});

afterEach(async () => {
  await rm(state.stateDir, { recursive: true, force: true });
});

test("reports a missing binary", async () => {
  const portless = createPortless({
    bin: join(state.stateDir, "missing"),
    stateDir: state.stateDir,
  });
  expect(await portless.status()).toMatchObject({
    installed: false,
    proxyRunning: false,
    problem: expect.stringContaining("npm install -g portless"),
  });
});

test("reports a proxy that is not running", async () => {
  const unused = Bun.serve({ port: 0, fetch: () => new Response() });
  await Bun.write(join(state.stateDir, "proxy.port"), String(unused.port));
  await unused.stop(true);

  const status = await createPortless({ bin, stateDir: state.stateDir }).status();
  expect(status).toMatchObject({ installed: true, proxyRunning: false });
  expect(status.problem).toContain("portless proxy start");
});

test("detects a running proxy by its X-Portless header", async () => {
  const proxy = Bun.serve({
    port: 0,
    // What the HTTPS proxy sends to a plain-HTTP request.
    fetch: () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/", "x-portless": "1" },
      }),
  });
  const proxyPort = proxy.port;
  await Bun.write(join(state.stateDir, "proxy.port"), String(proxyPort));

  const status = await createPortless({ bin, stateDir: state.stateDir }).status();
  await proxy.stop(true);
  expect(status).toMatchObject({ proxyRunning: true, proxyPort, problem: null });
});

test.each([
  ["missing files", {}, ["localhost"]],
  ["proxy.tlds lines", { "proxy.tlds": "localhost\ntest\n" }, ["localhost", "test"]],
  ["proxy.tlds JSON", { "proxy.tlds": '["test","dev.example.com"]' }, ["test", "dev.example.com"]],
  ["legacy proxy.tld", { "proxy.tld": "test" }, ["test"]],
])("reads served TLDs from %s", async (_, files, expected) => {
  for (const [name, content] of Object.entries(files)) {
    await Bun.write(join(state.stateDir, name), content);
  }
  expect(await createPortless({ bin, stateDir: state.stateDir }).servedTlds()).toEqual(expected);
});

test("an alias another app registered is not available unless we own the name", async () => {
  await state.writeRoutes([{ hostname: "api.localhost", port: 3000, pid: 0 }]);
  const portless = createPortless({ bin, stateDir: state.stateDir });
  await expect(portless.assertAliasAvailable("api", [])).rejects.toBeInstanceOf(AliasConflictError);
  await expect(portless.assertAliasAvailable("api", ["api"])).resolves.toBeUndefined();
  await expect(portless.assertAliasAvailable("cars", [])).resolves.toBeUndefined();
});

test("removing an alias that is not registered does not call portless", async () => {
  await createPortless({ bin, stateDir: state.stateDir }).removeAlias("api");
  expect(await state.calls()).toEqual([]);
});
