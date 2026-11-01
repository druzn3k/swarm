import { describe, expect, it } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFormatter } from "../format";
import { GameStore } from "../game/store";
import { craftV1 } from "../test/saves";
import { descriptionNeed, unitDescriptionParas, upgradeDescriptionParas } from "./LiveDescription";

const fmt = createFormatter();
const text = (paras: unknown[]) =>
  renderToStaticMarkup(createElement(Fragment, null, ...paras.map((p, i) => createElement("p", { key: i }, p as never, " "))))
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const LATE = {
  units: {
    meat: "1e40", larva: "1e30", territory: "1e30", drone: "1e30", queen: "1e20", nexus: 5, energy: 10000, nightbug: 1e6, moth: 1e5, bat: 1000,
    crystal: 50, mutagen: 1e9, premutagen: 1e6, ascension: 2, swarmling: 1e20, stinger: 1e18, centipede: 12345,
    mutanthatchery: 5, mutantbat: 100, mutantclone: 100, mutantswarmwarp: 100, mutantrush: 100, mutanteach: 100, mutantfreq: 100, mutantnexus: 100, mutantarmy: 100, mutantmeat: 100,
  },
  upgrades: {
    hatchery: 100, expansion: 80, achievementbonus: 1, nexus1: 1, nexus2: 1, nexus3: 1, nexus4: 1, nexus5: 1,
    mutatehatchery: 1, mutatebat: 1, mutateclone: 1, mutateswarmwarp: 1, mutaterush: 1, mutateeach: 1, mutatefreq: 1, mutatenexus: 1, mutatearmy: 1, mutatemeat: 1,
  },
  at: Date.UTC(2026, 0, 1),
};

function lateGame(units: Record<string, string | number> = {}): GameStore {
  return new GameStore({ save: craftV1({ ...LATE, units: { ...LATE.units, ...units } }), now: () => LATE.at });
}

/** The view a unit's screen has: the unit focused, plus what its descriptions read. */
function viewFor(store: GameStore, unit: string) {
  const release = store.need({}, descriptionNeed(store.g, unit));
  store.refresh();
  release();
  return store.g;
}
const unitText = (store: GameStore, unit: string) => text(unitDescriptionParas(viewFor(store, unit).unit(unit), fmt));
const upgradeText = (store: GameStore, upgrade: string) => {
  // the screen it shows on: a unit in a tab that lists it (hatcheries: larvae)
  const unit = store.statics.units.findIndex((u) => u.tab !== undefined && (u.upgrades ?? []).includes(store.statics.upgradeIndex(upgrade)!));
  return text(upgradeDescriptionParas(viewFor(store, store.statics.units[unit].name).upgrade(upgrade), fmt));
};

describe("live descriptions", () => {
  const game = lateGame();
  const templated = (d: unknown) => d == null || d === "" || d === "-";

  it("gives every templated unit a description", () => {
    for (const unit of game.statics.units) {
      // freeRespec is a hidden counter, never shown
      if (!templated(unit.description) || unit.tab === undefined || unit.name === "freeRespec") continue;
      expect(unitText(game, unit.name), unit.name).not.toBe("");
    }
  });

  it("gives every templated upgrade and ability a description", () => {
    for (const up of game.statics.upgrades) {
      if (!templated(up.description) || up.name === "mutatehidden") continue;
      expect(upgradeText(game, up.name), up.name).not.toBe("");
    }
  });

  it("keeps spreadsheet descriptions as they are", () => {
    expect(unitText(game, "drone")).toBe(String(game.g.unit("drone").st.description));
  });

  it("fills in live numbers", () => {
    expect(unitText(game, "bat")).toMatch(/Your bats make your abilities \d+\.\d\d% more powerful\. .* maximum of \d+%\./);
    expect(unitText(game, "nightbug")).toMatch(/store up to \d[\d,.]*% more maximum energy/);
    expect(unitText(game, "mutantfreq")).toMatch(/You currently have a \d+\.\d\d% chance to spawn mutagen\. More mutation frequency have/);
    expect(unitText(game, "mutanthatchery")).toMatch(/Raw mutagen produces larvae/);
    expect(unitText(game, "cocoon")).toMatch(/allowing you to clone up to [\d.]+ \w+ larvae\./);
    expect(unitText(game, "energy")).toContain("Need more energy?");
    expect(unitText(game, "crystal")).toMatch(/Converting crystals has permanently increased your maximum energy by 0\./);
    expect(upgradeText(game, "centipedeempower")).toBe(
      "Dramatically increase both your chilopodomorphs' meat cost and territory captured. This will destroy all 12,345 of your chilopodomorphs."
    );
    expect(upgradeText(game, "achievementbonus")).toMatch(/^Larva production increased by \d+% per 10 achievement points\.$/);
    const hatchery = upgradeText(game, "hatchery");
    expect(hatchery).toMatch(/^Each hatchery produces [\d.]+ more larvae per second\. Currently, your hatcheries produce a total of .+ larvae per second\. With no multipliers/);
    expect(hatchery).toMatch(/Your next hatchery has a \d+% chance to award .+ mutagen\./);
    expect(hatchery).toMatch(/your next hatchery will award \d+ crystals\./i);
    expect(upgradeText(game, "expansion")).toMatch(/Each expansion increases your hatcheries' larvae production by \d+%\. Currently, .* by [\d.,]+.*%\./);
    expect(upgradeText(game, "swarmwarp")).toMatch(/gaining [\d:]+ of production/);
    expect(upgradeText(game, "clonearmy")).toMatch(/Create .+ swarmlings\./);
  });

  it("updates with the game", () => {
    const before = upgradeText(game, "centipedeempower");
    expect(upgradeText(lateGame({ centipede: 1 }), "centipedeempower")).not.toBe(before);
  });

  it("falls back to the static text when the view lacks what a template reads", () => {
    const store = lateGame();
    // not focused: no effect outputs in the view
    store.refresh();
    expect(text(upgradeDescriptionParas(store.g.upgrade("larvarush"), fmt))).toBe("Instantly give birth to new larvae.");
  });
});
