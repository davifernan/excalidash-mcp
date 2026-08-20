import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const output = resolve(root, "dist");
const require = createRequire(import.meta.url);
const excalidrawRoot = resolve(dirname(require.resolve("@excalidraw/excalidraw")), "../..");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: [resolve(here, "converter-app.js")],
  outfile: resolve(output, "converter.bundle.js"),
  bundle: true,
  // A classic script, not a module: the converter page is opened from a file://
  // URL, and a browser refuses to load a module from there — it has no origin
  // to check against. The bundle silently never ran, so the page never became
  // ready and every measurement timed out.
  format: "iife",
  platform: "browser",
  target: "chrome120",
  minify: true,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});
await cp(
  resolve(excalidrawRoot, "dist/prod/fonts"),
  resolve(output, "fonts"),
  { recursive: true },
);
