import Decimal from "decimal.js";
import { Tab, UnitLike } from "../src";

function mkunit(name: string, tab: string | undefined, empower: number = 0, disabled = false): UnitLike {
  return {
    name,
    unittype: { name, tab, disabled, slug: name + "-slug" },
    isVisible: () => true,
    isNewlyUpgradable: () => name === "b2",
    stat: (_n: string, d: Decimal.Value = 0) => (empower ? new Decimal(empower) : new Decimal(d)),
  } as any;
}

describe("tab", () => {
  it("should do something", () => {
    expect(!!Tab).toBe(true);
  });

  const units = [
    mkunit("a1", "a"),
    mkunit("a2", "a"),
    mkunit("b1", "b"),
    mkunit("b2", "b", 5),
    mkunit("b3", "b", 2),
    mkunit("hidden", undefined),
    mkunit("off", "a", 0, true),
  ];

  it("builds tabs", () => {
    const tabs = Tab.buildTabs(units);
    expect(tabs.list.map((t) => t.name)).toEqual(["a1", "b1"]);
    expect(tabs.list.map((t) => t.index)).toEqual([0, 1]);
    expect(Object.keys(tabs.byName).sort()).toEqual(["a", "all", "b"]);
    expect(tabs.byUnit.b2.name).toBe("b1");
    expect(tabs.byUnit.hidden).toBeUndefined();
    expect(tabs.byUnit.off).toBeUndefined();
    // tabs are named for their lead unit; 'all' is not reversed
    expect(tabs.byName.all.sortedUnits.map((u) => u.name)).toEqual(["a1", "a2", "b1", "b2", "b3"]);
    expect(tabs.byName.a.sortedUnits.map((u) => u.name)).toEqual(["a2", "a1"]);
  });

  it("navigates, sorts, and builds urls", () => {
    const tabs = Tab.buildTabs(units);
    const b = tabs.byName.b;
    expect(b.next("b1")!.name).toBe("b2");
    expect(b.next(units[2])!.name).toBe("b2");
    expect(b.prev("b2")!.name).toBe("b1");
    expect(b.next("b3")).toBeUndefined();
    expect(b.prev("b1")).toBeUndefined();
    expect(b.sortUnits().map((u) => u.name)).toEqual(["b2", "b3", "b1"]);
    expect(b.isVisible()).toBe(true);
    expect(b.isNewlyUpgradable()).toBe(true);
    expect(tabs.byName.a.isNewlyUpgradable()).toBe(false);
    expect(b.url()).toBe("/tab/b1");
    expect(b.url(units[3])).toBe("/tab/b1/unit/b2-slug");
    b.lastselected = units[4];
    expect(b.url()).toBe("/tab/b1/unit/b3-slug");
  });
});
