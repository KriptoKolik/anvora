// Bundles src/app.js (app + Ammora SDK + viem) into dist/ as a static site.
//   npm install
//   npm run build   -> dist/index.html, dist/app.js, dist/style.css
import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  outfile: "dist/app.js",
  logLevel: "info",
});
await copyFile("src/index.html", "dist/index.html");
await copyFile("src/style.css", "dist/style.css");
console.log("Built dist/. Preview with: npm run preview");
