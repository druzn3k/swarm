// Phase D: the laptop layout (from 1000px wide). Runs in the "desktop"
// project (1440x900); the phone specs run in the "phone" project.
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

const side = (page: Page) => page.locator(".split-side");
const unitHeading = (page: Page) => page.locator("main").getByRole("heading", { level: 1 });
const card = (page: Page, unit: string) => page.locator(`a.unit-card[data-unit="${unit}"]`);

test("two columns: the tab's list on the left, a unit with something to do on the right", async ({ page }) => {
  await loadWith(page, MID, "./#/tab/meat");
  await expect(side(page)).toBeVisible();
  await expect(side(page).getByRole("heading", { name: "meat" })).toBeVisible();
  await expect(side(page).locator("canvas")).toBeVisible();
  // meat has nothing to buy, so the first unit that does is shown
  await expect(unitHeading(page)).toHaveText(/^drone$/i);
  await expect(card(page, "drone")).toHaveAttribute("aria-current", "true");

  const left = (await side(page).boundingBox())!;
  const right = (await page.locator("main").boundingBox())!;
  expect(left.x + left.width).toBeLessThanOrEqual(right.x);
  expect(right.width).toBeGreaterThan(400);
  // the hive is drawn at a whole-number scale of its 160x84 art
  const canvas = (await side(page).locator("canvas").boundingBox())!;
  expect(canvas.width % 160).toBe(0);
  expect(canvas.width / 160).toBe(canvas.height / 84);
  // the region holding the list is labelled by the tab's title
  await expect(page.getByRole("region", { name: "meat" })).toBeVisible();
});

