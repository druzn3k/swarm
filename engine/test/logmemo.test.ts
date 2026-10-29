// The memoised logarithm of logStat (effecttypes memoLog) must give exactly
// what a fresh Decimal.log gives.
import Decimal from "decimal.js";
import { memoLog } from "../src/effecttypes";
import { mkgame } from "./helpers";

// mulberry32: a fixed sequence of pseudo-random numbers
let seed = 12345;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randomDecimals(n: number): Decimal[] {
  const out: Decimal[] = [];
  for (let i = 0; i < n; i++) {
    const mantissa = new Decimal(rand()).times(10).plus(1e-9);
    const exp = Math.floor(rand() * 600) - 300;
    out.push(mantissa.times(new Decimal(10).pow(exp)));
    out.push(new Decimal(Math.floor(rand() * 1e6) + 1));
    out.push(new Decimal(rand()).plus(1));
  }
  return out;
}

describe("memoLog (logStat)", () => {
  const game = mkgame({});
  const effects = [...game.upgradelist(), ...game.unitlist()].flatMap((p: any) => (p.effect ?? []).filter((e: any) => e.type.name === "logStat"));

  it("finds logStat effects to check", () => {
    expect(effects.length).toBeGreaterThan(0);
  });

  it("equals Decimal.log for every logStat effect over many levels", () => {
    const levels = [...Array(500).keys()].map((i) => new Decimal(i));
    for (const x of randomDecimals(60)) levels.push(x.abs().floor());
    for (const e of effects) {
      for (const level of levels) {
        const arg = level.times(e.val).plus(e.val2);
        const fresh = Decimal.log(arg).toString();
        // first call computes, second comes from the memo
        expect(memoLog(arg).toString()).toBe(fresh);
        expect(memoLog(new Decimal(arg.toString())).toString()).toBe(fresh);
      }
    }
  });

  it("equals Decimal.log for arbitrary values, before and after the memo fills up", () => {
    const xs = randomDecimals(1500); // 4500 values: more than the memo holds
    for (let round = 0; round < 2; round++) {
      for (const x of xs) expect(memoLog(x).toString()).toBe(Decimal.log(x).toString());
    }
  });

  it("keys on the full-precision value", () => {
    const a = new Decimal("1.00000000000000000001");
    const b = new Decimal("1.00000000000000000002");
    expect(memoLog(a).toString()).toBe(Decimal.log(a).toString());
    expect(memoLog(b).toString()).toBe(Decimal.log(b).toString());
  });
});
