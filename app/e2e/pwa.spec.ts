import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { NETWORK_TIMEOUT_MILLIS } from "../build/service-worker";

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

/** Wait until the service worker controls the page (it precaches the whole build on install). */
async function controlled(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve()));
    }
  });
}

/** The start of the app shell the service worker would show offline. */
const cachedShell = (page: Page) =>
  page.evaluate(async () => {
    const r = await caches.match("./", { ignoreVary: true });
    return r ? `${r.status} ${await r.text()}` : "none";
  });

test("works offline after the first visit", async ({ page, context }) => {
  await page.goto("./");
  await expect(page.locator(".app-header")).toBeVisible();
  await controlled(page);
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

// Routing a service worker's own fetches: context.route sees the requests the
// worker makes (Chromium); page.route doesn't see a navigation the worker
// answers. So these tests route on the context, after the worker is in control.

test("a 404 page under the app's path doesn't replace the cached app", async ({ page, context }) => {
  await page.goto("./");
  await expect(page.locator(".app-header")).toBeVisible();
  await controlled(page);
  expect(await cachedShell(page)).toMatch(/^200 <!doctype html>/i);

  await context.route("**/missing-page", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<h1>404 Not Found</h1>" }));
  await page.goto("./missing-page");
  await expect(page.locator("h1")).toHaveText("404 Not Found");
  // a server error for the app's own page isn't kept either
  await context.route((url) => url.pathname.endsWith("/index.html"), (route) => route.fulfill({ status: 503, contentType: "text/html", body: "<h1>503</h1>" }));
  await page.goto("./index.html?from=test");
  await expect(page.locator("h1")).toHaveText("503");
  await context.unrouteAll();

  // still the app in the cache: offline, it opens
  expect(await cachedShell(page)).toMatch(/^200 <!doctype html>/i);
  expect(await cachedShell(page)).not.toMatch(/Not Found|503/);
  await context.setOffline(true);
  await page.goto("./");
  await expect(page.locator(".app-header")).toBeVisible();
  await context.setOffline(false);
});

test("a stalled connection shows the cached app within a few seconds, and a late answer refreshes it", async ({ page, context, baseURL }) => {
  await page.goto("./");
  await expect(page.locator(".app-header")).toBeVisible();
  await controlled(page);

  // the page request hangs (only the page: assets come from the cache)
  const held: Route[] = [];
  const shellUrl = new URL("./", baseURL).href;
  await context.route((url) => url.href.split("#")[0] === shellUrl, (route) => {
    held.push(route);
  });
  const t0 = Date.now();
  await page.reload({ waitUntil: "commit" });
  await expect(page.locator(".app-header")).toBeVisible({ timeout: NETWORK_TIMEOUT_MILLIS + 5000 });
  const took = Date.now() - t0;
  expect(took).toBeGreaterThanOrEqual(NETWORK_TIMEOUT_MILLIS - 500);
  expect(took).toBeLessThan(NETWORK_TIMEOUT_MILLIS + 5000);
  expect(held.length).toBeGreaterThan(0);

  // the network answers late, with a new page: it goes in the cache for next time
  const fresh = await (await page.request.get(shellUrl)).text();
  for (const route of held) await route.fulfill({ status: 200, contentType: "text/html", body: fresh.replace("</body>", "<!-- late answer --></body>") });
  await expect.poll(() => cachedShell(page)).toContain("<!-- late answer -->");
  await context.unrouteAll({ behavior: "ignoreErrors" });
});
