import { expect, test } from "@playwright/test";

/**
 * Visual coverage of every first-run state.
 *
 * /debug/onboarding-preview renders the REAL WelcomeScreen and DashboardGetSetUpCard against
 * fabricated props across all nine states, with `window.fetch` stubbed for /api/onboarding
 * only. So this locks the shipped components without needing a database row per state — the
 * expensive full-account drive is only needed for what the preview cannot fake (first
 * sign-in, `seen` persisting across reload, /cars → add car → card flips).
 *
 * Labels are the selector because the page has no test ids. If a label is renamed here it
 * should be renamed deliberately — a silent rename failing this suite is the point.
 */

/** Must match the STATES array in src/app/debug/onboarding-preview/page.tsx. */
const STATES = [
  "Brand-new account",
  "Overlay answered, still empty",
  "Car added — green-lit chassis",
  "Car added — chassis with no calibration",
  "Car + timing, no setup",
  "Car + setup, no timing",
  "Garage ready",
  "First run logged, garage incomplete",
  "Ignored",
] as const;

test.beforeEach(async ({ page }) => {
  await page.goto("/debug/onboarding-preview");
  await expect(page.getByRole("heading", { name: "Onboarding preview" })).toBeVisible();

  // The page holds every card back behind a `ready` flag until a useEffect has installed the
  // /api/onboarding fetch stub. Screenshot before that and each card is still the "not shown"
  // placeholder — which is how this suite was flaking. The summon button is `disabled={!ready}`,
  // so its enabled state is the honest hydration signal.
  await expect(page.getByRole("button", { name: /summon|overlay/i }).first()).toBeEnabled({
    timeout: 15_000,
  });
});

test("the preview page renders and is not gated away", async ({ page }) => {
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page).toHaveScreenshot("onboarding-preview-full.png", { fullPage: true });
});

test("every documented first-run state is present", async ({ page }) => {
  const missing: string[] = [];
  for (const label of STATES) {
    if ((await page.getByText(label, { exact: true }).count()) === 0) missing.push(label);
  }
  expect(missing, `states missing from the preview page: ${missing.join(", ")}`).toEqual([]);
});

for (const label of STATES) {
  test(`state renders: ${label}`, async ({ page }) => {
    const block = page.locator(`[data-onboarding-state="${label}"]`);
    await expect(block).toBeVisible();
    await expect(block).toHaveScreenshot(`state-${slug(label)}.png`);
  });
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
