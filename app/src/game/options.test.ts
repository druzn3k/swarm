import { describe, expect, it } from "vitest";
import { Dec } from "@swarmsim/engine-wasm";
import { NOTATIONS, OPTION_DEFAULTS, formatterFor, readOptions, velocityUnitFor, writeOption } from "./options";
import { GameStore } from "./store";
import { memoryStorage } from "./storage";
import { validateSave } from "../components/meta/SaveTools";
import { listAchievements, DEFAULT_SHOWN, readShown, writeShown } from "../components/meta/achievements";
import { utcdoy } from "../components/meta/time";
import { craftV1, storeWith } from "../test/saves";

const warp900 = () => 900;

describe("options", () => {
  it("defaults like the old game", () => {
    const { store } = storeWith();
    expect(readOptions(store)).toEqual({
      notation: "standard-decimal",
      velocityUnit: "sec",
      durationFormat: "abbreviated",
      showAdvancedUnitData: false,
      showCharts: true,
    });
    expect(OPTION_DEFAULTS.notation).toBe("standard-decimal");
  });

  it("writes to the save's options bag under the old keys and saves", () => {
    const storage = memoryStorage();
    const store = new GameStore({ storage, save: craftV1() });
    writeOption(store, "notation", "engineering");
    writeOption(store, "velocityUnit", "hr");
    writeOption(store, "durationFormat", "human");
    writeOption(store, "showAdvancedUnitData", true);
    writeOption(store, "showCharts", false);
    expect(store.handle.uiState().options).toMatchObject({
      notation: "engineering",
      velocityUnit: "hr",
      durationFormat: "human",
      showAdvancedUnitData: true,
      showCharts: false,
    });
    expect(readOptions(store).velocityUnit).toBe("hr");
    // saved to storage right away
    expect(readOptions(new GameStore({ storage })).notation).toBe("engineering");
  });

  it("rejects invalid values and ignores invalid stored ones", () => {
    const { store } = storeWith();
    expect(() => writeOption(store, "notation", "roman" as never)).toThrow();
    expect(() => writeOption(store, "velocityUnit", "fortnight")).toThrow();
    const odd = storeWith({ options: { notation: "roman", velocityUnit: "fortnight" } }).store;
    expect(readOptions(odd).notation).toBe("standard-decimal");
    expect(readOptions(odd).velocityUnit).toBe("sec");
  });

  it("round-trips through export and import in both formats, keeping unknown old keys", () => {
    const { store: a } = storeWith({ options: { theme: "slate" } }); // an old option this app ignores
    writeOption(a, "notation", "scientific-e");
    writeOption(a, "velocityUnit", "warp");
    writeOption(a, "durationFormat", "human");
    writeOption(a, "showAdvancedUnitData", true);
    for (const format of ["v2", "v1"] as const) {
      const b = new GameStore({ save: a.exportSave(format) });
      expect(readOptions(b), format).toEqual(readOptions(a));
      expect(b.ui.options.theme, format).toBe("slate");
      // and through the app's import
      const { store: c } = storeWith();
      expect(c.importSave(a.exportSave(format)).error).toBeUndefined();
      expect(readOptions(c).notation, format).toBe("scientific-e");
    }
  });

  it("picks velocity units like getVelocityUnit, warp falling back to seconds for energy", () => {
    expect(velocityUnitFor(warp900, "min").mult).toBe(60);
    expect(velocityUnitFor(warp900, "day").mult).toBe(86400);
    const warp = velocityUnitFor(warp900, "warp", { unit: "meat" });
    expect(warp.name).toBe("warp");
    expect(warp.label).toBe("Swarmwarp");
    expect(warp.mult).toBe(900);
    expect(velocityUnitFor(warp900, "warp", { unit: "energy" }).name).toBe("sec");
    expect(velocityUnitFor(warp900, "warp", { prod: "nexus" }).name).toBe("sec");
    expect(velocityUnitFor(warp900, "nonsense").name).toBe("sec");
  });

  it("reads swarmwarp's length from the view when energy is focused", async () => {
    const { store } = storeWith({ units: { nexus: 5, energy: 1000 } });
    expect(store.warpSecs).toBe(1);
    store.need({}, { focus: ["energy"] });
    await Promise.resolve();
    expect(store.warpSecs).toBe(900);
  });
});

