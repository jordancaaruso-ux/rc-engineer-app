import { defineConfig, devices } from "@playwright/test";

/**
 * Browser verification for the app. This exists so an agent can see its own work render
 * instead of guessing — the loop is: run it, screenshot, compare, fix, repeat.
 *
 * Everything except /login is behind `src/middleware.ts`, so specs need a real session.
 * The `setup` project mints a throwaway account (the same script the test-onboarding skill
 * uses), signs in through the real magic-link callback, and saves the cookies; every other
 * project reuses them. That means sign-in itself is covered by the act of running the suite.
 *
 * 390px wide is the review width in docs/VISUAL_NORTH_STAR.md — this app is phone-first.
 */
export default defineConfig({
  testDir: "./e2e",
  // Screenshots must be byte-stable to be worth anything, so never run visual specs in
  // parallel against one dev server.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: false, // Chromium desktop honours the viewport without touch emulation quirks
        storageState: "e2e/.auth/state.json",
      },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },

  expect: {
    // Anti-aliasing differs across machines; allow a small fraction of pixels to differ
    // so the suite fails on real layout regressions, not font rendering.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled" },
  },
});
