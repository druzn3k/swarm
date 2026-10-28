// Golden parity: replay each oracle scenario (test/golden/*.json, produced by
// the ORIGINAL CoffeeScript engine) against the TS engine and require
// identical results, errors, emitted commands and snapshots at every step.
import * as fs from "fs";
import * as path from "path";
import { runScenario, Scenario } from "../oracle/scenario";
import { createTsEngine } from "./tsengine";
import { goldenJson, GOLDEN_DIR } from "../oracle/generate";

function goldenFiles(): string[] {
  return fs
    .readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

describe("golden parity with the old engine", () => {
  test("there are 12 goldens", () => {
    expect(goldenFiles().length).toBe(12);
  });
  for (const file of goldenFiles()) {
    test(
      file,
      () => {
        const text = fs.readFileSync(path.join(GOLDEN_DIR, file), "utf8");
        const golden = JSON.parse(text);
        const scenario: Scenario = {
          name: golden.name,
          description: golden.description,
          start: golden.start,
          ...(golden.prefixSteps ? { prefixSteps: golden.prefixSteps } : {}),
          steps: golden.steps.map((s: any) => (s.snapshot === undefined ? { action: s.action } : { action: s.action, snapshot: snapshotKind(s.snapshot) })),
        };
        const actual = runScenario(scenario, {}, createTsEngine);
        // step by step first, for readable failures
        expect(actual.initial).toEqual(golden.initial);
        actual.steps.forEach((step, i) => {
          expect({ i, ...step }).toEqual({ i, ...golden.steps[i] });
        });
        expect(actual.steps.length).toBe(golden.steps.length);
        // then the exact text (key order included)
        expect(goldenJson(actual)).toBe(text);
      },
      120000
    );
  }
});

/** golden files record the snapshot itself, not its kind; recover the kind from its shape */
function snapshotKind(snap: any): "counts" | "full" {
  return snap.upgrades ? "full" : "counts";
}
