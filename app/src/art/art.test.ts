import { describe, expect, it } from "vitest";
import { spreadsheet } from "@swarmsim/engine";
import { PAL } from "./pixels";
import type { Sprite } from "./pixels";
import { FALLBACK, PROPS, allUnitSprites, framesFor, spriteFor } from "./units";
import { ICONS, UPGRADE_FALLBACK, iconForUpgrade } from "./icons";
import { SCENE_TABS, sceneFor } from "./scene";

type Row = { name: string; label?: string; disabled?: boolean; tab?: string; class?: string };
const data = spreadsheet() as unknown as { unittypes: { elements: Row[] }; upgrades: { elements: Row[] } };
// the sheets repeat a row per cost/effect; the first row of each name carries the label
const units = data.unittypes.elements.filter((u) => u.name && u.label && !u.disabled);
const upgrades = data.upgrades.elements.filter((u) => u.name && u.label && !u.disabled);

function checkGrid(label: string, s: Sprite) {
  expect(s.rows.length, label).toBe(s.h);
  expect(s.h, label).toBeGreaterThan(0);
  for (const [i, row] of s.rows.entries()) {
    expect(row.length, `${label} row ${i} width`).toBe(s.w);
    for (const ch of row) if (ch !== ".") expect(s.pal[ch] ?? PAL[ch], `${label} key '${ch}'`).toBeTruthy();
  }
  // fits a 24px icon box with a pixel of margin
  expect(Math.max(s.w, s.h), `${label} size`).toBeLessThanOrEqual(22);
}

describe("unit sprites", () => {
  it("every visible unit has its own drawing", () => {
    expect(units.length).toBe(53);
    for (const u of units) expect(spriteFor(u.name), u.name).not.toBe(FALLBACK);
  });
  it("named creatures don't share a drawing", () => {
    const seen = new Map<string, string>();
    for (const u of units) {
      // overmind ranks are deliberate recolors of one drawing
      if (/^overmind\d$/.test(u.name)) continue;
      const key = spriteFor(u.name).rows.join("\n");
      expect(seen.get(key), `${u.name} looks like ${seen.get(key)}`).toBeUndefined();
      seen.set(key, u.name);
    }
  });
  it("idle frames match in size", () => {
    for (const u of units) {
      const [a, b] = framesFor(u.name);
      if (b) expect([b.w, b.h], u.name).toEqual([a.w, a.h]);
    }
  });
  it("grids are rectangular and use known palette keys", () => {
    for (const [name, s] of allUnitSprites()) checkGrid(name, s);
    for (const [name, s] of Object.entries(PROPS)) checkGrid(name, s);
  });
});

describe("upgrade icons", () => {
  it("every upgrade and ability has an icon", () => {
    expect(upgrades.some((u) => u.class === "ability")).toBe(true);
    for (const u of upgrades) expect(iconForUpgrade(u.name), u.name).not.toBe(UPGRADE_FALLBACK);
  });
  it("unknown names fall back", () => {
    expect(iconForUpgrade("nope")).toBe(UPGRADE_FALLBACK);
  });
  it("grids are rectangular and use known palette keys", () => {
    for (const [name, s] of Object.entries(ICONS)) checkGrid(name, s);
  });
});

describe("scenes", () => {
  it("every tab has a scene", () => {
    for (const tab of ["meat", "larva", "territory", "energy", "mutagen"]) expect(SCENE_TABS).toContain(sceneFor(tab));
    expect(sceneFor("all")).toBe("meat");
  });
});
