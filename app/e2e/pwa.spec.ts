import { expect, test } from "@playwright/test";

// The installable web app: manifest and icons, the service worker, and
// playing offline once the app has loaded.

test("has a valid manifest with installable icons", async ({ page, request }) => {
  await page.goto("./");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.name).toBe("Swarm Hive");
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("./");
  const sizes = manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(["192x192 any", "512x512 any", "512x512 maskable"]));
  for (const icon of manifest.icons) {
    const img = await request.get(icon.src);
    expect(img.ok(), icon.src).toBe(true);
    expect(img.headers()["content-type"]).toContain("image/png");
  }
});

test("works offline after the first visit", async ({ page, context }) => {
  await page.goto("./");
  await expect(page.locator(".app-header")).toBeVisible();
  // wait until the service worker controls the page (it precaches the whole build on install)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve()));
    }
  });
  await page.locator('a.unit-card[data-unit="drone"]').click();
  await page.getByRole("button", { name: /hatch 1/i }).first().click();
  await expect(page.locator(".unit-hero .owned")).toHaveText("1");

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".app-header")).toBeVisible();
  // the save survives and the game keeps running offline
  await expect(page.locator(".unit-hero .owned")).toHaveText("1");
  await page.goto("./#/tab/larva");
  await expect(page.locator("h1.tab-title")).toHaveText(/larva/i);
  await context.setOffline(false);
});

test("Chrome finds nothing blocking installation", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const cdp = await page.context().newCDPSession(page);
  const { errors } = await cdp.send("Page.getAppManifest");
  expect(errors).toEqual([]);
  await expect
    .poll(async () => (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors)
    .toEqual([]);
});
