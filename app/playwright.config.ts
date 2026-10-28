import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "fs";

// Runs against the production build (`vite preview`). Locally, a preinstalled
// Chromium can be used via PLAYWRIGHT_BROWSERS_PATH; CI runs
// `pnpm exec playwright install --with-deps chromium` first.
const fallback = "/opt/pw-browsers/chromium";
let executablePath: string | undefined;
try {
  const { chromium } = await import("@playwright/test");
  if (!existsSync(chromium.executablePath()) && existsSync(fallback)) executablePath = fallback;
} catch {
  /* use the default */
}

const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"], browserName: "chromium" } }],
  webServer: {
    command: `pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
