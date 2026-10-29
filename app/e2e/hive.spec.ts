// The hive canvas: about 20 redraws a second, none while it is off screen,
// back when it scrolls in again; reduced motion redraws on game updates only.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { craftSave, SAVE_KEY } from "./saves";

const NO_TUTORIAL = JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 100]);

/** Start on the meat tab of a save with a long unit list, counting the hive's redraws. */
async function load(page: Page) {
  const save = craftSave({
    units: { meat: "1e30", larva: "1e20", drone: "1e15", queen: "1e13", nest: "1e11", greaterqueen: "1e9", hive: "1e7", hivequeen: 1e5, empress: 1000, territory: "1e20", energy: 1000, nexus: 5 },
  });
  await page.addInitScript(
    ([key, value, tutorial]) => {
      if (!sessionStorage.getItem("e2e-seeded")) {
        sessionStorage.setItem("e2e-seeded", "1");
        localStorage.setItem(key, value);
        localStorage.setItem("swarmhive-tutorial-dismissed", tutorial);
      }
      // each hive frame starts by drawing the cached background: drawImage(bg, 0, 0)
      const w = window as unknown as { hiveDraws: number };
      w.hiveDraws = 0;
      const orig = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
        if (a.length === 3 && this.canvas.isConnected) w.hiveDraws++;
        return (orig as (...args: unknown[]) => void).apply(this, a);
      } as typeof orig;
    },
    [SAVE_KEY, save, NO_TUTORIAL] as const
  );
  await page.goto("./#/tab/meat");
  await expect(page.locator(".scene canvas")).toBeVisible();
  await page.waitForTimeout(500);
}

/** hive redraws per second, over `ms` */
async function drawRate(page: Page, ms = 2000): Promise<number> {
  const before = await page.evaluate(() => (window as unknown as { hiveDraws: number }).hiveDraws);
  await page.waitForTimeout(ms);
  const after = await page.evaluate(() => (window as unknown as { hiveDraws: number }).hiveDraws);
  return (after - before) / (ms / 1000);
}

test("the hive redraws about 20 times a second, and not while off screen", async ({ page }) => {
  await load(page);
  const visible = await drawRate(page);
  expect(visible).toBeGreaterThan(10);
  expect(visible).toBeLessThanOrEqual(22);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const box = await page.locator(".scene canvas").boundingBox();
  expect(box!.y + box!.height).toBeLessThan(0);
  await page.waitForTimeout(300);
  expect(await drawRate(page)).toBe(0);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  expect(await drawRate(page)).toBeGreaterThan(10);
});

test("with reduced motion the hive only redraws on game updates", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await load(page);
  // the population is re-read twice a second; nothing animates in between
  expect(await drawRate(page)).toBeLessThanOrEqual(3);
});
