#!/usr/bin/env node
import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

mkdirSync(resolve(root, "deploy"), { recursive: true });

// Copy HTML
copyFileSync(
  resolve(root, "src/html/index.html"),
  resolve(root, "deploy/index.html")
);

await esbuild.build({
  entryPoints: [resolve(root, "src/index.ts")],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: resolve(root, "deploy/app.js"),
  sourcemap: true,
  minify: false,
  logLevel: "info",
});

console.log("Build complete → deploy/");