describe("formatterFor", () => {
  const big = "1.23456789e38";
  const expected: Record<string, [string, string]> = {
    "standard-decimal": ["123UDc", "123.456 undecillion"],
    "scientific-e": ["1.23e38", "1.23456e38"],
    hybrid: ["1.23e38", "1.23456e38"],
    engineering: ["123E36", "123.456E36"],
  };
  for (const notation of NOTATIONS) {
    it(`formats numbers in ${notation}`, () => {
      const { store } = storeWith();
      writeOption(store, "notation", notation);
      const f = formatterFor(warp900, readOptions(store));
      expect(f.num(1234)).toBe("1,234");
      expect([f.num(big), f.long(big)]).toEqual(expected[notation]);
    });
  }

  it("shows rates in the chosen velocity unit", () => {
    const { store } = storeWith();
    writeOption(store, "velocityUnit", "min");
    expect(formatterFor(warp900, readOptions(store)).rate("2", { unit: "meat" })).toBe("+120/min");
    writeOption(store, "velocityUnit", "warp");
    const f = formatterFor(warp900, readOptions(store));
    expect(f.rate(Dec.from(2), { unit: "meat" })).toBe("+1,800/warp");
    expect(f.rate("2", { unit: "energy" })).toBe("+2/sec");
  });

  it("formats durations in the chosen style", () => {
    const { store } = storeWith();
    expect(formatterFor(warp900, readOptions(store)).duration(3 * 3600)).toBe("3:00:00");
    writeOption(store, "durationFormat", "human");
    expect(formatterFor(warp900, readOptions(store)).duration(3 * 3600)).toBe("3 hours");
  });
});

describe("save validation", () => {
  it("accepts both save formats and rejects junk", () => {
    const { store } = storeWith();
    const load = (s: string) => store.checkSave(s);
    expect(validateSave(store.exportSave("v2"), load)).toBeUndefined();
    expect(validateSave(store.exportSave("v1"), load)).toBeUndefined();
    expect(validateSave("  " + store.exportSave() + "\n", load)).toBeUndefined();
    expect(validateSave("", load)).toMatch(/paste/i);
    expect(validateSave("https://swarmsim.com/s/abc", load)).toMatch(/link/);
    expect(validateSave("hello world", load)).toMatch(/isn't a Swarm Simulator save/);
    expect(validateSave("SW2|garbage", load)).toMatch(/isn't a Swarm Simulator save/);
  });
});

describe("achievements list", () => {
  it("hides zero-point masked achievements and stores filters in the save", () => {
    const { store } = storeWith();
    const all = listAchievements(store.g, DEFAULT_SHOWN);
    expect(all.find((a) => a.name === "therightquestion")).toBeUndefined();
    expect(all.find((a) => a.name === "clickme")).toBeDefined();
    store.act({ do: "buy_unit", unit: "drone", amount: { num: "1" } });
    store.need({}, { sections: ["achievements"] });
    store.refresh();
    const earned = listAchievements(store.g, { ...DEFAULT_SHOWN, unearned: false, masked: false });
    expect(earned.length).toBeGreaterThan(0);
    expect(earned.every((a) => a.earned)).toBe(true);
    // default order: earned first
    expect(listAchievements(store.g, DEFAULT_SHOWN)[0].earned).toBe(true);
    writeShown(store, { ...DEFAULT_SHOWN, masked: false, order: "percentComplete" });
    expect(readShown(store)).toMatchObject({ masked: false, order: "percentComplete" });
    expect(readShown(new GameStore({ save: store.exportSave() }))).toMatchObject({ masked: false, order: "percentComplete" });
  });

  it("reads the old app's filters from the save's top level", () => {
    const old = { ui: { options: {}, unknown: { achievementsShown: { earned: false, reverse: true } } } };
    expect(readShown(old)).toMatchObject({ earned: false, unearned: true, reverse: true });
  });

  it("fills in the required count in descriptions", () => {
    const { store } = storeWith();
    const a = store.g.achievement("expansion2");
    expect(a.description((n) => `<${n}>`)).not.toContain("$REQUIRED");
    expect(a.description((n) => `<${n}>`)).toMatch(/^Have <\d+> expansions at once$/);
  });
});

describe("utcdoy", () => {
  it("formats elapsed time like the old filter", () => {
    expect(utcdoy(0)).toBe("0h 00:00.000");
    expect(utcdoy(((26 * 60 + 3) * 60 + 4) * 1000 + 5)).toBe("1d 2h 03:04.005");
  });
});
