/**
 * The demo walkthrough, driven end to end on the seeded demo account.
 *
 * Covers what `/debug/demo-tour-preview` structurally cannot: that the demo lands on the
 * dashboard, that the tour auto-starts there, that Next actually changes route and the popover
 * lands on a real anchor once the page's card entrance has settled, that dismissal sticks
 * across a reload, and that the banner restarts it.
 *
 * Prerequisite: `npm run demo:seed`.
 *
 *   npx playwright test e2e/demo-tour.spec.ts --no-deps --project=mobile-chromium
 *   npx playwright test e2e/demo-tour.spec.ts --no-deps --project=chromium
 */
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: "Australia/Melbourne" });
test.setTimeout(300_000);

const DIALOG = '[role="dialog"]';

/** Signs the browser into the shared demo account. Same trick as demo-name-leak-check. */
async function signInAsDemo(page: Page): Promise<void> {
  const out = execFileSync(
    "npx",
    [
      "dotenv-cli", "-e", ".env.local", "--", "node", "--conditions=react-server", "--import",
      "tsx", "scripts/dev-demo-signin.ts",
    ],
    { encoding: "utf8", shell: true, timeout: 120_000 },
  );
  const dbHost = out.match(/Database:\s*(\S+)/)?.[1] ?? "(unknown)";
  if (/ep-hidden-rice/.test(dbHost)) throw new Error(`REFUSING: pointed at PRODUCTION (${dbHost})`);
  const signInUrl = out.match(/https?:\/\/\S*callback\/nodemailer\S+/)?.[0];
  if (!signInUrl) throw new Error("no sign-in URL:\n" + out);

  await page.goto(signInUrl);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

test("the demo lands on the dashboard and the walkthrough opens there", async ({ page }) => {
  await signInAsDemo(page);

  // The regression test for the callbackUrl reversal: the demo used to land on /runs/history.
  await expect(page).toHaveURL(/\/$|\/\?/, { timeout: 30_000 });

  const dialog = page.locator(DIALOG);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toContainText("Log a run");
  await expect(dialog).toContainText("01 /");

  // The cutout only renders once an anchor has been resolved AND has stopped moving, so its
  // presence is the assertion that the settle loop survived `.rc-reveal`.
  await expect(page.locator(".rc-tour-hole")).toBeVisible();
});

test("Next walks the stops and changes route", async ({ page }) => {
  await signInAsDemo(page);
  const dialog = page.locator(DIALOG);
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  // Walk until Sessions, which is the first stop on another page.
  for (let i = 0; i < 4; i += 1) {
    if (await dialog.getByText("Sessions", { exact: true }).isVisible().catch(() => false)) break;
    await dialog.getByRole("button", { name: /^Next$/ }).click();
    await page.waitForTimeout(600);
  }

  await expect(page).toHaveURL(/\/runs\/history/, { timeout: 20_000 });
  await expect(dialog).toContainText("Sessions");
  await expect(page.locator(".rc-tour-hole")).toBeVisible({ timeout: 20_000 });
});

test("dismissal sticks across a reload, and the banner brings it back", async ({ page }) => {
  await signInAsDemo(page);
  const dialog = page.locator(DIALOG);
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  await dialog.getByRole("button", { name: "Skip" }).click();
  await expect(dialog).toBeHidden();

  // sessionStorage survives a reload in the same context, so it must not come back.
  await page.reload();
  await page.waitForTimeout(2_000);
  await expect(page.locator(DIALOG)).toBeHidden();

  await page.getByRole("button", { name: "Take the tour" }).click();
  await expect(page.locator(DIALOG)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(DIALOG)).toContainText("01 /");
});

test("Escape closes it", async ({ page }) => {
  await signInAsDemo(page);
  await expect(page.locator(DIALOG)).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.locator(DIALOG)).toBeHidden();
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("gets the extra hero stop the phone does not", async ({ page }) => {
    await signInAsDemo(page);
    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // Seven stops at xl+, six below it — the count is rendered as `01 / 07`.
    await expect(dialog).toContainText("/ 07");

    await dialog.getByRole("button", { name: /^Next$/ }).click();
    await expect(dialog).toContainText("The day's summary", { timeout: 10_000 });
  });
});
