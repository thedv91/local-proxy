import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { buildUi } from "./build";

let outdir: string;
let files: string[];

beforeAll(async () => {
  outdir = await mkdtemp(join(tmpdir(), "local-proxy-ui-"));
  files = (await buildUi(outdir)).map((output) => output.path);
});

afterAll(async () => {
  await rm(outdir, { recursive: true, force: true });
});

test("the CSS includes the Tailwind utilities the UI uses", async () => {
  const css = files.find((file) => file.endsWith(".css")) as string;
  expect(await Bun.file(css).text()).toContain(".bg-zinc-900");
});

// The dev server bundles differently, so only the production build shows
// whether the entry script survives minification (see src/web/frontend.tsx).
test("the built script renders the app", async () => {
  // Registered here, after Bun.build: happy-dom replaces fetch, URL and timers.
  GlobalRegistrator.register();
  try {
    document.body.innerHTML = '<div id="root"></div>';
    globalThis.fetch = (async (input: string) =>
      Response.json(
        String(input).includes("/api/status")
          ? {
              installed: true,
              proxyRunning: true,
              proxyPort: 443,
              tlds: ["localhost"],
              problem: null,
            }
          : [],
      )) as typeof fetch;

    const script = files.find((file) => file.endsWith(".js")) as string;
    await import(script);
    const deadline = Date.now() + 2000;
    while (!document.body.textContent?.includes("Add record") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(document.body.textContent).toContain("Add record");
    expect(document.body.textContent).toContain("No records yet.");
  } finally {
    await GlobalRegistrator.unregister();
  }
});
