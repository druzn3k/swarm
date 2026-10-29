import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { craftSave, SAVE_KEY } from "./saves";

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/fonts\.(googleapis|gstatic)\.com|net::ERR_/.test(msg.text() + " " + (msg.location().url ?? ""))) {
      errors.push(msg.text());
    }
  });
  return errors;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("options: notation changes numbers and survives export, reset and import", async ({ page, context }) => {
  const errors = watchErrors(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await page.goto("./#/options");
  await expect(page.getByRole("heading", { name: "Options", level: 1 })).toBeVisible();

  const example = page.locator(".option-example").first();
  await expect(example).toContainText("123.456 million");
  await page.getByRole("radio", { name: /scientific-e/i }).check();
  await expect(example).toContainText("1.23456e8");
  await page.getByRole("radio", { name: /engineering/i }).check();
  await expect(example).toContainText("123.456E6");

  // rates follow the velocity unit, in the header too
  await page.getByRole("radio", { name: /^minutes/i }).check();
  await expect(page.locator(".app-header .res").first()).toContainText("/min");
  await noHorizontalScroll(page);

  // the option is kept in the save across a reload
  await page.reload();
  await expect(page.getByRole("radio", { name: /engineering/i })).toBeChecked();

  // export
  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.locator(".save-status").first()).toHaveText(/copied|selected/i);
  const saved = await page.getByLabel("Your saved game").inputValue();
  expect(saved).toMatch(/\|/);

  // a bad import is refused with a clear message
  const importBox = page.getByLabel("Import a saved game");
  await importBox.fill("not a save");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("isn't a Swarm Simulator save");

  // reset, with an in-page confirm
  await page.getByRole("button", { name: /wipe all saved data/i }).click();
  await page.getByRole("button", { name: /yes, wipe everything/i }).click();
  await expect(page).toHaveURL(/#\/tab\/meat$/);
  await page.goto("./#/options");
  await expect(page.getByRole("radio", { name: /standard decimal/i })).toBeChecked();

  // import the exported save, confirming the overwrite
  await page.getByLabel("Import a saved game").fill(saved);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: /replace my game/i }).click();
  await expect(page.getByText("Imported. Welcome back to your swarm.")).toBeVisible();
  await expect(page.getByRole("radio", { name: /engineering/i })).toBeChecked();
  await expect(page.getByRole("radio", { name: /^minutes/i })).toBeChecked();
  // importing earns "portable swarm"
  await expect(page.locator(".toast")).toContainText(/portable swarm/i);

  expect(errors).toEqual([]);
});

test("achievements: buying a drone earns one, with a toast and a listing", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("./#/unit/drone");
  await page.getByRole("button", { name: /^hatch 1$/i }).click();

  const toast = page.locator(".toast");
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Achievement");
  await expect(page.getByRole("status").filter({ has: toast })).toBeVisible();
  const label = (await toast.locator(".toast-title").innerText()).trim();
  expect(label.length).toBeGreaterThan(0);

  // close works
  await toast.getByRole("button", { name: /close/i }).click();
  await expect(toast).toBeHidden();

  await page.goto("./#/achievements");
  await expect(page.getByRole("heading", { name: "Achievements", level: 1 })).toBeVisible();
  const card = page.locator(".ach.earned", { hasText: new RegExp(label, "i") });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Earned");

  // filters: hide unearned and masked ones
  await page.getByRole("checkbox", { name: "Unearned" }).uncheck();
  await page.getByRole("checkbox", { name: "Masked" }).uncheck();
  await expect(page.locator(".ach.unearned")).toHaveCount(0);
  await expect(page.locator(".ach.masked")).toHaveCount(0);
  await expect(page.locator(".ach.earned")).not.toHaveCount(0);
  await noHorizontalScroll(page);

  // statistics list the drone
  await page.goto("./#/statistics");
  await expect(page.locator(".stat-row", { hasText: /^drone/i }).first()).toContainText("Clicks");

  expect(errors).toEqual([]);
});

test("achievements: cards follow the game while the screen is open", async ({ page }) => {
  const errors = watchErrors(page);
  const save = craftSave({ units: { meat: 1e9, larva: 1e6 } });
  await page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem("e2e-seeded")) return;
      sessionStorage.setItem("e2e-seeded", "1");
      localStorage.setItem(key, value);
      localStorage.setItem("swarmhive-tutorial-dismissed", JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 100]));
    },
    [SAVE_KEY, save] as const
  );
  await page.goto("./#/unit/drone");
  await page.getByRole("button", { name: /^hatch 1$/i }).click();
  await page.getByRole("button", { name: /^hatch 1$/i }).click();
  await page.locator(".toast").getByRole("button", { name: /close/i }).click();

  // in-page navigation: the cards mount once, then must update themselves
  await page.evaluate(() => (location.hash = "#/achievements"));
  const good = page.locator('[data-achievement="drone1"]');
  const supply = page.locator('[data-achievement="drone2"]');
  await expect(good).toHaveClass(/\bearned\b/);
  await expect(good).toContainText(/Earned .* ago/);
  await expect(supply).toHaveClass(/\bunearned\b/);
  await expect(supply.locator(".ach-progress .bar-label")).toContainText("2 of 201");
  await expect(page.locator(".ach-summary")).toContainText("10 achievement points");

  // undo (a player action from the More sheet) takes a drone back: progress goes down at once
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("dialog", { name: "More" }).locator('[data-action="undo"]').click();
  await page.keyboard.press("Escape");
  await expect(supply.locator(".ach-progress .bar-label")).toContainText("1 of 201");
  await expect(good).toHaveClass(/\bearned\b/);
  expect(errors).toEqual([]);
});
