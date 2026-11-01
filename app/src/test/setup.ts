// Vitest setup: instantiate the wasm engine once per test file (the app's
// main.tsx does this with a fetch before the first render; Node can't fetch
// file: URLs, so the tests pass the bytes).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initEngine } from "@swarmsim/engine-wasm";

const wasm = fileURLToPath(new URL("../../../engine-wasm/pkg/swarm_wasm_bg.wasm", import.meta.url));
if (!existsSync(wasm)) {
  throw new Error(
    "The wasm engine isn't built (engine-wasm/pkg/). Run `pnpm --filter @swarmsim/engine-wasm build` " +
      "(needs cargo, the wasm32-unknown-unknown target and wasm-bindgen-cli 0.2.130)."
  );
}
await initEngine(readFileSync(wasm));
