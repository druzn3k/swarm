// The Rust dual-engine harness corpus (rust/harness/corpus, expected,
// manifest.json) must be up to date with its generator (oracle/gen-corpus.ts)
// and the TS engine. Regenerating it takes minutes, so this checks:
//   1. the hash of every generator input (gen-corpus.ts INPUTS: the generator,
//      the scenario interpreter, the fixtures, engine/src, the static tables)
//      matches the one recorded at generation time;
//   2. the files on disk are exactly the ones recorded, byte for byte;
//   3. a sample: two scenarios replayed through run.ts give their expected file,
//      and one fixture scenario is re-planned identically.
// Else run `pnpm --filter @swarmsim/engine oracle:corpus`.
import * as fs from "fs";
import * as path from "path";
import { CORPUS_DIR, EXPECTED_DIR, fixtureStarts, HARNESS_DIR, inputsHash, Manifest, MANIFEST, scenarioFor, sha256 } from "../oracle/gen-corpus";
import { goldenJson } from "../oracle/generate";
import { runScenarioJson } from "../oracle/run";

const REGEN = "(else run `pnpm --filter @swarmsim/engine oracle:corpus`)";
const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const read = (dir: string, name: string) => fs.readFileSync(path.join(dir, `${name}.json`), "utf8");

describe(`rust/harness corpus ${REGEN}`, () => {
  test("generator inputs are unchanged since the corpus was generated", () => {
    expect(inputsHash()).toBe(manifest.inputsHash);
  });

  test("corpus and expected files match the manifest", () => {
    const onDisk: { [p: string]: string } = {};
    for (const dir of [CORPUS_DIR, EXPECTED_DIR]) {
      for (const f of fs.readdirSync(dir).sort()) {
        const rel = path.posix.join(path.basename(dir), f);
        onDisk[rel] = sha256(fs.readFileSync(path.join(HARNESS_DIR, rel)));
      }
    }
    expect(onDisk).toEqual(manifest.files);
    const names = (dir: string) => Object.keys(manifest.files).filter((f) => f.startsWith(dir + "/")).map((f) => path.basename(f));
    expect(names("expected")).toEqual(names("corpus"));
    expect(names("corpus").length).toBeGreaterThanOrEqual(50);
  });

  test.each(["fixture-session-v1", "ascension-2-1h"])("sample replay: run.ts %s gives its expected file", (name) => {
    expect(runScenarioJson(JSON.parse(read(CORPUS_DIR, name)), "ts")).toBe(read(EXPECTED_DIR, name));
  }, 120000);

  test("sample re-plan: fixture-session-v1 is planned identically", () => {
    const start = fixtureStarts().find((s) => s.name === "fixture-session-v1")!;
    expect(goldenJson(scenarioFor(start))).toBe(read(CORPUS_DIR, "fixture-session-v1"));
  }, 120000);
});
