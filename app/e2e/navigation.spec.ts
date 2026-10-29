// Navigation: the old game's list order, buying from the list, keeping the
// list's place and swiping between units (phone layout).
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { craftSave, SAVE_KEY } from "./saves";
import type { CraftOptions } from "./saves";

const NO_TUTORIAL = { "swarmhive-tutorial-dismissed": JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 100]) };

const MID: CraftOptions = {
  units: {
    meat: 1e25, larva: 1e9, drone: 1e9, queen: 1e6, nest: 5e4, greaterqueen: 900, hive: 40, hivequeen: 3,
    territory: 1e9, swarmling: 1e6, stinger: 3e4, centipede: 1234, nexus: 5, energy: 5000, nightbug: 1e5, bat: 100,
  },
  upgrades: { hatchery: 10, expansion: 5, nexus1: 1, nexus2: 1, nexus3: 1, nexus4: 1, nexus5: 1 },
};

async function loadWith(page: Page, opts: CraftOptions, path = "./") {
  const save = craftSave(opts);
  await page.addInitScript(
    ([key, value, more]) => {
      if (sessionStorage.getItem("e2e-seeded")) return;
      sessionStorage.setItem("e2e-seeded", "1");
      localStorage.setItem(key, value);
      for (const [k, v] of Object.entries(more)) localStorage.setItem(k, v);
    },
    [SAVE_KEY, save, NO_TUTORIAL] as const
  );
  await page.goto(path);
}

const cards = (page: Page) => page.locator("a.unit-card[data-unit]");
const card = (page: Page, unit: string) => page.locator(`a.unit-card[data-unit="${unit}"]`);
const row = (page: Page, unit: string) => page.locator(`[data-actions="${unit}"]`);
const heading = (page: Page) => page.locator("main").getByRole("heading", { level: 1 });
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

test("list order: the most advanced unit first, meat last", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWith(page, MID, "./#/tab/meat");
  await expect(card(page, "meat")).toBeVisible();
  const order = await cards(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-unit")));
  expect(order[order.length - 1]).toBe("meat");
  expect(order[0]).not.toBe("meat");
  const at = (u: string) => order.indexOf(u);
  for (const [higher, lower] of [
    ["hivequeen", "hive"],
    ["hive", "greaterqueen"],
    ["greaterqueen", "nest"],
    ["nest", "queen"],
    ["queen", "drone"],
    ["drone", "meat"],
  ]) {
    expect(at(higher), `${higher} above ${lower}`).toBeGreaterThanOrEqual(0);
    expect(at(higher)).toBeLessThan(at(lower));
  }
  // prev/next follow the list: previous is the card above, next the card below
  await card(page, "queen").click();
  await expect(page.getByRole("link", { name: /^previous: nests/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /^next: drones/i })).toBeVisible();
});

test("quick buy: +1 and max from the list, nothing on units that can't be bought", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // no drones: meat doesn't grow, so the max stays put (10 drones' worth)
  await loadWith(page, { units: { meat: 100, larva: 1000 } }, "./#/tab/meat");
  const drones = card(page, "drone").locator(".unit-count");
  await expect(drones).toHaveText("0");
  await expect(row(page, "meat")).toHaveCount(0);
  await expect(page.locator("[data-actions]").getByRole("button")).not.toHaveCount(0);

  const plus = row(page, "drone").getByRole("button", { name: /^hatch \+1 drone$/i });
  await plus.click();
  await expect(drones).toHaveText("1");
  // what was bought is said (and floats up from the button)
  await expect(page.locator('[data-slot="buy-status"]')).toHaveText("+1 drone");

  const max = row(page, "drone").getByRole("button", { name: /^max/i });
  await expect(max).toHaveText(/^max 9 drones$/i);
  await max.click();
  await expect(drones).toHaveText("10");
  await expect(max).toBeDisabled();

  // the card's head still opens the unit
  await card(page, "drone").click();
  await expect(page).toHaveURL(/#\/unit\/drone$/);

  // no row on the larva tab's units
  await page.goto("./#/tab/larva");
  await expect(card(page, "larva")).toBeVisible();
  await expect(page.locator("[data-actions]")).toHaveCount(0);
});

test("quick buy: upgrade buys the named upgrade and is disabled when none is affordable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWith(page, { units: { meat: 1e6, larva: 1e4, drone: 100 } }, "./#/tab/meat");
  const up = row(page, "drone").getByRole("button", { name: /^upgrade:/i });
  await expect(up).toHaveAccessibleName(/^Upgrade: buy faster drones$/i);
  await expect(up).toBeEnabled();
  // buy levels until the meat runs out
  let bought = 0;
  while (bought < 20 && (await up.isEnabled())) {
    await up.click();
    bought++;
    await expect(page.locator('[data-slot="buy-status"]')).toHaveText(/bought faster drones/i);
  }
  expect(bought).toBeGreaterThan(0);
  await expect(up).toBeDisabled();
  await expect(up).toHaveAccessibleName("Upgrade: none affordable");
  await page.goto("./#/unit/drone");
  await expect(page.locator('[data-upgrade="droneprod"] .upgrade-level')).toHaveText(`Lv ${bought}`);
});

