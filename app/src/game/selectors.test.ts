import { describe, expect, it } from "vitest";
import { defaultUnit, tabByName, unitNeighbours, visibleUnits } from "./selectors";
import { storeWith } from "../test/saves";

describe("visibleUnits (the old game's order)", () => {
  it("lists the most advanced unit first and the cheapest last", () => {
    const { g } = storeWith({ units: { drone: 1, queen: 1, nest: 1, greaterqueen: 1 } }).store;
    const meat = visibleUnits(tabByName(g, "meat")!).map((u) => u.name);
    expect(meat[meat.length - 1]).toBe("meat");
    expect(meat.slice(-5)).toEqual(["greaterqueen", "nest", "queen", "drone", "meat"]);
    // "all units" keeps the spreadsheet order, cheapest first, like the old game
    expect(visibleUnits(tabByName(g, "all")!)[0].name).toBe("meat");
  });
  it("gives prev/next as the cards above and below", () => {
    const { g } = storeWith({ units: { drone: 1, queen: 1 } }).store;
    const meat = tabByName(g, "meat")!;
    const n = unitNeighbours(meat, g.unit("drone"));
    expect(n.above?.name).toBe("queen");
    expect(n.below?.name).toBe("meat");
    expect(unitNeighbours(meat, g.unit("meat")).below).toBeUndefined();
  });
});

describe("defaultUnit (laptop layout, no unit in the route)", () => {
  it("shows the tab's lead unit, or the cheapest unit with something to do", () => {
    // meat has nothing to buy, so a new game opens on drones
    expect(defaultUnit(storeWith().store.g, "meat")).toBe("drone");
    expect(defaultUnit(storeWith({ units: { queen: 1, nest: 1 } }).store.g, "meat")).toBe("drone");
    // territory has nothing to buy either: swarmlings
    const g = storeWith({ units: { territory: 1, swarmling: 1, stinger: 1 } }).store.g;
    expect(defaultUnit(g, "territory")).toBe("swarmling");
    expect(defaultUnit(g, "larva")).toBe("larva");
    expect(defaultUnit(g, "nope")).toBe("");
  });
  it("prefers the unit last opened on the tab, while it is visible and on the tab", () => {
    const { g } = storeWith({ units: { drone: 1, queen: 1 } }).store;
    expect(defaultUnit(g, "meat", "queen")).toBe("queen");
    // a unit from another tab, or one that is hidden (after an ascension), is ignored
    expect(defaultUnit(g, "meat", "larva")).toBe("drone");
    expect(defaultUnit(g, "meat", "pantheon")).toBe("drone");
    // "all units" remembers its own
    expect(defaultUnit(g, "all", "queen")).toBe("queen");
  });
});
