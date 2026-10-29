import { readFileSync } from "fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { serviceWorker } from "./build/service-worker";

// the lodash modules the engine imports one by one (engine/src/lodash.ts)
const ENGINE_LODASH = [...readFileSync(new URL("../engine/src/lodash.ts", import.meta.url), "utf8").matchAll(/from "(lodash\/\w+)"/g)].map((m) => m[1]);

// base "./": the build works from any static path, e.g. GitHub Pages /swarm/.
export default defineConfig({
  base: "./",
  plugins: [react(), serviceWorker()],
  // the engine is TypeScript source in the workspace; its CommonJS deps need pre-bundling in dev
  // ("engine > dep": they are the engine's dependencies, not the app's)
  optimizeDeps: {
    include: ["decimal.js", "lz-string", "seedrandom/seedrandom", ...ENGINE_LODASH].map((dep) => `@swarmsim/engine > ${dep}`),
  },
  build: { outDir: "dist", target: "es2019", sourcemap: true, chunkSizeWarningLimit: 1500 },
  preview: { port: 4173, strictPort: true },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
