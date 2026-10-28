// Port of swarmsim-coffee/test/spec/services/achievements.coffee, plus the
// event-achievements the old app wired through $rootScope.
import * as _ from "lodash";
import Decimal from "decimal.js";
import { Achievement, buildTypes, createGame } from "../src";

describe("Service: achievements", () => {
  const { achievements } = buildTypes({ state: { date: { started: new Date(0) } } });
  const game: any = { session: { state: { achievements: {} } }, withUnreifiedSave: (fn: () => any) => fn() };

  it("should do something", () => {
    expect(!!achievements).toBe(true);
    expect(achievements.list.length).toBeGreaterThan(0);
  });

  it("earns", () => {
    const achieve = new Achievement(game, achievements.byName.drone1);
    expect(achieve.isEarned()).toBe(false);
    expect(achieve.earnedAtMillisElapsed()).toBeUndefined();
    expect(achieve.pointsEarned()).toBe(0);
    achieve.earn(55);
    expect(achieve.isEarned()).toBe(true);
    expect(achieve.earnedAtMillisElapsed()).toBe(55);
    expect(achieve.pointsEarned()).toBe(10);
  });

  it("describes", () => {
    for (const achievement of achievements.list) {
      const a = new Achievement(game, achievement);
      expect(() => a.description()).not.toThrow();
      expect(_.includes(a.description(), "$REQUIRE")).toBe(false);
    }
  });
});

describe("AchievementsListener", () => {
  const now = () => new Date("2020-01-01T00:00:00Z");

  it("earns event achievements, validating the payload", () => {
    const e = createGame({ now });
    const achieved: string[] = [];
    e.events.on("achieve", (a) => achieved.push(a.name));
    e.events.emit("achieveclick", { name: "nope" });
    expect(e.game.achievement("clickme").isEarned()).toBe(false);
    e.events.emit("achieveclick", { name: "clickme" });
    expect(e.game.achievement("clickme").isEarned()).toBe(true);
    e.events.emit("konami");
    expect(e.game.achievement("konami").isEarned()).toBe(true);
    e.events.emit("import", { source: "options", success: false });
    expect(e.game.achievement("import").isEarned()).toBe(false);
    e.events.emit("import", { source: "options", success: true });
    expect(e.game.achievement("import").isEarned()).toBe(true);
    expect(achieved).toEqual(["clickme", "konami", "import"]);
  });

  it("counts bought units (statistics), not produced ones", () => {
    const e = createGame({ now });
    const g = e.game;
    g.withSave(() => {
      g.unit("meat")._setCount(1e12);
      g.unit("larva")._setCount(1e12);
      g.unit("queen")._setCount(1e6);
    });
    expect(g.unit("drone").count().greaterThan(1e6)).toBe(false);
    e.commands.buyUnit({ unit: g.unit("drone"), num: new Decimal(1) });
    expect(g.achievement("drone1").isEarned()).toBe(true);
    expect(g.achievement("drone2").isEarned()).toBe(false);
    expect(g.unit("drone").statistics().twinnum.toString()).toBe("1");
  });

  it("swallows listener exceptions", () => {
    const errors: string[] = [];
    const e = createGame({ now });
    e.events.onListenerError = (event, err) => errors.push(`${event}: ${(err as Error).message}`);
    e.events.on("command", () => {
      throw new Error("boom");
    });
    e.commands.buyUnit({ unit: e.game.unit("drone"), num: 1 });
    expect(errors).toEqual(["command: boom"]);
    expect(e.game.achievement("drone1").isEarned()).toBe(true);
  });
});
