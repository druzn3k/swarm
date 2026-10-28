// Differential tests: run small scenarios on BOTH the old engine (oracle) and
// the TS engine, live, and require identical output. These target quirks the
// golden files don't exercise much: clock-based periodic caches (stale for up
// to 3s), sticky visibility, ticks back in time, the ascend-estimate TypeError.
import { Action, runScenario, Scenario, SnapshotKind, Step } from "../oracle/scenario";
import { SAVE_MIDGAME, T0, at } from "../oracle/scenarios";
import { createTsEngine } from "./tsengine";

function step(action: Action, snapshot?: SnapshotKind): Step {
  return snapshot ? { action, snapshot } : { action };
}

function compare(s: Scenario) {
  const expected = runScenario(s);
  const actual = runScenario(s, {}, createTsEngine);
  expect(actual.initial).toEqual(expected.initial);
  actual.steps.forEach((st, i) => expect({ i, ...st }).toEqual({ i, ...expected.steps[i] }));
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
  return expected;
}

describe("differential: old engine vs TS engine", () => {
  test("periodic caches go stale between 3-second clears; visibility is sticky", () => {
    const steps: Step[] = [
      step({ do: "setUnitCount", unit: "territory", val: 5 }),
      step({ do: "setUnitCount", unit: "queen", val: 1 }),
      step({ do: "setUnitCount", unit: "swarmling", val: 100 }, "full"),
      step({ do: "estimateUpgrade", upgrade: "expansion" }),
    ];
    for (const s of [0.5, 1, 2, 2.9, 3, 3.1, 4, 6.5, 9.6]) {
      steps.push(step({ do: "tick", at: at(s) }, "full"));
      steps.push(step({ do: "estimateUpgrade", upgrade: "expansion" }));
      steps.push(step({ do: "buyAllUpgrades" }));
    }
    steps.push(step({ do: "setUnitCount", unit: "drone", val: 10 }, "counts"));
    steps.push(step({ do: "setUnitCount", unit: "drone", val: 0 }, "full"));
    // back in time: <=120s ignored, more throws
    steps.push(step({ do: "tick", at: at(100) }, "counts"));
    steps.push(step({ do: "tick", at: at(-10) }, "counts"));
    steps.push(step({ do: "tick", at: at(-30) }, "counts"));
    steps.push(step({ do: "ascendInfo" }));
    steps.push(step({ do: "setUnitCount", unit: "nexus", val: 5 }));
    steps.push(step({ do: "setUnitCount", unit: "energy", val: 1e7 }));
    steps.push(step({ do: "ascendInfo" }));
    // spent energy lowers the ascension cost below the energy cap
    steps.push(step({ do: "setUpgradeCount", upgrade: "swarmwarp", val: 1000 }));
    steps.push(step({ do: "ascendInfo" }));
    steps.push(step({ do: "ascend" }, "full"));
    steps.push(step({ do: "save" }));
    const res = compare({ name: "periodic", description: "", start: { now: T0 }, steps });
    // sanity: the scenario does hit the interesting cases
    const errors = res.steps.map((s) => s.error).filter(Boolean);
    expect(errors.some((e) => /back in time/.test(e!))).toBe(true);
    const ascendInfo = res.steps.filter((s) => s.action.do === "ascendInfo").map((s) => s.result as any);
    expect(ascendInfo[2].ascendCostDurationSecs.error).toBe("energy.estimateSecsUntilEarned(...).toNumber is not a function");
  }, 60000);

  test("mid-game save: small ticks with estimates and buy-alls", () => {
    const base = Date.parse("2022-12-14T00:00:00.000Z");
    const steps: Step[] = [];
    for (const s of [1, 2, 2.5, 3.5, 7, 60]) {
      steps.push(step({ do: "tick", at: new Date(base + s * 1000).toISOString() }, "full"));
      steps.push(step({ do: "buyAllUpgrades", percent: 0.5 }));
      steps.push(step({ do: "buyMaxUnit", unit: "drone", percent: 0.1 }));
    }
    steps.push(step({ do: "undo" }, "full"));
    steps.push(step({ do: "exportSave" }));
    // The save's own time is before `base`; start from base so ticks move forward.
    compare({ name: "midgame-small-ticks", description: "", start: { now: new Date(base).toISOString(), save: SAVE_MIDGAME }, steps });
  }, 60000);
});
