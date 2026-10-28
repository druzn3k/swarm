import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Console errors fail the test, except fonts that can't load offline.
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  const ignored = (text: string) => /fonts\.(googleapis|gstatic)\.com/.test(text) || /net::ERR_/.test(text);
  page.on("console", (msg) => {
    if (msg.type() === "error" && !ignored(msg.text() + " " + (msg.location().url ?? ""))) errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("requestfailed", (req) => {
    if (!/fonts\.(googleapis|gstatic)\.com/.test(req.url())) errors.push(`request failed: ${req.url()}`);
  });
  return errors;
}

test("plays: buy a drone, visit larva tab and a unit screen", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("./");
  await expect(page.locator(".app-header")).toBeVisible();
  await expect(page.locator("h1.tab-title")).toHaveText(/meat/i);
  await expect(page.locator("canvas")).toBeVisible();

  // open the drone screen from its card
  await page.locator('a.unit-card[data-unit="drone"]').click();
  await expect(page).toHaveURL(/#\/unit\/drone$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/drone/i);
  const owned = page.locator(".unit-hero .owned");
  await expect(owned).toHaveText("0");

  // buy one
  await page.getByRole("button", { name: /^hatch 1$/i }).click();
  await expect(owned).toHaveText("1");
  await expect(page.getByText(/You own 1 drone\./)).toBeVisible();

  // typed amounts: a live cost preview
  const input = page.getByLabel(/hatching/i);
  await input.fill("2");
  await expect(page.locator(".buy-form")).toContainText(/2 drones will cost 20 meat and 2 larvae/);

  // larva tab via the bottom bar
  await page.locator('.tabbar a[data-tab="larva"]').click();
  await expect(page).toHaveURL(/#\/tab\/larva$/);
  await expect(page.locator("h1.tab-title")).toHaveText(/larva/i);
  await expect(page.locator('.tabbar a[data-tab="larva"]')).toHaveAttribute("aria-current", "page");

  // the More sheet
  await page.getByRole("button", { name: "More" }).click();
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("link", { name: "About" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Unofficial fork of Swarm Simulator by Evan Rosson");

  // no horizontal scroll at phone width
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // the purchase survives a reload
  await page.goto("./#/unit/drone");
  await expect(page.locator(".unit-hero .owned")).toHaveText(/^[1-9]/);

  expect(errors).toEqual([]);
});
