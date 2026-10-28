// Port of swarmsim-coffee/test/spec/services/game.coffee
import { Effect, EffectLike, Game, GameLike, ParseNumberUnit, UnitLike, UpgradeLike } from "../src";
import { mkgame } from "./helpers";

describe("Service: game", () => {
  it("should do something", () => {
    expect(!!Game).toBe(true);
  });

  it("diffs seconds", () => {
    const game = new Game({ state: { date: { reified: new Date(1000) } } as any, save: () => {} }, { clock: () => new Date(0) });
    game.now = new Date(0);
    game.tick(new Date(1000));
    expect(game.diffMillis()).toBe(0);
    expect(game.diffSeconds()).toBe(0);
    game.tick(new Date(2000));
    expect(game.diffMillis()).toBe(1000);
    expect(game.diffSeconds()).toBe(1);
    game.tick(new Date(3500));
    expect(game.diffMillis()).toBe(2500);
    expect(game.diffSeconds()).toBe(2.5);
  });

  it("recovers NaN saves", () => {
    const game = mkgame({ larva: NaN, meat: 9999999, drone: 99999 });
    expect(game.unit("larva").count().toNumber()).toBe(0);
  });

  it("ignores small clock skews, but throws for big ones", () => {
    const game = mkgame({});
    game.tick(new Date(200000));
    game.tick(new Date(200000 - 120000)); // ignored
    expect(game.now.getTime()).toBe(200000);
    expect(() => game.tick(new Date(200000 - 120001))).toThrow(
      "tick tried to go back in time. System clock problem?,Thu Jan 01 1970 00:03:20 GMT+0000 (Coordinated Universal Time),Thu Jan 01 1970 00:01:19 GMT+0000 (Coordinated Universal Time),120001"
    );
    expect(game.now.getTime()).toBe(200000);
  });
});

describe("Service: game achievements", () => {
  // 'grants unit-based achievements', "doesn't count queen-produced drones toward
  // achievevements", 'grants upgrade-based achievements' were xit (disabled) in
  // the original; see command.test.ts / achievements.test.ts for the
  // command-driven equivalents.

  it("respecs mutagen", () => {
    const game = mkgame({ mutagen: 100000, ascension: 1, nexus: "1e999", energy: "1e999" });
    const mutagen = game.unit("mutagen");
    const mutant = game.unit("mutanthatchery");
    const mutant2 = game.unit("mutantbat");
    expect(mutant.count().toNumber()).toBe(0);
    expect(mutant2.count().toNumber()).toBe(0);
    game.upgrade("mutatehatchery").buy();
    game.upgrade("mutatebat").buy();
    expect(mutant.count().toNumber()).toBe(1);
    expect(mutant2.count().toNumber()).toBe(1);
    mutant.buy(39998);
    mutant2.buy(40000);
    expect(mutant.count().toNumber()).toBe(39999);
    expect(mutant2.count().toNumber()).toBe(40001);
    expect(mutagen.count().toNumber()).toBe(4376); // upgrades cost 1 + 15625 - 2 free upgrade-units = 15624
    expect(game.respecSpent().toNumber()).toBe(95624);
    expect(mutant.isVisible()).toBe(true);
    expect(mutant2.isVisible()).toBe(true);
    game.respec();
    expect(mutant.count().toNumber()).toBe(0);
    expect(mutant2.count().toNumber()).toBe(0);
    expect(mutant.isVisible()).toBe(false);
    expect(mutant2.isVisible()).toBe(false);
    expect(mutagen.count().toNumber()).toBe(100000); // 100% refunded
  });

  it("has sane ascension costs", () => {
    const game = mkgame({ nexus: 1e100, energy: 1e100 });
    const ascends = game.unit("ascension");
    const warps = game.upgrade("swarmwarp");
    const mutants = game.unit("mutantnexus");
    expect(game.ascendEnergySpent().toNumber()).toBe(0);
    expect(game.ascendCost().toNumber()).toBe(5000000);
    ascends._setCount(1);
    expect(game.ascendCost().toNumber()).toBe(5600000);
    ascends._setCount(2);
    expect(game.ascendCost().toNumber()).toBe(6272000);
    ascends._setCount(0);
    warps._setCount(25);
    expect(game.ascendEnergySpent().toNumber()).toBe(50000);
    expect(game.ascendCost().toNumber()).toBe(2500000);
    warps._setCount(50);
    expect(game.ascendEnergySpent().toNumber()).toBe(100000);
    expect(game.ascendCost().toNumber()).toBe(1250000);
    warps._setCount(75);
    expect(game.ascendEnergySpent().toNumber()).toBe(150000);
    expect(game.ascendCost().toNumber()).toBe(625000);
    ascends._setCount(1);
    expect(game.ascendEnergySpent().toNumber()).toBe(150000);
    expect(game.ascendCost().toNumber()).toBe(700000);
    // mutant lepidoptera increase ascension cost (compensating for increased energy gains)
    mutants._setCount(1000);
    expect(game.ascendEnergySpent().toNumber()).toBe(150000);
    expect(game.ascendCost().toNumber()).toBe(989950);
    // free-respec doesn't reset spent energy
    game.unit("freeRespec")._setCount(game.unit("freeRespec").unittype.init); //backfill covers this for existing folks
    expect(game.unit("freeRespec").count().toNumber()).toBe(4);
    game.respecFree();
    expect(mutants.count().toNumber()).toBe(0);
    expect(game.unit("freeRespec").count().toNumber()).toBe(3);
    expect(game.ascendCost().toNumber()).toBe(700000);
    // respecing resets spent energy
    mutants._setCount(1000);
    warps._setCount(400);
    expect(game.respecCost().toNumber()).toBe(163);
    game.respec();
    expect(mutants.count().toNumber()).toBe(0);
    expect(game.ascendEnergySpent().toNumber()).toBe(163);
    expect(game.ascendCost().toNumber()).toBe(5587361);
  });

  it("ascends", () => {
    const game = mkgame({ drone: 100, premutagen: 100 });
    expect(game.unit("ascension").count().toNumber()).toBe(0);
    expect(game.unit("drone").count().toNumber()).toBe(100);
    expect(game.unit("premutagen").count().toNumber()).toBe(100);
    expect(game.unit("mutagen").count().toNumber()).toBe(0);
    expect(game.unit("nexus").count().toNumber()).toBe(0);
    expect(game.unit("energy").count().toNumber()).toBe(0);
    expect(game.session.state.date.restarted!.getTime()).toBe(0);
    game.now = new Date(1);
    expect(() => game.ascend()).toThrow();
    expect(game.unit("drone").count().toNumber()).toBe(100);
    game.unit("nexus")._setCount(9e999);
    game.unit("energy")._setCount(9e999);
    game.ascend();
    expect(game.unit("ascension").count().toNumber()).toBe(1);
    expect(game.unit("drone").count().toNumber()).toBe(0);
    expect(game.unit("premutagen").count().toNumber()).toBe(0);
    expect(game.unit("mutagen").count().toNumber()).toBe(100);
    expect(game.unit("nexus").count().toNumber()).toBe(0);
    expect(game.unit("energy").count().toNumber()).toBe(0);
    expect(game.session.state.date.restarted!.getTime()).toBe(1);
  });
});

// compile-time: the runtime classes satisfy the structural interfaces the leaf modules use
export function _typecheck(game: Game, effect: Effect) {
  const g: GameLike = game;
  const u: UnitLike = game.unit("drone");
  const p: ParseNumberUnit = game.unit("drone");
  const up: UpgradeLike = game.upgrade("expansion");
  const e: EffectLike = effect;
  return [g, u, p, up, e];
}
