// The cached cost-factor logarithm of upgrades (upgrade factorLog, used by
// maxCostMet) must give exactly what a fresh computation gives.
import Decimal from "decimal.js";
import { factorLog } from "../src/upgrade";
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

describe("factorLog (upgrade maxCostMet)", () => {
  it("equals factor.log() for every upgrade cost", () => {
    const game = mkgame({});
    let n = 0;
    for (const up of game.upgradelist()) {
      for (const cost of up.cost) {
        expect(factorLog(cost.factor).toString()).toBe(new Decimal(cost.factor.toString()).log().toString());
        expect(factorLog(cost.factor)).toBe(factorLog(cost.factor));
        n++;
      }
      for (const cost of up.totalCost()) expect(factorLog(cost.factor).toString()).toBe(cost.factor.log().toString());
    }
    expect(n).toBeGreaterThan(10);
  });

  it("equals factor.log() for arbitrary factors", () => {
    for (const x of randomDecimals(1000)) expect(factorLog(x).toString()).toBe(new Decimal(x.toString()).log().toString());
  });

  it("maxCostMet matches the uncached formula across many counts", () => {
    const game = mkgame({});
    const ONE = new Decimal(1);
    for (const up of game.upgradelist()) {
      for (const exp of [0, 1, 3, 7, 12, 20, 40, 80, 150]) {
        for (const cost of up.cost) game.session.state.unittypes[cost.unit.name] = new Decimal(10).pow(exp).times(1.7);
        game.cache.onUpdate();
        let max = up.type.maxlevel ? new Decimal(up.type.maxlevel).minus(up.count()) : new Decimal(Infinity);
        for (const cost of up.totalCost()) {
          const m = cost.factor.equals(1)
            ? cost.unit.count().dividedBy(cost.val)
            : ONE.minus(cost.unit.count().times(ONE.minus(cost.factor)).dividedBy(cost.val)).log().dividedBy(new Decimal(cost.factor.toString()).log());
          max = Decimal.min(max, m);
        }
        max = max.floor();
        const got = up.maxCostMet();
        // maxCostMet may step down by one for sumCost precision (#290)
        expect([max.toString(), max.minus(1).toString()]).toContain(got.toString());
      }
    }
  });
});
