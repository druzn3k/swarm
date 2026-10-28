import Decimal from "decimal.js";
import { parseNumber, ParseNumberUnit } from "../src";
import { mkgame } from "./helpers";

// Fake the three unit methods parseNumber uses (the original spec used a full
// Game and the drone unit; those cases are repeated against real units below).
function mkunit(opts: {
  count?: Decimal.Value;
  twin?: Decimal.Value;
  maxCost?: Decimal.Value; // max affordable at 100%
}): ParseNumberUnit & { _count: Decimal; _twin: Decimal } {
  const u = {
    _count: new Decimal(opts.count ?? 0),
    _twin: new Decimal(opts.twin ?? 1),
    count: () => u._count,
    twinMult: () => u._twin,
    maxCostMet: (percent: Decimal) =>
      new Decimal(opts.maxCost ?? 0).times(percent).floor(),
  };
  return u;
}
// twin upgrade level n => 2^n multiplier
const twin = (n: number) => new Decimal(2).pow(n);

describe("parsenumber", () => {
  it("should do something", () => {
    expect(!!parseNumber).toBe(true);
  });

  it("parses numbers in different formats", () => {
    expect(parseNumber("12345")!.toNumber()).toBe(12345);
    expect(parseNumber("12,345")!.toNumber()).toBe(12345);
    expect(parseNumber(12345)!.toNumber()).toBe(12345);
    expect(parseNumber(new Decimal(12345))!.toNumber()).toBe(12345);
    expect(parseNumber("12.345e3")!.toNumber()).toBe(12345);
    expect(parseNumber("12.345E3")!.toNumber()).toBe(12345);
    expect(parseNumber("12.345e+3")!.toNumber()).toBe(12345);
    expect(parseNumber("12.345E+3")!.toNumber()).toBe(12345);
    expect(parseNumber("fgsfds")).toBeUndefined();
    expect(parseNumber("12e")).toBeUndefined();
    expect(parseNumber("12E")).toBeUndefined();
    expect(parseNumber("-1")!.toNumber()).toBe(1);
    expect(parseNumber("0")!.toNumber()).toBe(1);
    expect(parseNumber("12.999")!.toNumber()).toBe(12);
    // exceed js max number
    expect(parseNumber("1e3000") + "").toBe("1e+3000");
    expect(parseNumber("55e3000") + "").toBe("5.5e+3001");
  });

  it("parses number with fancy suffixes", () => {
    expect(parseNumber("12 thousand")!.toNumber()).toBe(12000);
    expect(parseNumber("12.345 thousand")!.toNumber()).toBe(12345);
    expect(parseNumber("12k")!.toNumber()).toBe(12000);
    expect(parseNumber("12.345k")!.toNumber()).toBe(12345);
    expect(parseNumber("12.345 ThOuSaNd")!.toNumber()).toBe(12345);
    expect(parseNumber("12.345K")!.toNumber()).toBe(12345);
    expect(parseNumber("12 million")!.toNumber()).toBe(12e6);
    expect(parseNumber("12 billion")!.toNumber()).toBe(12e9);
    expect(parseNumber("12 trillion")!.toNumber()).toBe(12e12);
    expect(parseNumber("12 quadrillion")!.toNumber()).toBe(12e15);
    expect(parseNumber("12 brazillion")).toBeUndefined();
    expect(parseNumber("12m")!.toNumber()).toBe(12e6);
    expect(parseNumber("12b")!.toNumber()).toBe(12e9);
    expect(parseNumber("12t")!.toNumber()).toBe(12e12);
    expect(parseNumber("12q")).toBeUndefined();
    expect(parseNumber("12qa")!.toNumber()).toBe(12e15);
  });

  it("parses cost-percents", () => {
    // like the original: 100% of max-buyable is 10
    const unit = mkunit({ maxCost: 10 });
    expect(parseNumber("100%", unit)!.toNumber()).toBe(10);
    expect(parseNumber("50%", unit)!.toNumber()).toBe(5);
    expect(parseNumber("49.99999%", unit)!.toNumber()).toBe(4);
    expect(parseNumber("0%", unit)!.toNumber()).toBe(1); //minimum
    expect(parseNumber("-1%", unit)!.toNumber()).toBe(1);
    expect(parseNumber("9999%", unit)!.toNumber()).toBe(10); //max
  });

  it("parses twins", () => {
    const unit = mkunit({});
    expect(parseNumber("=1000", unit)!.toNumber()).toBe(1000);

    unit._twin = twin(1);
    expect(parseNumber("=1000", unit)!.toNumber()).toBe(500);
    expect(parseNumber("=1001", unit)!.toNumber()).toBe(501); // round up

    unit._twin = twin(3);
    expect(parseNumber("=100", unit)!.toNumber()).toBe(13);
    expect(parseNumber("=1000", unit)!.toNumber()).toBe(125);
    expect(parseNumber("=1001", unit)!.toNumber()).toBe(126);

    // plays nice with other formats
    expect(parseNumber("=1k", unit)!.toNumber()).toBe(125);
    expect(parseNumber("=1.001k", unit)!.toNumber()).toBe(126);
    expect(parseNumber("=1 thousand", unit)!.toNumber()).toBe(125);
  });

  it("parses a target value", () => {
    const unit = mkunit({});
    expect(parseNumber("@1000", unit)!.toNumber()).toBe(1000);

    unit._count = new Decimal(200);
    expect(parseNumber("@1000", unit)!.toNumber()).toBe(800);

    unit._twin = twin(1);
    unit._count = new Decimal(0);
    expect(parseNumber("@1000", unit)!.toNumber()).toBe(500);
    expect(parseNumber("@1001", unit)!.toNumber()).toBe(501); // round up

    unit._twin = twin(3);
    expect(parseNumber("@100", unit)!.toNumber()).toBe(13);
    expect(parseNumber("@1000", unit)!.toNumber()).toBe(125);
    expect(parseNumber("@1001", unit)!.toNumber()).toBe(126);

    // plays nice with other formats
    expect(parseNumber("@1k", unit)!.toNumber()).toBe(125);
    expect(parseNumber("@1.001k", unit)!.toNumber()).toBe(126);
    expect(parseNumber("@1 thousand", unit)!.toNumber()).toBe(125);

    unit._count = new Decimal(200);
    expect(parseNumber("@100", unit)!.toNumber()).toBe(1); // 1 is the minimum, no matter what
    expect(parseNumber("@1000", unit)!.toNumber()).toBe(100);
    expect(parseNumber("@1k", unit)!.toNumber()).toBe(100);
  });

  it("parses =n%, #617", () => {
    const unit = mkunit({});
    expect(parseNumber("=50%", unit)!.toNumber()).toBe(1);
  });
});

