import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createPortlessState, installFakePortless } from "../test/fake-portless";

const binPath = join(import.meta.dir, "local-proxy.ts");
let cwd: string;
let home: string;
let portlessState: Awaited<ReturnType<typeof createPortlessState>>;
let path: string;

beforeAll(async () => {
  const build = Bun.spawn([process.execPath, join(import.meta.dir, "..", "scripts", "build.ts")], {
    stdout: "ignore",
  });
  expect(await build.exited).toBe(0);
  cwd = await mkdtemp(join(tmpdir(), "local-proxy-cwd-"));
  home = await mkdtemp(join(tmpdir(), "local-proxy-home-"));
  portlessState = await createPortlessState();
  path = `${dirname(await installFakePortless())}:${process.env.PATH}`;
});

afterAll(async () => {
  for (const dir of [cwd, home, portlessState.stateDir]) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Run the published entry the way `bunx local-api-proxy` would: from another directory. */
function runBin(args: string[]) {
  return Bun.spawn([process.execPath, binPath, ...args], {
    cwd,
    env: { ...process.env, HOME: home, PORTLESS_STATE_DIR: portlessState.stateDir, PATH: path },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port as number;
  await probe.stop(true);
  return port;
}

async function waitFor(condition: () => Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await Bun.sleep(50);
  }
}

async function waitForAdmin(url: string) {
  await waitFor(async () => (await fetch(`${url}/api/status`).catch(() => null))?.ok === true);
}

test("serves the prebuilt UI with Tailwind styles when started outside the repo", async () => {
  const port = await freePort();
  const child = runBin(["--port", String(port)]);
  const admin = `http://127.0.0.1:${port}`;
  try {
    await waitForAdmin(admin);

    const html = await (await fetch(admin)).text();
    const cssHref = html.match(/href="\.?\/?([^"]+\.css)"/)?.[1];
    const jsSrc = html.match(/src="\.?\/?([^"]+\.js)"/)?.[1];
    const css = await (await fetch(`${admin}/${cssHref}`)).text();
    expect(css).toContain(".bg-zinc-900");
    expect((await fetch(`${admin}/${jsSrc}`)).headers.get("content-type")).toContain("javascript");

    expect(await (await fetch(`${admin}/api/records`)).json()).toEqual([]);
    expect(await Bun.file(join(home, ".config", "local-proxy", "local-proxy.db")).exists()).toBe(
      true,
    );
    // The admin alias is registered after the server starts answering.
    await waitFor(async () =>
      (await portlessState.routes()).some((route) => route.hostname === "local-proxy.localhost"),
    );
    expect(await portlessState.routes()).toEqual([
      { hostname: "local-proxy.localhost", port, pid: 0 },
    ]);
  } finally {
    child.kill("SIGINT");
  }
  expect(await child.exited).toBe(0);
  expect(await portlessState.routes()).toEqual([]);
});

test("--help and --version exit without starting a server", async () => {
  const help = runBin(["--help"]);
  expect(await help.exited).toBe(0);
  expect(await new Response(help.stdout).text()).toContain(
    "Usage: local-proxy [--port <admin port>]",
  );

  const version = runBin(["--version"]);
  expect(await version.exited).toBe(0);
  const { version: expected } = await Bun.file(join(import.meta.dir, "..", "package.json")).json();
  expect((await new Response(version.stdout).text()).trim()).toBe(expected);
});

test("rejects an invalid port", async () => {
  const child = runBin(["--port", "http"]);
  expect(await child.exited).toBe(2);
  expect(await new Response(child.stderr).text()).toContain('invalid --port "http"');
});
