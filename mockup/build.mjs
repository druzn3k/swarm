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
writeFileSync("dist/swarm-hive.html", html);
console.log(`dist/swarm-hive.html ${(html.length / 1024).toFixed(0)} KB`);