// The original spec's unit-dependent cases, against real Units in a real Game.
describe("parsenumber with real units", () => {

  it("parses cost-percents", () => {
    const game = mkgame({ larva: "9e9999", meat: 100 });
    const unit = game.unit("drone");
    expect(parseNumber("100%", unit)!.toNumber()).toBe(10);
    expect(parseNumber("50%", unit)!.toNumber()).toBe(5);
    expect(parseNumber("49.99999%", unit)!.toNumber()).toBe(4);
    expect(parseNumber("0%", unit)!.toNumber()).toBe(1); //minimum
    expect(parseNumber("-1%", unit)!.toNumber()).toBe(1);
    expect(parseNumber("9999%", unit)!.toNumber()).toBe(10); //max
  });

  it("parses twins", () => {
    const game = mkgame({ larva: "9e9999", meat: "1e99999" });
    const unit = game.unit("drone");
    const upgrade = game.upgrade("dronetwin");
    expect(upgrade.count().toNumber()).toBe(0);
    expect(unit.twinMult().toNumber()).toBe(1);
    expect(parseNumber("=1000", unit)!.toNumber()).toBe(1000);

    upgrade._setCount(1);
    expect(unit.twinMult().toNumber()).toBe(2);
    expect(parseNumber("=1000", unit)!.toNumber()).toBe(500);
    expect(parseNumber("=1001", unit)!.toNumber()).toBe(501); // round up

    upgrade._setCount(3);
    expect(unit.twinMult().toNumber()).toBe(8);
    expect(parseNumber("=100", unit)!.toNumber()).toBe(13);
    expect(parseNumber("=1000", unit)!.toNumber()).toBe(125);
    expect(parseNumber("=1001", unit)!.toNumber()).toBe(126);
    expect(parseNumber("=1k", unit)!.toNumber()).toBe(125);
    expect(parseNumber("=1.001k", unit)!.toNumber()).toBe(126);
    expect(parseNumber("=1 thousand", unit)!.toNumber()).toBe(125);
  });

  it("parses a target value", () => {
    const game = mkgame({ drone: 0, larva: "9e9999", meat: "1e99999" });
    const unit = game.unit("drone");
    const upgrade = game.upgrade("dronetwin");
    expect(parseNumber("@1000", unit)!.toNumber()).toBe(1000);
    unit._setCount(200);
    expect(parseNumber("@1000", unit)!.toNumber()).toBe(800);
    upgrade._setCount(1);
    unit._setCount(0);
    expect(unit.twinMult().toNumber()).toBe(2);
    expect(parseNumber("@1000", unit)!.toNumber()).toBe(500);
    expect(parseNumber("@1001", unit)!.toNumber()).toBe(501); // round up
    upgrade._setCount(3);
    expect(unit.twinMult().toNumber()).toBe(8);
    expect(parseNumber("@100", unit)!.toNumber()).toBe(13);
    expect(parseNumber("@1000", unit)!.toNumber()).toBe(125);
    expect(parseNumber("@1001", unit)!.toNumber()).toBe(126);
    expect(parseNumber("@1k", unit)!.toNumber()).toBe(125);
    expect(parseNumber("@1.001k", unit)!.toNumber()).toBe(126);
    expect(parseNumber("@1 thousand", unit)!.toNumber()).toBe(125);
    unit._setCount(200);
    expect(parseNumber("@100", unit)!.toNumber()).toBe(1); // 1 is the minimum, no matter what
    expect(parseNumber("@1000", unit)!.toNumber()).toBe(100);
    expect(parseNumber("@1k", unit)!.toNumber()).toBe(100);
  });

  it("parses =n%, #617", () => {
    const game = mkgame({ drone: 0, larva: "9e9999", meat: "1e99999" });
    expect(parseNumber("=50%", game.unit("drone"))!.toNumber()).toBe(1);
  });
});
