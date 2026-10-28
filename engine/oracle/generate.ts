// Writes the oracle's golden snapshots to engine/test/golden/*.json.
//
//   cd engine && yarn oracle:golden
//
// Output is deterministic: the old engine's clock is fixed per scenario and
// all randomness is seeded from save dates.
import * as fs from "fs";
import * as path from "path";
import { runScenario } from "./scenario";
import { scenarios } from "./scenarios";

export const GOLDEN_DIR = path.resolve(__dirname, "../test/golden");

export function goldenJson(result: unknown): string {
  return JSON.stringify(result, null, 1) + "\n";
}

function main(filter: string[]) {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  for (const s of scenarios()) {
    if (filter.length && !filter.includes(s.name)) continue;
    const t = Date.now();
    const json = goldenJson(runScenario(s));
    const file = path.join(GOLDEN_DIR, `${s.name}.json`);
    fs.writeFileSync(file, json);
    console.log(`${path.relative(process.cwd(), file)}: ${(json.length / 1024).toFixed(0)} KiB, ${Date.now() - t}ms`);
  }
}

if (require.main === module) main(process.argv.slice(2));
