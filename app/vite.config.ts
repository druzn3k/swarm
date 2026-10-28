import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { serviceWorker } from "./build/service-worker";

// base "./": the build works from any static path, e.g. GitHub Pages /swarm/.
export default defineConfig({
  base: "./",
  plugins: [react(), serviceWorker()],
  // the engine is TypeScript source in the workspace; its CommonJS deps need pre-bundling in dev
  optimizeDeps: { include: ["decimal.js", "lodash", "lz-string", "seedrandom"] },
  build: { outDir: "dist", target: "es2019", sourcemap: true, chunkSizeWarningLimit: 1500 },
  preview: { port: 4173, strictPort: true },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
