// Bundles the mock-up and the engine into one self-contained HTML file.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "fs";

const result = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2019",
  write: false,
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = readFileSync("src/index.html", "utf8").replace("<!--APP-->", () => `<script>${js}</script>`);
mkdirSync("dist", { recursive: true });
// swarm-hive.html: page body only, for hosts that add their own document
// skeleton (Claude artifacts). index.html: a complete page, for GitHub Pages.
writeFileSync("dist/swarm-hive.html", html);
writeFileSync(
  "dist/index.html",
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${html.replace(/\n<div class="wrap">/, "\n</head>\n<body>\n<div class=\"wrap\">")}\n</body>\n</html>\n`
);
console.log(`dist/swarm-hive.html, dist/index.html ${(html.length / 1024).toFixed(0)} KB`);
