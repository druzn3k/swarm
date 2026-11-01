// Runs one scenario JSON file through an engine and prints the golden-format
// JSON (oracle/generate.ts goldenJson) on stdout. Used by the Rust dual-engine
// harness (rust/harness/README.md) to drive the TS side.
//
//   pnpm --filter @swarmsim/engine oracle:run -- <scenario.json | -> [--engine ts|oracle]
//
// `-` reads the scenario from stdin. --engine ts (default) is the TS engine
// (test/tsengine.ts); --engine oracle is the original CoffeeScript engine.
import * as fs from "fs";
import { runScenario, Scenario, ScenarioEngine } from "./scenario";
import { goldenJson } from "./generate";
import { createTsEngine } from "../test/tsengine";

export type EngineName = "ts" | "oracle";

export function runScenarioJson(s: Scenario, engine: EngineName = "ts"): string {
  // the default `create` of runScenario is the oracle
  const create: ((start: Scenario["start"]) => ScenarioEngine) | undefined = engine === "ts" ? createTsEngine : undefined;
  return goldenJson(runScenario(s, {}, create));
}

function usage(): never {
  process.stderr.write("usage: run.ts <scenario.json | -> [--engine ts|oracle]\n");
  process.exit(2);
}

function main(argv: string[]) {
  let engine: EngineName = "ts";
  let file: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue; // pnpm passes it through
    if (a === "--engine" || a.startsWith("--engine=")) {
      const v = a === "--engine" ? argv[++i] : a.slice("--engine=".length);
      if (v !== "ts" && v !== "oracle") usage();
      engine = v;
    } else if (file === undefined) file = a;
    else usage();
  }
  if (file === undefined) usage();
  const text = fs.readFileSync(file === "-" ? 0 : file, "utf8");
  process.stdout.write(runScenarioJson(JSON.parse(text) as Scenario, engine));
}

if (require.main === module) main(process.argv.slice(2));
