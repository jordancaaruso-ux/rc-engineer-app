import { expect, test } from "@playwright/test";

/**
 * Run: `npm run test:engineer-starters:e2e`
 *
 * The starter questions exist to be tapped, and the one behaviour that matters
 * is that a tap FILLS the composer without sending — a mis-tap must not spend a
 * request from the monthly cap. That can't be checked from source, so it's
 * checked here, against the real page.
 *
 * The shared auth state is a freshly minted throwaway account with nothing
 * logged, so this exercises the state a new driver actually meets: no run in
 * focus, so no "read this run" family and no read-across-runs questions.
 */

const SHOT_DIR = "e2e/.shots";

test("a starter question fills the composer and does not send", async ({ page }) => {
  await page.goto("/engineer");

  const rail = page.getByRole("group", { name: "Suggested questions" }).first();
  await expect(rail).toBeVisible();

  // Nothing logged: the run family is hidden, so no chip can be a dead end.
  await expect(rail.getByRole("button", { name: "What should I change?" })).toHaveCount(0);
  await expect(rail.getByRole("button", { name: "What actually made me faster?" })).toHaveCount(0);

  const composer = page.getByLabel("Message to engineer");
  await expect(composer).toHaveValue("");

  const chip = rail.getByRole("button", { name: "Loose on entry" });
  await expect(chip).toBeVisible();
  await chip.click();

  // Filled with the full question, not the short label.
  await expect(composer).toHaveValue(
    "The car is loose on corner entry — the rear steps out as I turn in. What do I try first?",
  );
  await expect(composer).toBeFocused();

  // Nothing was sent: no message bubbles (each is labelled "You" or "Engineer"),
  // and the starter row is still there because the thread is still empty.
  await expect(page.locator("text=/^You$/")).toHaveCount(0);
  await expect(rail).toBeVisible();

  await page.screenshot({ path: `${SHOT_DIR}/engineer-starters-phone.png`, fullPage: false });
});

test("the rail stops drifting the moment it is touched", async ({ page }) => {
  await page.goto("/engineer");

  const rail = page.getByRole("group", { name: "Suggested questions" }).first();
  await expect(rail).toBeVisible();

  const scrollLeft = () => rail.evaluate((el) => el.scrollLeft);

  // Let the drift get past its opening hold and actually move.
  await expect.poll(scrollLeft, { timeout: 6000 }).toBeGreaterThan(0);

  await rail.dispatchEvent("pointerdown");
  const atStop = await scrollLeft();

  // Give it well over a second — a still-running drift would have moved ~20px.
  await page.waitForTimeout(1500);
  expect(Math.abs((await scrollLeft()) - atStop)).toBeLessThan(3);
});

test("desktop shows the board in the empty transcript row, and only the board", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/engineer");

  // Both render only once the candidate list lands, so wait for the board itself.
  const board = page.locator(".engineer-starter-board");
  await expect(board).toBeVisible();
  await expect(board.getByRole("button")).toHaveCount(6);

  // Both are in the DOM; the rail is `lg:hidden`, so exactly one is on screen.
  const visible = await page
    .getByRole("group", { name: "Suggested questions" })
    .evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).length);
  expect(visible).toBe(1);

  // Let the stagger finish, or the shot catches five chips still at opacity 0.
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOT_DIR}/engineer-starters-desktop.png`, fullPage: false });
});