test("picking a unit shows it on the right and keeps the list where it was", async ({ page }) => {
  await loadWith(page, MID, "./#/tab/meat");
  await expect(card(page, "hivequeen")).toBeVisible();
  // scroll the list a bit, then pick a unit further down
  await side(page).evaluate((el) => (el.scrollTop = 200));
  await card(page, "hivequeen").scrollIntoViewIfNeeded();
  const before = await side(page).evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(0);
  await card(page, "hivequeen").click();
  await expect(page).toHaveURL(/#\/unit\/hivequeen$/);
  await expect(unitHeading(page)).toHaveText(/hive queen/i);
  await expect(card(page, "hivequeen")).toHaveAttribute("aria-current", "true");
  await expect(card(page, "meat")).not.toHaveAttribute("aria-current", /.*/);
  await expect(card(page, "drone")).toBeAttached();
  expect(await side(page).evaluate((el) => el.scrollTop)).toBe(before);
  // focus stays on the card; the change is announced
  await expect(card(page, "hivequeen")).toBeFocused();
  await expect(side(page).getByRole("status")).toHaveText(/showing hive queens/i);

  // next unit (the button goes away with the old unit): focus moves to the unit
  await page.locator("main").getByRole("link", { name: /^next/i }).click();
  await expect(page).toHaveURL(/#\/unit\/empress$|#\/unit\/[a-z]+$/);
  await expect(page.locator("main")).toBeFocused();
  // the list has no "back to the tab" button next to it
  await expect(page.locator("main").getByRole("link", { name: /back to/i })).toBeHidden();

  // buying works from the right-hand screen
  await card(page, "drone").click();
  const owned = page.locator(".unit-hero .owned");
  const was = await owned.textContent();
  await page.getByRole("button", { name: /^hatch 1$/i }).click();
  await expect(owned).not.toHaveText(was!);
});

test("top tab strip: navigation, remembered unit per tab, keyboard order and skip link", async ({ page }) => {
  await loadWith(page, MID, "./#/tab/meat");
  const strip = page.getByRole("navigation", { name: "Swarm tabs" });
  const stripBox = (await strip.boundingBox())!;
  const mainBox = (await page.locator("main").boundingBox())!;
  expect(stripBox.y).toBeLessThan(mainBox.y);
  expect(stripBox.y).toBeLessThan(200);

  await strip.locator('a[data-tab="larva"]').click();
  await expect(page).toHaveURL(/#\/tab\/larva$/);
  await expect(strip.locator('a[data-tab="larva"]')).toHaveAttribute("aria-current", "page");
  await expect(side(page).getByRole("heading", { name: "larvae" })).toBeVisible();
  await expect(unitHeading(page)).toHaveText(/^larva$/i);

  // a tab remembers the unit last opened on it (the old game's tab.lastselected)
  await strip.locator('a[data-tab="meat"]').click();
  await card(page, "queen").click();
  await expect(unitHeading(page)).toHaveText(/^queen$/i);
  await strip.locator('a[data-tab="territory"]').click();
  await expect(unitHeading(page)).toHaveText(/^territory$/i);
  await strip.locator('a[data-tab="meat"]').click();
  await expect(page).toHaveURL(/#\/tab\/meat$/);
  await expect(unitHeading(page)).toHaveText(/^queen$/i);
  await expect(card(page, "queen")).toHaveAttribute("aria-current", "true");

  // keyboard: skip link first, then the header, then the strip, then the list
  await page.reload();
  await page.locator("body").press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  const order: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    order.push(
      await page.evaluate(() => {
        const el = document.activeElement!;
        return el.closest(".app-header") ? "header" : el.closest(".strip") ? "strip" : el.closest(".split-side") ? "list" : el.closest("main") ? "main" : el.tagName;
      })
    );
  }
  const firstOf = (k: string) => order.indexOf(k);
  expect(firstOf("header")).toBeGreaterThanOrEqual(0);
  expect(firstOf("header")).toBeLessThan(firstOf("strip"));
  expect(firstOf("strip")).toBeLessThan(firstOf("list"));
  // the skip link goes to the unit
  await page.reload();
  await page.locator("body").press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await expect(page.locator("main")).toContainText(/meat/i);
});

test("More: a panel anchored under the strip's More button", async ({ page }) => {
  await loadWith(page, MID, "./#/tab/meat");
  const more = page.getByRole("navigation", { name: "Swarm tabs" }).getByRole("button", { name: "More" });
  await more.click();
  const panel = page.getByRole("dialog", { name: "More" });
  await expect(panel).toBeVisible();
  const b = (await more.boundingBox())!;
  const p = (await panel.boundingBox())!;
  expect(p.y).toBeGreaterThanOrEqual(b.y + b.height);
  expect(p.y).toBeLessThan(b.y + b.height + 40);
  expect(Math.abs(p.x + p.width - (b.x + b.width))).toBeLessThan(24);
  expect(p.width).toBeLessThan(500);
  await expect(more).toHaveAttribute("aria-expanded", "true");
  // focus is inside, Escape closes and gives focus back
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(more).toBeFocused();
  // a click outside closes it too
  await more.click();
  await expect(panel).toBeVisible();
  await page.mouse.click(40, 600);
  await expect(panel).toHaveCount(0);

  // its links open the other screens in a single wide column
  await more.click();
  await panel.getByRole("link", { name: "Achievements" }).click();
  await expect(page).toHaveURL(/#\/achievements$/);
  await expect(page.locator(".split")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Achievements" })).toBeVisible();
  const main = (await page.locator("main").boundingBox())!;
  expect(main.width).toBeLessThanOrEqual(960);
  expect(main.width).toBeGreaterThan(800);

  // "show all units": picking a unit keeps the all-units list
  await more.click();
  await panel.getByRole("link", { name: "Show all units" }).click();
  await expect(side(page).getByRole("heading", { name: "All units" })).toBeVisible();
  await card(page, "swarmling").click();
  await expect(unitHeading(page)).toHaveText(/swarmling/i);
  await expect(side(page).getByRole("heading", { name: "All units" })).toBeVisible();
});

test("a unit URL opens its tab on the left and the unit on the right", async ({ page }) => {
  await loadWith(page, MID, "./#/unit/swarmling");
  await expect(side(page).getByRole("heading", { name: "territory" })).toBeVisible();
  await expect(side(page).locator('[data-scene="territory"]')).toBeVisible();
  await expect(unitHeading(page)).toHaveText(/swarmling/i);
  await expect(card(page, "swarmling")).toHaveAttribute("aria-current", "true");
  await expect(page.locator('.strip a[data-tab="territory"]')).toHaveAttribute("aria-current", "page");
  // the old game's form and ?num= still work
  await page.goto("./#/tab/energy/unit/nightbug");
  await expect(unitHeading(page)).toHaveText(/nightbug/i);
  await page.goto("./#/unit/drone?num=@100");
  await expect(page.getByLabel(/hatching/i)).toHaveValue("@100");
  // a locked unit goes back to its tab
  await page.goto("./#/unit/pantheon");
  await expect(page).toHaveURL(/#\/tab\/meat$/);
  await expect(unitHeading(page)).toBeVisible();
});

for (const width of [1024, 1440, 1920]) {
  test(`no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await loadWith(page, { ...MID, options: { showAdvancedUnitData: true } }, "./#/tab/meat");
    for (const route of ["#/tab/meat", "#/unit/drone", "#/unit/energy", "#/unit/territory", "#/tab/larva", "#/achievements", "#/statistics", "#/options", "#/about"]) {
      await page.goto("./" + route);
      await expect(page.locator(".app-header")).toBeVisible();
      await expect(page.locator("main h1").first()).toBeVisible();
      const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(scroll, route).toBeLessThanOrEqual(client);
    }
  });
}

test("resizing from laptop to phone and back keeps the app usable", async ({ page }) => {
  await loadWith(page, MID, "./#/unit/drone");
  await expect(side(page)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  // phone: one column, the unit screen alone, the tab bar at the bottom
  await expect(page.locator(".split")).toHaveCount(0);
  await expect(unitHeading(page)).toHaveText(/^drone$/i);
  const bar = (await page.getByRole("navigation", { name: "Swarm tabs" }).boundingBox())!;
  expect(bar.y + bar.height).toBeGreaterThan(780);
  await page.getByRole("link", { name: /back to meat/i }).click();
  await expect(page).toHaveURL(/#\/tab\/meat$/);
  await expect(page.locator("h1.tab-title")).toHaveText(/meat/i);
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
  // back to the laptop: the sheet closes, two columns again
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
  await expect(side(page)).toBeVisible();
  await card(page, "queen").click();
  await expect(unitHeading(page)).toHaveText(/^queen$/i);
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
});
