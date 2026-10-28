// Port of swarmsim-coffee/test/spec/services/command.coffee
import Decimal from "decimal.js";
import { createGame, Engine } from "../src";

describe("Service: command", () => {
  let e: Engine;
  beforeEach(() => {
    e = createGame({ now: () => new Date("2020-01-01T00:00:00Z") });
  });

  it("should do something", () => {
    expect(!!e.commands).toBe(true);
  });

  it("can undo", () => {
    const { game, commands } = e;
    game.unit("meat")._setCount(10000);
    game.unit("larva")._setCount(10000);
    const drone = game.unit("drone");
    expect(drone.count().toNumber()).toBe(0);

    commands.buyUnit({ unit: drone, num: 1 });
    expect(!!commands._undo!.isRedo).not.toBe(true);
    // game.importSave rebuilt the units; look them up again
    expect(game.unit("drone").count().toNumber()).toBe(1);

    commands.undo();
    expect(!!commands._undo!.isRedo).toBe(true);
    expect(game.unit("drone").count().toNumber()).toBe(0);

    commands.undo();
    expect(!!commands._undo!.isRedo).toBe(true);
    expect(game.unit("drone").count().toNumber()).toBe(1);
  });

  it("undoes visibility. #639", () => {
    const { game, commands } = e;
    game.unit("mutagen")._setCount(1e99);
    const upgrade = game.upgrade("mutatehatchery");
    const mutant = () => game.unit("mutanthatchery");
    upgrade._setCount(0);
    expect(mutant().count().toNumber()).toBe(0);
    expect(upgrade.count().toNumber()).toBe(0);
    expect(mutant().isVisible()).toBe(false);

    commands.buyUpgrade({ upgrade: upgrade, num: 1 });
    expect(mutant().count().toNumber()).toBe(1);
    expect(game.upgrade("mutatehatchery").count().toNumber()).toBe(1);
    expect(mutant().isVisible()).toBe(true);

    commands.undo();
    expect(mutant().count().toNumber()).toBe(0);
    expect(game.upgrade("mutatehatchery").count().toNumber()).toBe(0);
    expect(mutant().isVisible()).toBe(false);
  });

  it("emits command events; buyAllUpgrades keeps earlier purchases when a later one fails", () => {
    const { game, commands, events } = e;
    const seen: string[] = [];
    events.on("command", (cmd) => seen.push(`${cmd.name}:${cmd.upgradename ?? cmd.unitname ?? ""}`));
    game.withSave(() => game.unit("territory")._setCount(10));
    const expansion = game.upgrade("expansion");
    // the same upgrade twice: the second buy can't afford anything
    expect(() => commands.buyAllUpgrades({ upgrades: [expansion, expansion], percent: 1 })).toThrow("We require more resources");
    expect(game.upgrade("expansion").count().toNumber()).toBe(1);
    expect(seen).toEqual(["buyMaxUpgrade:expansion"]);
    commands.buyUnit({ unit: game.unit("drone"), num: new Decimal(1) });
    expect(seen).toEqual(["buyMaxUpgrade:expansion", "buyUnit:drone"]);
  });
});
