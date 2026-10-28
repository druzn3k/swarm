import Decimal from "decimal.js";
import {
  spreadsheet,
  buildTypes,
  buildEffectTypes,
  SeedRand,
  romanize,
  UnitTypes,
  UpgradeTypes,
  AchievementTypes,
  EffectLike,
  GameLike,
} from "../src";

const session = { state: { date: { started: new Date(0) } } };

describe("type tables from the real spreadsheet", () => {
  const t = buildTypes(session);

  it("builds all tables", () => {
    expect(t.unittypes).toBeInstanceOf(UnitTypes);
    expect(t.upgradetypes).toBeInstanceOf(UpgradeTypes);
    expect(t.achievements).toBeInstanceOf(AchievementTypes);
    expect(t.unittypes.list.length).toBeGreaterThan(10);
    expect(t.upgradetypes.list.length).toBeGreaterThan(4);
    expect(t.achievements.list.length).toBeGreaterThan(0);
    expect(t.unittypes.list.length).toBe(Object.keys(t.unittypes.byName).length);
    expect(t.achievements.pointsPossible()).toBeGreaterThan(0);
  });

  it("is deterministic and repeatable", () => {
    const t2 = buildTypes(session, spreadsheet());
    expect(t2.unittypes.list.map((u) => u.name)).toEqual(t.unittypes.list.map((u) => u.name));
    expect(t2.upgradetypes.list.map((u) => u.name)).toEqual(t.upgradetypes.list.map((u) => u.name));
  });

  it("resolves unit refs", () => {
    const { byName } = t.unittypes;
    const drone = byName.drone;
    expect(drone.cost.map((c: any) => c.unittype.name).sort()).toEqual(["larva", "meat"]);
    for (const c of drone.cost) expect(c.unittype).toBe(byName[c.unittype.name]);
    const queen = byName.queen;
    expect(queen.prod.map((p: any) => p.unittype.name)).toContain("drone");
    expect(byName.drone.producedBy).toContain(queen);
    expect(drone.slug).toBe(drone.label);
  });

  it("should build a production-graph (minimal)", () => {
    for (const ancestor of ["hive", "nest", "queen", "drone"]) {
      expect(t.unittypes.byName.meat.producerPath[ancestor]).not.toBeUndefined();
    }
    expect(t.unittypes.byName.meat.producerPath.territory).toBeUndefined();
    expect(t.unittypes.byName.meat.producerNames().drone).toEqual([["drone"]]);
  });

  it("resolves upgrade refs", () => {
    const up = t.upgradetypes.byName.expansion;
    expect(up).toBeDefined();
    expect(up.unittype).toBe(t.unittypes.byName.invisiblehatchery);
    for (const u of t.upgradetypes.list) {
      expect(u.unittype).toBeTruthy();
      for (const c of u.cost) expect(c.unittype.name).toBeTruthy();
      for (const e of u.effect) expect(t.effecttypes.byName[e.type.name]).toBe(e.type);
    }
    expect(t.upgradetypes.byName.dronetwin).toBeDefined();
  });

  it("resolves achievement refs", () => {
    const drone1 = t.achievements.byName.drone1;
    expect(drone1.points).toBe(10);
    expect(Array.isArray(drone1.requires)).toBe(true);
  });

  it("registers every effect type the spreadsheet uses", () => {
    expect(Object.keys(t.effecttypes.byName).sort()).toEqual(
      [
        "addStat", "addUnit", "addUnitByVelocity", "addUnitRand", "addUnitTimed", "addUpgrade",
        "asympStat", "compoundUnit", "expStat", "initStat", "logStat", "multStat",
        "multStatPerAchievementPoint", "skipTime", "suffix",
      ].sort()
    );
  });
});

describe("effecttypes", () => {
  const effecttypes = buildEffectTypes(new SeedRand(session));
  const calc = (name: string, effect: any, stats: any, schema: any, level: number) =>
    effecttypes.byName[name].calcStats!(effect as EffectLike, stats, schema, level as any);

  it("validates mult vs add - effects must be commutative", () => {
    const schema = {};
    const stats: any = {};
    calc("multStat", { stat: "x", val: 3 }, stats, schema, 1);
    expect(stats.x.toNumber()).toBe(3);
    calc("multStat", { stat: "x", val: 3 }, stats, schema, 2);
    expect(stats.x.toNumber()).toBe(27);
    calc("addStat", { stat: "t", val: 3 }, stats, schema, 1);
    expect(stats.t.toNumber()).toBe(3);
    calc("addStat", { stat: "t", val: 3 }, stats, schema, 3);
    expect(stats.t.toNumber()).toBe(12);
    expect(() => calc("addStat", { stat: "x", val: 3 }, stats, schema, 1)).toThrow();
    expect(() => calc("multStat", { stat: "t", val: 3 }, stats, schema, 1)).toThrow();
  });

  it("romanizes", () => {
    expect(romanize(2)).toBe("II");
    expect(romanize(6)).toBe("VI");
    expect(romanize(21)).toBe("XXI");
    expect(romanize(51)).toBe("LI");
    expect(romanize(100)).toBe("C");
    expect(romanize(1000)).toBe("M");
    expect(romanize(3999)).toBe("MMMCMXCIX");
    expect(romanize(0)).toBe(false);
  });

  it("suffix effect sets unit suffix and empower", () => {
    const unit: any = {};
    const stats: any = {};
    const eff: any = { unit };
    effecttypes.byName.suffix.calcStats!(eff, stats, {}, new Decimal(0));
    expect(unit.suffix).toBe("");
    effecttypes.byName.suffix.calcStats!(eff, stats, {}, new Decimal(2));
    expect(unit.suffix).toBe("III");
    expect(stats.empower.toNumber()).toBe(2);
    effecttypes.byName.suffix.calcStats!(eff, stats, {}, new Decimal(5000));
    expect(unit.suffix).toBe("5001");
  });

  it("addUnit onBuy adds power*val units", () => {
    const added: any[] = [];
    const eff: any = {
      val: 3,
      power: () => new Decimal(2),
      unit: { _addCount: (n: any) => added.push(n.toNumber()) },
    };
    const game = {} as GameLike;
    effecttypes.byName.addUnit.onBuy!(eff, game);
    effecttypes.byName.addUnit.onBuyUnit!(eff, game, undefined, 4);
    expect(added).toEqual([6, 24]);
  });

  it("addUnitRand is deterministic given the session", () => {
    const mk = () => {
      const added: any[] = [];
      const eff: any = {
        val: 1.5,
        parent: { name: "p", count: () => new Decimal(8) },
        unit: { name: "u", count: () => new Decimal(0), _addCount: (n: any) => added.push(n.toString()) },
        parentStat: (n: string, d?: any) =>
          n.startsWith("random.minlevel") ? new Decimal(3) : new Decimal(n === "random.freq" ? 0.5 : d ?? 0),
      };
      const game: any = {
        now: new Date(5),
        cache: { firstSpawn: {} },
        session: { state: { date: { started: new Date(0) } } },
      };
      effecttypes.byName.addUnitRand.onBuy!(eff, game);
      return { added, game };
    };
    const a = mk();
    expect(a.added.length).toBe(1); // level 8 always spawns
    expect(mk().added).toEqual(a.added);
    expect(a.game.cache.firstSpawn.u).toEqual(new Date(5));
    expect(a.game.session.state.date.restarted).toEqual(new Date(0));
  });
});
