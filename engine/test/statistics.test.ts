// Port of swarmsim-coffee/test/spec/services/statistics.coffee
import Decimal from "decimal.js";
import { createGame } from "../src";

describe("Service: statistics", () => {
  it("should do something", () => {
    const e = createGame({ now: () => new Date("2020-01-01T00:00:00Z") });
    expect(!!e.statistics).toBe(true);
  });

  it("records purchases and emits buyFirst once per unit/upgrade", () => {
    const e = createGame({ now: () => new Date("2020-01-01T00:00:00Z") });
    const first: string[] = [];
    e.events.on("buyFirst", (cmd) => first.push(cmd.unitname!));
    e.commands.buyUnit({ unit: e.game.unit("drone"), num: new Decimal(1) });
    e.commands.buyUnit({ unit: e.game.unit("drone"), num: new Decimal(2) });
    const stats = e.session.state.statistics;
    expect(stats.clicks).toBe(2);
    expect(stats.byUnit.drone.clicks).toBe(2);
    expect(stats.byUnit.drone.num.toString()).toBe("3");
    expect(stats.byUnit.drone.twinnum.toString()).toBe("3");
    expect(first).toEqual(["drone"]);
    // reset re-inits statistics
    e.game.reset(true);
    expect(e.session.state.statistics).toEqual({ byUnit: {}, byUpgrade: {}, clicks: 0 });
  });
});
