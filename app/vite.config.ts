import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { serviceWorker } from "./build/service-worker";

// base "./": the build works from any static path, e.g. GitHub Pages /swarm/.
export default defineConfig({
  base: "./",
  plugins: [react(), serviceWorker()],
  // the engine is WebAssembly (@swarmsim/engine-wasm, a workspace package):
  // its glue loads pkg/swarm_wasm_bg.wasm with new URL(..., import.meta.url),
  // which Vite turns into a hashed asset; don't pre-bundle it in dev
  optimizeDeps: { exclude: ["@swarmsim/engine-wasm"] },
  build: { outDir: "dist", target: "es2020", sourcemap: true, chunkSizeWarningLimit: 1500 },
  preview: { port: 4173, strictPort: true },
  test: { include: ["src/**/*.test.ts"], environment: "node", setupFiles: ["src/test/setup.ts"] },
});
