import { describe, expect, it } from "vitest";
import { createGame } from "@swarmsim/engine";
import { defaultUnit, tabByName, unitNeighbours, visibleUnits } from "./selectors";

describe("visibleUnits (the old game's order)", () => {
  it("lists the most advanced unit first and the cheapest last", () => {
    const { game } = createGame();
    for (const u of ["drone", "queen", "nest", "greaterqueen"]) game.unit(u)._setCount(1);
    const meat = visibleUnits(tabByName(game, "meat")!).map((u) => u.name);
    expect(meat[meat.length - 1]).toBe("meat");
    expect(meat.slice(-5)).toEqual(["greaterqueen", "nest", "queen", "drone", "meat"]);
    // "all units" keeps the spreadsheet order, cheapest first, like the old game
    expect(visibleUnits(tabByName(game, "all")!)[0].name).toBe("meat");
  });
  it("gives prev/next as the cards above and below", () => {
    const { game } = createGame();
    for (const u of ["drone", "queen"]) game.unit(u)._setCount(1);
    const meat = tabByName(game, "meat")!;
    const n = unitNeighbours(meat, game.unit("drone"));
    expect(n.above?.name).toBe("queen");
    expect(n.below?.name).toBe("meat");
    expect(unitNeighbours(meat, game.unit("meat")).below).toBeUndefined();
  });
});

describe("defaultUnit (laptop layout, no unit in the route)", () => {
  it("shows the tab's lead unit, or the cheapest unit with something to do", () => {
    const { game } = createGame();
    // meat has nothing to buy, so a new game opens on drones
    expect(defaultUnit(game, "meat")).toBe("drone");
    game.unit("queen")._setCount(1);
    game.unit("nest")._setCount(1);
    expect(defaultUnit(game, "meat")).toBe("drone");
    // territory has nothing to buy either: swarmlings
    game.unit("territory")._setCount(1);
    game.unit("swarmling")._setCount(1);
    game.unit("stinger")._setCount(1);
    expect(defaultUnit(game, "territory")).toBe("swarmling");
    expect(defaultUnit(game, "larva")).toBe("larva");
    expect(defaultUnit(game, "nope")).toBe("");
  });
  it("prefers the unit last opened on the tab, while it is visible and on the tab", () => {
    const { game } = createGame();
    game.unit("drone")._setCount(1);
    game.unit("queen")._setCount(1);
    const meat = tabByName(game, "meat")!;
    meat.lastselected = game.unit("queen");
    expect(defaultUnit(game, "meat")).toBe("queen");
    // a unit from another tab, or one that is hidden again (after an ascension), is ignored
    meat.lastselected = game.unit("larva");
    expect(defaultUnit(game, "meat")).toBe("drone");
    meat.lastselected = game.unit("pantheon");
    expect(defaultUnit(game, "meat")).toBe("drone");
    // "all units" remembers its own
    tabByName(game, "all")!.lastselected = game.unit("queen");
    expect(defaultUnit(game, "all")).toBe("queen");
  });
});
