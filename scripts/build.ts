import { rm } from "node:fs/promises";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";

// The published package serves this build: bunfig.toml (and its Tailwind
// plugin) only applies when Bun runs from this repo, not from node_modules.
export const DEFAULT_OUTDIR = join(import.meta.dir, "..", "dist", "web");

export async function buildUi(outdir: string) {
  await rm(outdir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "..", "src", "web", "index.html")],
    outdir,
    plugins: [tailwind],
    minify: true,
    target: "browser",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "UI build failed");
  }
  return result.outputs;
}

if (import.meta.main) {
  for (const output of await buildUi(DEFAULT_OUTDIR)) {
    const name = output.path.slice(DEFAULT_OUTDIR.length + 1);
    console.log(`${name}  ${(output.size / 1024).toFixed(1)} KB`);
  }
}
