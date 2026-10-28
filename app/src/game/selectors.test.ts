import { describe, expect, it } from "vitest";
import { createGame } from "@swarmsim/engine";
import { defaultUnit, tabByName } from "./selectors";

describe("defaultUnit (laptop layout, no unit in the route)", () => {
  it("shows the tab's lead unit", () => {
    const { game } = createGame();
    expect(defaultUnit(game, "meat")).toBe("meat");
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
    expect(defaultUnit(game, "meat")).toBe("meat");
    meat.lastselected = game.unit("pantheon");
    expect(defaultUnit(game, "meat")).toBe("meat");
    // "all units" remembers its own
    tabByName(game, "all")!.lastselected = game.unit("queen");
    expect(defaultUnit(game, "all")).toBe("queen");
  });
});
