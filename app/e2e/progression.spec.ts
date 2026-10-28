import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { craftSave, SAVE_KEY } from "./saves";
import type { CraftOptions } from "./saves";

// Set SCREENSHOT_DIR to also save phone screenshots of each feature.
const SHOTS = process.env.SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(700); // let animations finish
  await page.screenshot({ path: `${SHOTS}/b1-${name}.png` });
}

/** Start the app on a crafted save (once: later reloads keep the app's own saves). */
async function loadWith(page: Page, opts: CraftOptions, path = "./", extra: Record<string, string> = {}) {
  const save = craftSave(opts);
  await page.addInitScript(
    ([key, value, more]) => {
      if (sessionStorage.getItem("e2e-seeded")) return;
      sessionStorage.setItem("e2e-seeded", "1");
      localStorage.setItem(key, value);
      for (const [k, v] of Object.entries(more)) localStorage.setItem(k, v);
    },
    [SAVE_KEY, save, extra] as const
  );
  await page.goto(path);
}

// tutorial hints off, unless a test is about them
const NO_TUTORIAL = { "swarmhive-tutorial-dismissed": JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 100]) };

test("More sheet: buy all upgrades, then undo", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWith(page, { units: { meat: 1e9, drone: 100, queen: 10, territory: 1e6 } }, "./", NO_TUTORIAL);
  await page.getByRole("button", { name: "More" }).click();
  const sheet = page.getByRole("dialog", { name: "More" });
  const buyAll = sheet.locator('[data-action="buy-all"]');
  const cheapest = sheet.locator('[data-action="buy-cheapest"]');
  const undo = sheet.locator('[data-action="undo"]');
  await expect(buyAll).toBeEnabled();
  await expect(buyAll).toHaveText(/Buy all \d+ upgrades?/);
  await expect(cheapest).toHaveText(/Buy cheapest \d+ upgrades?/);
  await expect(undo).toBeDisabled();
  await shot(page, "more-sheet");

  const before = Number((await buyAll.textContent())!.match(/\d+/)![0]);
  await buyAll.click();
  await expect(sheet.getByRole("status")).toHaveText(`Bought ${before} upgrade${before === 1 ? "" : "s"}.`);
  await expect(undo).toBeEnabled();
  await expect(undo).toContainText(/\((30|29|28) sec\)/);
  await shot(page, "more-sheet-undo");

  await undo.click();
  await expect(sheet.getByRole("status")).toHaveText("Undone.");
  await expect(buyAll).toHaveText(new RegExp(`Buy all ${before} upgrade`));
  // no redo
  await expect(undo).toBeDisabled();
});

test("upgrade notify setting hides an upgrade and its marker, and survives a reload", async ({ page }) => {
  // the notify setting shows with "advanced unit data" on, as in the old game
  await loadWith(page, { units: { meat: 1e6, drone: 20 }, options: { showAdvancedUnitData: true } }, "./#/unit/larva", NO_TUTORIAL);
  const hatchery = page.locator('[data-upgrade="hatchery"]');
  await expect(hatchery).toBeVisible();
  await expect(page.locator('.tabbar a[data-tab="larva"] .upgrade-dot')).toBeVisible();
  await hatchery.getByLabel("Notify").selectOption("-1");
  await expect(hatchery).toHaveAttribute("data-hidden", "true");
  await expect(hatchery.getByText("Hidden")).toBeVisible();
  await expect(hatchery.getByRole("button", { name: /buy/i })).toHaveCount(0);
  await expect(page.locator('.tabbar a[data-tab="larva"] .upgrade-dot')).toHaveCount(0);

  await page.reload();
  const again = page.locator('[data-upgrade="hatchery"]');
  await expect(again).toHaveAttribute("data-hidden", "true");
  await again.getByLabel("Notify").selectOption("1");
  await expect(again).not.toHaveAttribute("data-hidden", "true");
  await expect(again.getByRole("button", { name: /buy 1/i })).toBeVisible();
});

