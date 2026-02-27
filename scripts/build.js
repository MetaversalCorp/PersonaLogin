#!/usr/bin/env node
import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, readdirSync } from "fs";
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

// Copy vendor directory
const vendorSrc = resolve(root, "src/html/vendor");
const vendorDest = resolve(root, "deploy/vendor");
function copyDirRecursive(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
copyDirRecursive(vendorSrc, vendorDest);

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
