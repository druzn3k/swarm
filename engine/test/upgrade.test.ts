// Port of swarmsim-coffee/test/spec/services/upgrade.coffee
import * as _ from "lodash";
import Decimal from "decimal.js";
import { buildTypes } from "../src";
import { mkgame } from "./helpers";

describe("Service: upgradetype", () => {
  const { upgradetypes } = buildTypes({ state: { date: { started: new Date(0) } } });
  it("should parse the spreadsheet", () => {
    expect(!!upgradetypes).toBe(true);
    expect(!!upgradetypes.list).toBe(true);
    expect(upgradetypes.list.length).toBeGreaterThan(4);
  });
});

describe("Service: upgrade", () => {
  it("buys upgrades", () => {
    const game = mkgame({ territory: 999999999 });
    const upgrade = game.upgrade("expansion");
    expect(upgrade).toBe(game.unit("invisiblehatchery").upgrades.byName["expansion"]);
    expect(upgrade.count().toNumber()).toBe(0);
    upgrade.buy();
    expect(upgrade.count().toNumber()).toBe(1);
  });

  it("blocks expensive upgrades", () => {
    const game = mkgame({ territory: 1 });
    const upgrade = game.upgrade("expansion");
    expect(upgrade.count().toNumber()).toBe(0);
    expect(() => upgrade.buy()).toThrow();
    expect(upgrade.count().toNumber()).toBe(0);
  });

  it("calcs upgrade stats, no unit", () => {
    const game = mkgame({ drone: 99999999999999 });
    const upgrade = game.upgrade("droneprod");
    const upgrade2 = game.upgrade("queenprod");
    let stats: any = {};
    const schema = {};
    upgrade.calcStats(stats, schema);
    expect(stats.prod.toNumber()).toBe(1);
    let stats2: any = {};
    upgrade2.calcStats(stats2, schema);
    expect(stats2.prod.toNumber()).toBe(1);

    upgrade.buy();
    stats = {};
    upgrade.calcStats(stats, schema);
    expect(stats.prod.toNumber()).toBeGreaterThan(1);
    stats2 = {};
    upgrade2.calcStats(stats2, schema);
    expect(stats2.prod.toNumber()).toBe(1);
  });

  it("buys/calcs max upgrades", () => {
    const game = mkgame({ territory: 9 });
    const upgrade = game.upgrade("expansion");
    expect(upgrade.maxCostMet().toNumber()).toBe(0);
    game.unit("territory")._setCount(10);
    expect(upgrade.maxCostMet().toNumber()).toBe(1);
    game.unit("territory")._setCount(50);
    expect(upgrade.maxCostMet().toNumber()).toBe(2);
    game.unit("territory")._setCount(1000);
    expect(upgrade.maxCostMet().toNumber()).toBe(5);
    upgrade.buyMax();
    expect(upgrade.maxCostMet().toNumber()).toBe(0);
    expect(upgrade.count().toNumber()).toBe(5);
  });

  it("clones larvae", () => {
    const game = mkgame({ energy: 9999999999999999999, larva: 1000, invisiblehatchery: 1, nexus: 999 });
    const upgrade = game.upgrade("clonelarvae");
    const unit = game.unit("larva");
    expect(upgrade.effect[0].bank().toNumber()).toBe(1000);
    expect(upgrade.effect[0].output().toNumber()).toBe(1000);
    upgrade.buy(3);
    expect(upgrade.count().toNumber()).toBe(3);
    expect(unit.count().toNumber()).toBe(8000);
    expect(upgrade.effect[0].bank().toNumber()).toBe(8000);
    expect(upgrade.effect[0].output().toNumber()).toBe(8000);
  });

  it("buy more than max", () => {
    const game = mkgame({ territory: 10 });
    const upgrade = game.upgrade("expansion");
    expect(upgrade.maxCostMet().toNumber()).toBe(1);
    expect(upgrade.count().toNumber()).toBe(0);
    upgrade.buy(10);
    expect(upgrade.maxCostMet().toNumber()).toBe(0);
    expect(upgrade.count().toNumber()).toBe(1);
  });

  it("clones cocoons", () => {
    const game = mkgame({ energy: 1e39, cocoon: 100, larva: 10, invisiblehatchery: 1, nexus: 999 });
    const cocoon = game.unit("cocoon");
    const larva = game.unit("larva");
    const upgrade = game.upgrade("clonelarvae");
    expect(cocoon.count().toNumber()).toBe(100);
    expect(larva.count().toNumber()).toBe(10);
    expect(upgrade.effect[0].bank().toNumber()).toBe(110);
    expect(upgrade.effect[0].cap().toNumber()).toBe(100000);
    expect(upgrade.effect[0].output().toNumber()).toBe(110);
    upgrade.buy();
    expect(cocoon.count().toNumber()).toBe(100); // no change
    expect(larva.count().toNumber()).toBe(120); // 0 base larvae + 100 cloned cocoons + 10 cloned larvae + 10 starting larvae
  });

  it("caps clones", () => {
    const game = mkgame({ energy: 1e39, cocoon: 60000, larva: 70000, invisiblehatchery: 1, nexus: 999 });
    const cocoon = game.unit("cocoon");
    const larva = game.unit("larva");
    const upgrade = game.upgrade("clonelarvae");
    expect(cocoon.count().toNumber()).toBe(60000);
    expect(larva.count().toNumber()).toBe(70000);
    expect(upgrade.effect[0].bank().toNumber()).toBe(130000);
    expect(upgrade.effect[0].cap().toNumber()).toBe(100000);
    expect(upgrade.effect[0].output().toNumber()).toBe(100000);
    upgrade.buy();
    expect(cocoon.count().toNumber()).toBe(60000); // no change
    expect(larva.count().toNumber()).toBe(170000); // 70k base larvae + 100k cloned capped bank
    // cap is unchanged after clone
    expect(upgrade.effect[0].bank().toNumber()).toBe(230000);
    expect(upgrade.effect[0].cap().toNumber()).toBe(100000);
    expect(upgrade.effect[0].output().toNumber()).toBe(100000);
  });

  it("sums costs", () => {
    const game = mkgame({ territory: 9 });
    const upgrade = game.upgrade("expansion");
    expect(_.map(upgrade.sumCost(1), (cost) => [cost.unit.name, cost.val.toNumber()])).toEqual([["territory", 10]]);
    expect(_.map(upgrade.sumCost(3), (cost) => [cost.unit.name, cost.val.toNumber()])).toEqual([["territory", 94.525]]);
  });

  it("notices newly available upgrades", () => {
    const game = mkgame({ territory: 9 });
    const upgrade = game.upgrade("expansion");
    expect(upgrade.isNewlyUpgradable()).toBe(false);
    upgrade.watch(false);
    expect(upgrade.isNewlyUpgradable()).toBe(false);
    upgrade.watch(true);
    expect(upgrade.isNewlyUpgradable()).toBe(false);
    // we now have money for an upgrade
    game.unit("territory")._addCount(1);
    expect(upgrade.isNewlyUpgradable()).toBe(true);
    // upon disabling isWatched, remove the indicator
    upgrade.watch(false);
    expect(upgrade.isNewlyUpgradable()).toBe(false);
    upgrade.watch(true);
    expect(upgrade.isNewlyUpgradable()).toBe(true);
    // stays removed when upgrade bought
    upgrade.buy();
    expect(upgrade.isNewlyUpgradable()).toBe(false);
    // we now have money for another upgrade, which disappears when watch disabled
    game.unit("territory")._addCount(50);
    expect(upgrade.isNewlyUpgradable()).toBe(true);
    upgrade.watch(false);
    expect(upgrade.isNewlyUpgradable()).toBe(false);
    // money for a third upgrade does not make the indicator reappear, since we didn't buy upgrade #2
    game.unit("territory")._addCount(150);
    expect(upgrade.isNewlyUpgradable()).toBe(false);
  });

  const rush = (name: string, unitname: string, counts: any, out0: number, out1: number) => () => {
    const game = mkgame(counts);
    const upgrade = game.upgrade(name);
    const unit = game.unit(unitname);
    expect(upgrade.effect[0].output().toNumber()).toBe(out0);
    expect(upgrade.effect[1].output().toNumber()).toBe(out1);
    upgrade.buy(1);
    expect(upgrade.count().toNumber()).toBe(1);
    expect(unit.count().toNumber()).toBe(out0 + out1);
    expect(upgrade.effect[0].output().toNumber()).toBe(out0);
    expect(upgrade.effect[1].output().toNumber()).toBe(out1);
  };
  it(
    "rushes meat",
    rush("meatrush", "meat", { energy: 9999999999999999999, nexus: 999, invisiblehatchery: 1, drone: 1, stinger: 1 }, 1 * 7200, 100000000000)
  );
  it("rushes territory", () => {
    expect(504).toBe(new Decimal(0.07).times(7200).toNumber()); //stupid floating-point precision
    rush("territoryrush", "territory", { energy: 9999999999999999999, nexus: 999, invisiblehatchery: 1, drone: 1, swarmling: 1 }, 504, 1000000000)();
  });
  it(
    "rushes larvae",
    rush("larvarush", "larva", { energy: 9999999999999999999, nexus: 999, invisiblehatchery: 1, drone: 1, swarmling: 1 }, 2400, 100000)
  );

  const spawns = (upname: string, counts: any, n: number) => () => {
    const game = mkgame(counts);
    const hatchery = game.upgrade(upname);
    const premutagen = game.unit("premutagen");
    hatchery.buy(n);
    expect(premutagen.count().toNumber()).toBe(0);
    const eff = hatchery.effect[1];
    // Random range, but consistent.
    expect(eff.type.name).toBe("addUnitRand");
    const spawned = eff.outputNext().qty.toNumber();
    expect(eff.outputNext().qty.toNumber()).toBe(spawned);
    expect(eff.outputNext().qty.toNumber()).toBe(spawned);
    expect(eff.outputNext().qty.toNumber()).toBe(spawned);
    hatchery.buy(1);
    // first spawn is guaranteed.
    expect(premutagen.count().toNumber()).toBe(spawned);
    expect(premutagen.count().toNumber()).not.toBeGreaterThan(10000);
    expect(premutagen.count().toNumber()).not.toBeLessThan(7000);
  };
  it("randomly spawns premutagen when buying hatcheries", spawns("hatchery", { meat: 9e100, premutagen: 0 }, 39));
  it("randomly spawns premutagen when buying expansions", spawns("expansion", { territory: 9e999, premutagen: 0 }, 79));

  it("rolls different mutagen values after ascending; mutagen spawns depend on date", () => {
    const game = mkgame({ invisiblehatchery: 1, meat: 1e100 });
    expect(game.session.state.date.restarted!.getTime()).toBe(0);
    const premutagen = game.unit("premutagen");
    game.upgrade("hatchery").buy(80);
    const precount = premutagen.count();
    expect(precount.isZero()).toBe(false); //sanity check

    // rolls change when date.restarted changes
    game.now = new Date(1);
    game.ascend(true);
    expect(game.session.state.date.restarted!.getTime()).toBe(1);
    game.unit("meat")._setCount(1e100);
    game.upgrade("hatchery").buy(80);
    const postcount = premutagen.count();
    expect(precount.toNumber()).not.toBe(postcount.toNumber());

    // but change the date back, and mutagen rolls are identical
    game.ascend(true);
    game.session.state.date.restarted = new Date(0);
    game.unit("meat")._setCount(1e100);
    game.upgrade("hatchery").buy(80);
    expect(precount.toNumber()).toBe(premutagen.count().toNumber());
  });

  it("swarmwarps without changing energy", () => {
    const game = mkgame({ energy: 50000, nexus: 999, invisiblehatchery: 1, drone: 1, meat: 0 });
    const upgrade = game.upgrade("swarmwarp");
    const energy = game.unit("energy");
    expect(energy.count().toNumber()).toBe(50000);
    upgrade.buy(1);
    expect(energy.count().toNumber()).toBe(48000);
    upgrade.buy(1);
    expect(energy.count().toNumber()).toBe(46000);
  });
  it("won't exceed maxlevel in count()", () => {
    const game = mkgame({});
    const upgrade = game.upgrade("achievementbonus");
    expect(upgrade.type.maxlevel).toBe(5);
    expect(upgrade.count().toNumber()).toBe(0);
    upgrade._setCount(999);
    expect(upgrade.count().toNumber()).toBe(5);
  });

  it("won't buy more than maxlevel", () => {
    const game = mkgame({ meat: 1e300, territory: 1e300 });
    const upgrade = game.upgrade("achievementbonus");
    expect(upgrade.type.maxlevel).toBe(5);
    expect(upgrade.count().toNumber()).toBe(0);
    expect(upgrade.maxCostMet().toNumber()).toBe(5);
    upgrade._setCount(1);
    expect(upgrade.count().toNumber()).toBe(1);
    expect(upgrade.maxCostMet().toNumber()).toBe(4);
    upgrade._setCount(3);
    expect(upgrade.count().toNumber()).toBe(3);
    expect(upgrade.maxCostMet().toNumber()).toBe(2);
  });

  it("knows autobuyable upgrades depend on watched status", () => {
    const game = mkgame({});
    expect(game.upgrade("droneprod").isAutobuyable()).toBe(true);
    expect(game.upgrade("dronetwin").isAutobuyable()).toBe(true);
    expect(game.upgrade("swarmlingtwin").isAutobuyable()).toBe(true);
    expect(game.upgrade("mutatemeat").isAutobuyable()).toBe(false);
    game.upgrade("dronetwin").watch(false);
    expect(game.upgrade("dronetwin").isAutobuyable()).toBe(false);
    game.upgrade("dronetwin").watch(true);
    expect(game.upgrade("dronetwin").isAutobuyable()).toBe(true);
  });

  it("calculates asymptotic stats multiplicatively, not additively. #264", () => {
    const game = mkgame({ nexus: 5, moth: 1e1000, mutantnexus: 1e1000 });
    const energyprod = game.unit("energy").velocity().toNumber();
    expect(energyprod).toBeGreaterThan(1.9);
    expect(energyprod).toBeLessThan(2.1);
  });

  it("fetches empty stats", () => {
    const game = mkgame({});
    expect(() => game.upgrade("nexus1").statistics()).not.toThrow();
  });

  it("buys-all, accounting for watch points", () => {
    const game = mkgame({});
    const up = game.upgrade("expansion");
    const unit = game.unit("territory");
    expect(game.availableAutobuyUpgrades().length).toBe(0);
    unit._setCount(10);
    expect(game.availableAutobuyUpgrades().length).toBe(1);
    unit._setCount(9);
    expect(game.availableAutobuyUpgrades().length).toBe(0);

    up.watch(2);
    expect(game.availableAutobuyUpgrades().length).toBe(0);
    unit._setCount(10);
    expect(game.availableAutobuyUpgrades().length).toBe(0);
    unit._setCount(20);
    expect(game.availableAutobuyUpgrades().length).toBe(1);
    unit._setCount(19);
    expect(game.availableAutobuyUpgrades().length).toBe(0);
  });

  it("returns cacheSafe as a number, not a boolean", () => {
    const game = mkgame({ drone: 10 });
    const est = game.upgrade("hatchery").estimateSecsUntilBuyable();
    expect(est.cacheSafe).toBe(1);
    expect(est.unit!.name).toBe("meat");
    expect(est.val.toNumber()).toBe(30);
  });
});
