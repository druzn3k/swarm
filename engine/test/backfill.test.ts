// Port of swarmsim-coffee/test/spec/services/backfill.coffee
import { Backfill, createGame } from "../src";

describe("Service: Backfill", () => {
  it("should do something", () => {
    expect(!!Backfill).toBe(true);
  });

  it("grants free respecs to fresh games", () => {
    const e = createGame({ now: () => new Date("2020-01-01T00:00:00Z") });
    expect(e.game.unit("freeRespec").count().toNumber()).toBe(4);
  });

  it("restores a lost ascension count from statistics", () => {
    const e = createGame({ now: () => new Date("2020-01-01T00:00:00Z") });
    e.session.state.statistics.byUnit.ascension = { clicks: 3, num: 3, twinnum: 3 };
    e.backfill.run(e.game);
    expect(e.game.unit("ascension").count().toNumber()).toBe(3);
  });
});
