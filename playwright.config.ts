import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browse the same origin the suite signs in through.
 *
 * `auth.setup.ts` mints its magic link from `AUTH_URL`, and Auth.js issues the session cookie for
 * whatever host that link lands on — host-only, so a cookie set on `192.168.50.91` is never sent
 * to `localhost`. When AUTH_URL was repointed at the LAN IP for phone testing (2026-08-13), the
 * setup project kept passing and then EVERY spec using the shared state silently landed on
 * /login: nineteen failures, one cause, and none of them where the breakage was.
 *
 * `.env.local` is read directly because Playwright configs don't load it, and only the origin is
 * taken. `E2E_BASE_URL` still wins when set.
 */
function signInOrigin(): string {
  if (process.env.E2E_BASE_URL) return process.env.E2E_BASE_URL;
  try {
    const line = readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .find((l) => l.trimStart().startsWith("AUTH_URL="));
    const value = line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
    if (value) return new URL(value).origin;
  } catch {
    // No .env.local, or an AUTH_URL that isn't a URL — fall through to the default.
  }
  return "http://localhost:3000";
}

const BASE_URL = signInOrigin();

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
    baseURL: BASE_URL,
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
    url: `${BASE_URL}/login`,
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
