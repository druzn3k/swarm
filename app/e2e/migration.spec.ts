import { expect, test } from "@playwright/test";
import { craftSave, SAVE_KEY, V2_SAVE_KEY } from "./saves";

// The wasm engine's saves are format v2 under their own key. A v1 save (the
// TypeScript engine's) is converted on the first load and kept as it was.

const NO_TUTORIAL = JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 100]);

test("a v1 save migrates to v2, the v1 copy is kept, and export offers both formats", async ({ page }) => {
  const v1 = craftSave({ units: { meat: 1e6, drone: 4242, queen: 7 } });
  await page.addInitScript(
    ([key, value, tutorial]) => {
      if (sessionStorage.getItem("e2e-seeded")) return;
      sessionStorage.setItem("e2e-seeded", "1");
      localStorage.setItem(key, value);
      localStorage.setItem("swarmhive-tutorial-dismissed", tutorial);
    },
    [SAVE_KEY, v1, NO_TUTORIAL] as const
  );
  await page.goto("./#/unit/queen");
  await expect(page.locator(".unit-hero .owned")).toHaveText("7");

  const stored = await page.evaluate(([a, b]) => [localStorage.getItem(a), localStorage.getItem(b)], [SAVE_KEY, V2_SAVE_KEY]);
  expect(stored[0]).toBe(v1);
  expect(stored[1]).toMatch(/^SW2\|/);

  // a purchase saves v2 only
  await page.getByRole("button", { name: /hatch 1/i }).first().click();
  await expect(page.locator(".unit-hero .owned")).toHaveText("8");
  await page.reload();
  await expect(page.locator(".unit-hero .owned")).toHaveText("8");
  expect(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)).toBe(v1);

  // export: v2 by default, the old game's format on request; both import
  await page.goto("./#/options");
  const box = page.getByLabel("Your saved game");
  await expect(box).toHaveValue(/^SW2\|/);
  await page.getByLabel("Legacy format").check();
  const legacy = await box.inputValue();
  expect(legacy).not.toMatch(/^SW2\|/);
  expect(legacy).toMatch(/\|/);
  await page.getByLabel("Import a saved game").fill(legacy);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: /replace my game/i }).click();
  await expect(page.getByText("Imported. Welcome back to your swarm.")).toBeVisible();
  await page.goto("./#/unit/queen");
  await expect(page.locator(".unit-hero .owned")).toHaveText("8");
});
