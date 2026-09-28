import { rm } from "node:fs/promises";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";

// The published package serves this build: bunfig.toml (and its Tailwind
// plugin) only applies when Bun runs from this repo, not from node_modules.
const outdir = join(import.meta.dir, "..", "dist", "web");

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
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}
for (const output of result.outputs) {
  console.log(`${output.path.slice(outdir.length + 1)}  ${(output.size / 1024).toFixed(1)} KB`);
}
