import { describe, expect, it } from "vitest";
import { Decimal, createGame } from "@swarmsim/engine";
import { NOTATIONS, OPTION_DEFAULTS, formatterFor, readOptions, velocityUnitFor, writeOption } from "./options";
import { validateSave } from "../components/meta/SaveTools";
import { listAchievements, DEFAULT_SHOWN, readShown, writeShown } from "../components/meta/achievements";
import { utcdoy } from "../components/meta/time";

const fixedNow = () => new Date("2026-01-01T00:00:00Z");

describe("options", () => {
  it("defaults like the old game", () => {
    const { session } = createGame({ now: fixedNow });
    expect(readOptions(session)).toEqual({
      notation: "standard-decimal",
      velocityUnit: "sec",
      durationFormat: "abbreviated",
      showAdvancedUnitData: false,
      showCharts: true,
    });
    expect(OPTION_DEFAULTS.notation).toBe("standard-decimal");
  });

  it("writes to session.state.options under the old keys and saves", () => {
    const { game, session } = createGame({ now: fixedNow });
    writeOption(game, "notation", "engineering");
    writeOption(game, "velocityUnit", "hr");
    writeOption(game, "durationFormat", "human");
    writeOption(game, "showAdvancedUnitData", true);
    writeOption(game, "showCharts", false);
    expect(session.state.options).toMatchObject({
      notation: "engineering",
      velocityUnit: "hr",
      durationFormat: "human",
      showAdvancedUnitData: true,
      showCharts: false,
    });
    expect(readOptions(session).velocityUnit).toBe("hr");
    // saved to storage right away
    const stored = createGame({ now: fixedNow, storage: session.storage });
    expect(readOptions(stored.session).notation).toBe("engineering");
  });

  it("rejects invalid values and ignores invalid stored ones", () => {
    const { game, session } = createGame({ now: fixedNow });
    expect(() => writeOption(game, "notation", "roman" as never)).toThrow();
    expect(() => writeOption(game, "velocityUnit", "fortnight")).toThrow();
    session.state.options.notation = "roman";
    session.state.options.velocityUnit = "fortnight";
    expect(readOptions(session).notation).toBe("standard-decimal");
    expect(readOptions(session).velocityUnit).toBe("sec");
  });

  it("round-trips through export and import, keeping unknown old keys", () => {
    const a = createGame({ now: fixedNow });
    a.session.state.options.theme = "slate"; // an old option this app ignores
    writeOption(a.game, "notation", "scientific-e");
    writeOption(a.game, "velocityUnit", "warp");
    writeOption(a.game, "durationFormat", "human");
    writeOption(a.game, "showAdvancedUnitData", true);
    const exported = a.session.exportSave();

    const b = createGame({ now: fixedNow, save: exported });
    expect(readOptions(b.session)).toEqual(readOptions(a.session));
    expect(b.session.state.options.theme).toBe("slate");

    // and through the app's import path (game.importSave)
    const c = createGame({ now: fixedNow });
    c.game.importSave(exported, false);
    expect(readOptions(c.session).notation).toBe("scientific-e");
  });

  it("picks velocity units like getVelocityUnit, warp falling back to seconds for energy", () => {
    const { game } = createGame({ now: fixedNow });
    expect(velocityUnitFor(game, "min").mult).toBe(60);
    expect(velocityUnitFor(game, "day").mult).toBe(86400);
    const warp = velocityUnitFor(game, "warp", { unit: "meat" });
    expect(warp.name).toBe("warp");
    expect(warp.label).toBe("Swarmwarp");
    expect(warp.mult).toBe(900);
    expect(velocityUnitFor(game, "warp", { unit: "energy" }).name).toBe("sec");
    expect(velocityUnitFor(game, "warp", { prod: "nexus" }).name).toBe("sec");
    expect(velocityUnitFor(game, "nonsense").name).toBe("sec");
  });
});

describe("formatterFor", () => {
  const big = new Decimal("1.23456789e38");
  const expected: Record<string, [string, string]> = {
    "standard-decimal": ["123UDc", "123.456 undecillion"],
    "scientific-e": ["1.23e38", "1.23456e38"],
    hybrid: ["1.23e38", "1.23456e38"],
    engineering: ["123E36", "123.456E36"],
  };
  for (const notation of NOTATIONS) {
    it(`formats numbers in ${notation}`, () => {
      const { game } = createGame({ now: fixedNow });
      writeOption(game, "notation", notation);
      const f = formatterFor(game, readOptions(game.session));
      expect(f.num(1234)).toBe("1,234");
      expect([f.num(big), f.long(big)]).toEqual(expected[notation]);
    });
  }

  it("shows rates in the chosen velocity unit", () => {
    const { game } = createGame({ now: fixedNow });
    writeOption(game, "velocityUnit", "min");
    expect(formatterFor(game, readOptions(game.session)).rate(new Decimal(2), { unit: "meat" })).toBe("+120/min");
    writeOption(game, "velocityUnit", "warp");
    const f = formatterFor(game, readOptions(game.session));
    expect(f.rate(new Decimal(2), { unit: "meat" })).toBe("+1,800/warp");
    expect(f.rate(new Decimal(2), { unit: "energy" })).toBe("+2/sec");
  });

  it("formats durations in the chosen style", () => {
    const { game } = createGame({ now: fixedNow });
    expect(formatterFor(game, readOptions(game.session)).duration(3 * 3600)).toBe("3:00:00");
    writeOption(game, "durationFormat", "human");
    expect(formatterFor(game, readOptions(game.session)).duration(3 * 3600)).toBe("3 hours");
  });
});

describe("save validation", () => {
  it("accepts this app's saves and rejects junk", () => {
    const { session } = createGame({ now: fixedNow });
    const decode = (s: string) => session._loads(s);
    expect(validateSave(decode, session.exportSave())).toBeUndefined();
    expect(validateSave(decode, "  " + session.exportSave() + "\n")).toBeUndefined();
    expect(validateSave(decode, "")).toMatch(/paste/i);
    expect(validateSave(decode, "https://swarmsim.com/s/abc")).toMatch(/link/);
    expect(validateSave(decode, "hello world")).toMatch(/isn't a Swarm Simulator save/);
  });
});

describe("achievements list", () => {
  it("hides zero-point masked achievements and stores filters in the save", () => {
    const { game, commands } = createGame({ now: fixedNow });
    const all = listAchievements(game, DEFAULT_SHOWN);
    expect(all.find((a) => a.name === "therightquestion")).toBeUndefined();
    expect(all.find((a) => a.name === "clickme")).toBeDefined();
    commands.buyUnit({ unit: game.unit("drone"), num: new Decimal(1) });
    const earned = listAchievements(game, { ...DEFAULT_SHOWN, unearned: false, masked: false });
    expect(earned.length).toBeGreaterThan(0);
    expect(earned.every((a) => a.isEarned())).toBe(true);
    // default order: earned first
    expect(listAchievements(game, DEFAULT_SHOWN)[0].isEarned()).toBe(true);
    writeShown(game, { ...DEFAULT_SHOWN, masked: false, order: "percentComplete" });
    expect(readShown(game)).toMatchObject({ masked: false, order: "percentComplete" });
  });
});

describe("utcdoy", () => {
  it("formats elapsed time like the old filter", () => {
    expect(utcdoy(0)).toBe("0h 00:00.000");
    expect(utcdoy(((26 * 60 + 3) * 60 + 4) * 1000 + 5)).toBe("1d 2h 03:04.005");
  });
});
