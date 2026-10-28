// Port of swarmsim-coffee/test/spec/services/effect.coffee
import Decimal from "decimal.js";
import { buildEffectTypes, romanize, SeedRand } from "../src";

describe("Service: effecttypes", () => {
  const effecttypes = buildEffectTypes(new SeedRand({ state: { date: { started: new Date(0) } } }));

  it("should do something", () => {
    expect(!!effecttypes).toBe(true);
  });

  it("validates mult vs add - effects must be commutative", () => {
    const schema = {};
    const stats: any = {};
    const calc = (type: string, effect: any, level: number) =>
      effecttypes.byName[type].calcStats!(effect, stats, schema, new Decimal(level));
    calc("multStat", { stat: "x", val: 3 }, 1);
    expect(stats.x.toNumber()).toBe(3);
    calc("multStat", { stat: "x", val: 3 }, 2);
    expect(stats.x.toNumber()).toBe(27);
    calc("addStat", { stat: "t", val: 3 }, 1);
    expect(stats.t.toNumber()).toBe(3);
    calc("addStat", { stat: "t", val: 3 }, 3);
    expect(stats.t.toNumber()).toBe(12);
    expect(() => calc("addStat", { stat: "x", val: 3 }, 1)).toThrow();
    expect(() => calc("multStat", { stat: "t", val: 3 }, 1)).toThrow();
  });

  it("romanizes", () => {
    expect(romanize(2)).toBe("II");
    expect(romanize(6)).toBe("VI");
    expect(romanize(21)).toBe("XXI");
    expect(romanize(51)).toBe("LI");
    expect(romanize(100)).toBe("C");
    expect(romanize(1000)).toBe("M");
    expect(romanize(3999)).toBe("MMMCMXCIX");
  });
});
