// Phase C: parity fixes, live descriptions, accessibility and narrow screens.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { craftSave, SAVE_KEY } from "./saves";
import type { CraftOptions } from "./saves";

const NO_TUTORIAL = { "swarmhive-tutorial-dismissed": JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 100]) };

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

const LATE: CraftOptions = {
  units: { meat: 1e25, larva: 1e9, drone: 1e9, queen: 1e6, territory: 1e9, swarmling: 1e6, centipede: 1234, nexus: 5, energy: 5000, nightbug: 1e5, bat: 100 },
  upgrades: { hatchery: 10, expansion: 5, nexus1: 1, nexus2: 1, nexus3: 1, nexus4: 1, nexus5: 1 },
};

test("upgrades: icon, live description, buy 1 / 25% / max", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWith(page, LATE, "./#/unit/larva");
  const hatchery = page.locator('[data-upgrade="hatchery"]');
  await expect(hatchery.locator("img.px-icon")).toBeVisible();
  await expect(hatchery).toContainText(/Each hatchery produces [\d.,]+ more larvae per second\. Currently, your hatcheries produce a total of/);
  const level = hatchery.locator(".upgrade-level");
  await expect(level).toHaveText("Lv 10");
  const buttons = hatchery.locator(".btn-row button");
  await expect(buttons.nth(0)).toHaveText(/buy 1/i);
  const quarter = buttons.nth(1);
  const max = buttons.nth(2);
  await expect(quarter).toBeEnabled();
  await expect(quarter).toHaveText(/^buy \d+$/i);
  await expect(max).toBeEnabled();
  const n = Number((await max.textContent())!.replace(/\D/g, ""));
  await max.click();
  await expect(level).toHaveText(`Lv ${10 + n}`);
  await expect(max).toHaveText(/max/i);
  await expect(max).toBeDisabled();
});

test("templated descriptions show live numbers", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWith(page, LATE, "./#/unit/bat");
  await expect(page.locator("main")).toContainText(/Your bats make your abilities [\d.]+% more powerful/);
  await page.goto("./#/unit/energy");
  await page.getByRole("link", { name: "Need more energy?" }).click();
  await expect(page).toHaveURL(/#\/unit\/crystal$/);
  await expect(page.locator("main")).toContainText("Converting crystals has permanently increased your maximum energy by");
  await expect(page.getByLabel(/converting/i)).toBeVisible();
  await page.goto("./#/unit/territory");
  await expect(page.getByRole("heading", { name: "Production rates" })).toBeVisible();
  await expect(page.locator(".chart-rows")).toContainText(/chilopodomorphs/i);
  await page.getByRole("button", { name: "Hide chart" }).click();
  await expect(page.locator(".chart-rows")).toHaveCount(0);
});

test("tabs: locked ones are hidden, mutagen shows inactive mutagen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("./");
  await expect(page.locator('.tabbar a[data-tab="meat"]')).toBeVisible();
  await expect(page.locator('.tabbar a[data-tab="energy"]')).toHaveCount(0);
  await expect(page.locator('.tabbar a[data-tab="mutagen"]')).toHaveCount(0);
});

test("quick buy under unit cards with advanced unit data", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWith(page, { ...LATE, options: { showAdvancedUnitData: true } }, "./#/tab/meat");
  const quick = page.locator('[data-quickbuy="drone"]');
  await expect(quick.locator("summary")).toContainText(/Buy up to/);
  await quick.locator("summary").click();
  const drones = page.locator('a.unit-card[data-unit="drone"] .unit-count');
  const before = await drones.textContent();
  await quick.getByRole("button", { name: /^buy \d/i }).first().click();
  await expect(drones).not.toHaveText(before!);
  await expect(quick).toContainText(/faster drones/i);
});

test("More sheet traps focus, makes the page inert and returns focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWith(page, LATE, "./");
  const more = page.getByRole("button", { name: "More" });
  await more.click();
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(sheet).toBeVisible();
  const inert = () => page.locator("main").evaluate((el) => !!el.closest("[inert]"));
  expect(await inert()).toBe(true);
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(more).toBeFocused();
  expect(await inert()).toBe(false);
});

test("confirms: Escape cancels and focus returns", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWith(page, LATE, "./#/options");
  const wipe = page.getByRole("button", { name: /wipe all saved data/i });
  await wipe.click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(wipe).toBeFocused();
});

for (const width of [360, 390]) {
  test(`no horizontal scroll at ${width}px on any screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await loadWith(page, {
      ...LATE,
      units: { ...LATE.units, meat: "1.23e300", drone: "3.65e135", premutagen: 1e9, mutagen: 1e9 },
      options: { showAdvancedUnitData: true },
    });
    for (const route of ["#/tab/meat", "#/unit/drone", "#/unit/larva", "#/tab/energy", "#/unit/energy", "#/unit/mutagen", "#/tab/all", "#/options", "#/achievements", "#/statistics", "#/about"]) {
      await page.goto("./" + route);
      await expect(page.locator("main")).not.toBeEmpty();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, route).toBeLessThanOrEqual(0);
    }
  });
}
