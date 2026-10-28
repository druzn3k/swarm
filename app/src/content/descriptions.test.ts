import { describe, expect, it } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame } from "@swarmsim/engine";
import type { Game } from "@swarmsim/engine";
import { createFormatter } from "../format";
import { unitDescriptionParas, upgradeDescriptionParas } from "./LiveDescription";

const fmt = createFormatter();
const text = (paras: unknown[]) =>
  renderToStaticMarkup(createElement(Fragment, null, ...paras.map((p, i) => createElement("p", { key: i }, p as never, " "))))
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

function lateGame(): Game {
  const now = new Date("2026-01-01T00:00:00Z");
  const { game } = createGame({ now: () => now });
  const units: Record<string, string | number> = {
    meat: "1e40", larva: "1e30", territory: "1e30", drone: "1e30", queen: "1e20", nexus: 5, energy: 10000, nightbug: 1e6, moth: 1e5, bat: 1000,
    crystal: 50, mutagen: 1e9, premutagen: 1e6, ascension: 2, swarmling: 1e20, stinger: 1e18, centipede: 12345,
    mutanthatchery: 5, mutantbat: 100, mutantclone: 100, mutantswarmwarp: 100, mutantrush: 100, mutanteach: 100, mutantfreq: 100, mutantnexus: 100, mutantarmy: 100, mutantmeat: 100,
  };
  for (const [n, v] of Object.entries(units)) game.unit(n)._setCount(v);
  const upgrades: Record<string, number> = { hatchery: 100, expansion: 80, achievementbonus: 1, nexus1: 1, nexus2: 1, nexus3: 1, nexus4: 1, nexus5: 1 };
  for (const [n, v] of Object.entries(upgrades)) game.upgrade(n)._setCount(v);
  for (const u of ["mutatehatchery", "mutatebat", "mutateclone", "mutateswarmwarp", "mutaterush", "mutateeach", "mutatefreq", "mutatenexus", "mutatearmy", "mutatemeat"]) game.upgrade(u)._setCount(1);
  return game;
}

describe("live descriptions", () => {
  const game = lateGame();
  const templated = (d: unknown) => d == null || d === "" || d === "-";

  it("gives every templated unit a description", () => {
    for (const unit of game.unitlist()) {
      // freeRespec is a hidden counter, never shown
      if (!templated(unit.unittype.description) || !unit.unittype.tab || unit.name === "freeRespec") continue;
      expect(text(unitDescriptionParas(unit, fmt)), unit.name).not.toBe("");
    }
  });

  it("gives every templated upgrade and ability a description", () => {
    for (const up of game.upgradelist()) {
      if (!templated(up.type.description) || up.name === "mutatehidden") continue;
      expect(text(upgradeDescriptionParas(up, fmt)), up.name).not.toBe("");
    }
  });

  it("keeps spreadsheet descriptions as they are", () => {
    expect(text(unitDescriptionParas(game.unit("drone"), fmt))).toBe(String(game.unit("drone").unittype.description));
  });

  it("fills in live numbers", () => {
    expect(text(unitDescriptionParas(game.unit("bat"), fmt))).toMatch(/Your bats make your abilities \d+\.\d\d% more powerful\. .* maximum of \d+%\./);
    expect(text(unitDescriptionParas(game.unit("nightbug"), fmt))).toMatch(/store up to \d[\d,.]*% more maximum energy/);
    expect(text(unitDescriptionParas(game.unit("mutantfreq"), fmt))).toMatch(/You currently have a \d+\.\d\d% chance to spawn mutagen\. More mutation frequency have/);
    expect(text(unitDescriptionParas(game.unit("mutanthatchery"), fmt))).toMatch(/Raw mutagen produces larvae/);
    expect(text(unitDescriptionParas(game.unit("cocoon"), fmt))).toMatch(/allowing you to clone up to [\d.]+ \w+ larvae\./);
    expect(text(unitDescriptionParas(game.unit("energy"), fmt))).toContain("Need more energy?");
    expect(text(unitDescriptionParas(game.unit("crystal"), fmt))).toMatch(/Converting crystals has permanently increased your maximum energy by 0\./);
    expect(text(upgradeDescriptionParas(game.upgrade("centipedeempower"), fmt))).toBe(
      "Dramatically increase both your chilopodomorphs' meat cost and territory captured. This will destroy all 12,345 of your chilopodomorphs."
    );
    expect(text(upgradeDescriptionParas(game.upgrade("achievementbonus"), fmt))).toMatch(/^Larva production increased by \d+% per 10 achievement points\.$/);
    const hatchery = text(upgradeDescriptionParas(game.upgrade("hatchery"), fmt));
    expect(hatchery).toMatch(/^Each hatchery produces [\d.]+ more larvae per second\. Currently, your hatcheries produce a total of .+ larvae per second\. With no multipliers/);
    expect(hatchery).toMatch(/Your next hatchery has a \d+% chance to award .+ mutagen\./);
    expect(hatchery).toMatch(/your next hatchery will award \d+ crystals\./i);
    expect(text(upgradeDescriptionParas(game.upgrade("expansion"), fmt))).toMatch(/Each expansion increases your hatcheries' larvae production by \d+%\. Currently, .* by [\d.,]+.*%\./);
    expect(text(upgradeDescriptionParas(game.upgrade("swarmwarp"), fmt))).toMatch(/gaining [\d:]+ of production/);
    expect(text(upgradeDescriptionParas(game.upgrade("clonearmy"), fmt))).toMatch(/Create .+ swarmlings\./);
  });

  it("updates with the game", () => {
    const before = text(upgradeDescriptionParas(game.upgrade("centipedeempower"), fmt));
    game.unit("centipede")._setCount(1);
    expect(text(upgradeDescriptionParas(game.upgrade("centipedeempower"), fmt))).not.toBe(before);
  });
});