test("scroll memory: back to the list where you left it (in-app arrow and browser back)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWith(page, MID, "./#/tab/meat");
  await expect(card(page, "meat")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 500));
  const before = await scrollY(page);
  expect(before).toBeGreaterThan(300);
  // a card that is on screen there
  const unit = await cards(page).evaluateAll((els) => {
    const el = els.find((e) => {
      const r = e.getBoundingClientRect();
      return r.top > 120 && r.bottom < window.innerHeight - 120;
    });
    return el?.getAttribute("data-unit") ?? "";
  });
  expect(unit).not.toBe("");

  await card(page, unit).click();
  await expect(page).toHaveURL(new RegExp(`#/unit/${unit}$`));
  // a unit opens at its top
  expect(await scrollY(page)).toBe(0);
  await page.getByRole("link", { name: /^back to meat/i }).click();
  await expect(page).toHaveURL(/#\/tab\/meat$/);
  await expect.poll(() => scrollY(page)).toBe(before);

  // browser back, after stepping to the next unit with the arrow
  await card(page, unit).click();
  await expect(heading(page)).toBeVisible();
  await page.getByRole("link", { name: /^next:/i }).click();
  await expect(page).not.toHaveURL(new RegExp(`#/unit/${unit}$`));
  await page.goBack();
  await expect(page).toHaveURL(/#\/tab\/meat$/);
  await expect.poll(() => scrollY(page)).toBe(before);

  // the tab bar's own tab does it too; another tab starts at the top
  await card(page, unit).click();
  await page.locator('.tabbar a[data-tab="meat"]').click();
  await expect.poll(() => scrollY(page)).toBe(before);
  await page.locator('.tabbar a[data-tab="larva"]').click();
  await expect(page).toHaveURL(/#\/tab\/larva$/);
  expect(await scrollY(page)).toBe(0);
});

test("swipe: sideways moves to the neighbouring unit, vertical scrolling doesn't", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWith(page, MID, "./#/tab/meat");
  await card(page, "queen").click();
  await expect(heading(page)).toHaveText(/^queen$/i);

  // mouse drag to the left: next (the card below)
  const hero = (await page.locator(".unit-hero").boundingBox())!;
  const y = hero.y + hero.height / 2;
  await page.mouse.move(hero.x + hero.width - 10, y);
  await page.mouse.down();
  await page.mouse.move(hero.x + 40, y + 6, { steps: 8 });
  await page.mouse.up();
  await expect(page).toHaveURL(/#\/unit\/drone$/);
  await expect(heading(page)).toHaveText(/^drone$/i);
  await page.waitForTimeout(250); // the slide

  // a touch swipe to the right: previous (the card above)
  const cdp = await page.context().newCDPSession(page);
  const touch = async (from: [number, number], to: [number, number]) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from[0], y: from[1] }] });
    for (let i = 1; i <= 10; i++) {
      const x = from[0] + ((to[0] - from[0]) * i) / 10;
      const yy = from[1] + ((to[1] - from[1]) * i) / 10;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: yy }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const box = (await page.locator(".unit-hero").boundingBox())!;
  await touch([box.x + 20, box.y + box.height / 2], [box.x + box.width - 20, box.y + box.height / 2 + 10]);
  await expect(page).toHaveURL(/#\/unit\/queen$/);
  await expect(heading(page)).toHaveText(/^queen$/i);
  await page.waitForTimeout(250); // the slide

  // scrolling up and down with a finger (a little sideways too) stays on the unit
  const section = (await page.locator("section.section").first().boundingBox())!;
  const sx = section.x + section.width / 2;
  await touch([sx, 700], [sx + 30, 300]);
  await touch([sx + 30, 300], [sx, 650]);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/#\/unit\/queen$/);

  // short drags and drags on controls don't count
  await page.mouse.move(box.x + 100, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 20, { steps: 4 });
  await page.mouse.up();
  // a mouse drag that starts on text selects it instead
  const title = (await heading(page).boundingBox())!;
  await page.mouse.move(title.x + 4, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(title.x + 200, title.y + title.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => String(window.getSelection()).trim().toLowerCase())).toContain("queen");
  const input = (await page.getByLabel(/hatching/i).boundingBox())!;
  await page.mouse.move(input.x + input.width - 5, input.y + input.height / 2);
  await page.mouse.down();
  await page.mouse.move(input.x - 120, input.y + input.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await expect(page).toHaveURL(/#\/unit\/queen$/);

  // swiping replaces the history entry: Back goes to the list
  await page.goBack();
  await expect(page).toHaveURL(/#\/tab\/meat$/);
});

for (const width of [360, 390]) {
  test(`buy rows fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await loadWith(page, { ...MID, units: { ...MID.units, meat: "1.23e300", larva: "4.56e200", drone: "3.65e135" } }, "./#/tab/meat");
    const buttons = row(page, "drone").getByRole("button");
    await expect(buttons).toHaveCount(3);
    for (const b of await buttons.all()) {
      const r = (await b.boundingBox())!;
      expect(r.height).toBeGreaterThanOrEqual(48);
      expect(r.width).toBeGreaterThanOrEqual(48);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await card(page, "drone").click();
    await expect(heading(page)).toHaveText(/^drone$/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
}