test("abilities: cast with feedback, hide and show", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWith(page, { units: { meat: 1e6, drone: 1e4, queen: 100, nexus: 5, energy: 9000, nightbug: 1000 } }, "./#/unit/energy", NO_TUTORIAL);
  const rush = page.locator('[data-upgrade="meatrush"]');
  await expect(rush).toContainText(/costs 1,600 energy per use/);
  await rush.getByRole("button", { name: /cast 1/i }).click();
  await expect(rush.getByRole("status")).toContainText(/Meat Rush cast: \+[\d.,KMB]+ meat/i);

  const warp = page.locator('[data-upgrade="swarmwarp"]');
  await warp.getByRole("button", { name: /cast 1/i }).click();
  await expect(warp.getByRole("status")).toContainText(/skipped .* ahead/);
  await warp.scrollIntoViewIfNeeded();
  await shot(page, "ability");

  const toggle = rush.getByRole("button", { name: "Show Meat Rush" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(rush.getByText(/per use/)).toHaveCount(0);
  await toggle.click();
  await expect(rush.getByText(/per use/)).toBeVisible();
});

test("mutagen: ascension panel with an in-page confirm, then ascend", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWith(page, { units: { premutagen: 5000, nexus: 5, nightbug: 25000, energy: 1e6, drone: 1e6, queen: 1e4 }, upgrades: { hatchery: 20, expansion: 20 } }, "./#/tab/mutagen", NO_TUTORIAL);
  await expect(page.locator('[data-slot="ascend-summary"]')).toContainText(/\+5,000 mutagen/);
  await page.locator('[data-slot="ascend-summary"]').click();
  const panel = page.locator('[data-slot="ascension"]');
  await expect(panel).toContainText("Ascending will activate 5,000 new mutagen");
  await expect(panel.getByRole("button", { name: /Respec - refund/ })).toBeDisabled();

  await panel.getByRole("button", { name: /Ascend - activate mutagen/ }).click();
  await expect(panel.getByText(/Ascend now\?/)).toBeVisible();
  await panel.getByText(/Ascend now\?/).scrollIntoViewIfNeeded();
  await shot(page, "ascend-confirm");
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel.getByText(/Ascend now\?/)).toHaveCount(0);

  await panel.getByRole("button", { name: /Ascend - activate mutagen/ }).click();
  await panel.getByRole("button", { name: "Ascend", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Your swarm has ascended to a new world.");
  await expect(panel).toContainText("infested 1 new worlds");
  await expect(page.locator(".unit-hero .owned")).toHaveText("5,000");
});

test("mutagen panel shows the energy cap note", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWith(page, { units: { premutagen: 5000, nexus: 5, nightbug: 2000, energy: 30000, drone: 1e6, queen: 1e4 }, upgrades: { hatchery: 20, expansion: 20 } }, "./#/unit/mutagen", NO_TUTORIAL);
  const panel = page.locator('[data-slot="ascension"]');
  await expect(panel).toContainText(/more than your max energy!/);
  await expect(panel.getByRole("button", { name: /Ascend - activate mutagen/ })).toBeDisabled();
  await panel.getByText(/more than your max energy/).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(page, "mutagen");
});

test("welcome back after an hour away", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWith(page, { units: { drone: 10 }, awaySecs: 3600 }, "./", NO_TUTORIAL);
  const card = page.locator('[data-slot="welcome-back"]');
  await expect(card).toContainText("Welcome back!");
  await expect(card).toContainText(/While you were away for an hour, your swarm produced:/);
  await expect(card.getByRole("link", { name: /meat/i })).toBeVisible();
  await shot(page, "welcome-back");
  await card.getByRole("button", { name: "Dismiss welcome back" }).click();
  await expect(card).toHaveCount(0);
  // a refresh is not "coming back"
  await page.reload();
  await expect(page.locator(".app-header")).toBeVisible();
  await expect(page.locator('[data-slot="welcome-back"]')).toHaveCount(0);
});

test("tutorial: first hint, next step, dismissal remembered", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  const hint = page.getByRole("complementary", { name: "Tutorial" });
  await expect(hint).toContainText("Welcome to Swarm Simulator.");
  await shot(page, "tutorial");
  await hint.getByRole("link", { name: "drones" }).click();
  await page.getByRole("button", { name: /^hatch 1$/i }).click();
  await expect(hint).toContainText("Drones gather meat.");
  await hint.getByRole("button", { name: "Dismiss tip" }).click();
  await expect(hint).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".unit-hero")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Tutorial" })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
