/**
 * The notes tab's "open me" nudge fires when it should and — more importantly — stops.
 *
 *   npx playwright test e2e/ideas-tab-nudge.spec.ts --project=mobile-chromium
 *
 * Written alongside the 2026-08-18 change that took the looping sheen off the tab and put a
 * one-shot nudge in its place. The whole value of that change is in the STOPPING conditions,
 * and every one of them is invisible to tsc, the build and a screenshot: they are a route
 * check, a localStorage flag and an event listener. Only driving it can see them.
 *
 * Four rules:
 *   1. On the dashboard, an unopened tab nudges on a ~5s cadence.
 *   2. Opening the panel once retires the idle nudge for good, across reloads.
 *   3. Off the dashboard it never idles at all.
 *   4. Adding to a list still nudges — but only when the drawer is shut.
 *
 * COUNTING. These count `animationstart` events, NOT the `.is-nudging` class. The first draft
 * polled the class and under-counted badly: re-firing removes and re-adds the class inside one
 * task, so every nudge after the first was invisible to a poller, and — worse — the three
 * "expect zero" assertions passed for entirely the wrong reason. The animation event is the
 * thing actually being claimed, so it is the thing to measure.
 */
import { expect, test, type Page } from "@playwright/test";

const STAMP = Date.now();

/** Comfortably longer than two 5s cycles, short enough to keep the suite quick. */
const WATCH_MS = 12_000;
const ANIMATION_NAME = "rc-ideas-tab-nudge";

test.setTimeout(240_000);

/**
 * Fail loudly if the tab is not actually wired to the animation.
 *
 * Two different environments would otherwise make this whole file lie, and both fail the same
 * silent way — every count comes back 0, which reads as "the nudge is correctly quiet" rather
 * than "nothing was ever going to fire":
 *
 *   1. Stale CSS. `next dev` has served it through repeated restarts in this repo.
 *   2. A browser asking for reduced motion, where the nudge is deliberately suppressed.
 *
 * Both collapse `animation-name` to something other than the nudge, so asserting the computed
 * name catches them together. That is also why this file does not set `reducedMotion` through
 * `test.use` — it is not in this Playwright version's option types, and the guard covers it
 * more thoroughly anyway.
 */
async function assertNudgeWired(page: Page): Promise<void> {
  const animationName = await page.evaluate(() => {
    const el = document.querySelector(".ideas-edge-tab");
    if (!el) return "NO TAB IN DOM";
    el.classList.add("is-nudging");
    const name = getComputedStyle(el).animationName;
    el.classList.remove("is-nudging");
    return name;
  });
  expect(animationName, "the .is-nudging rule is missing from the served CSS").toBe(
    ANIMATION_NAME
  );
}

/** Install the counter. Must be re-armed after any navigation. */
async function armCounter(page: Page): Promise<void> {
  await page.evaluate((name) => {
    const w = window as unknown as { __nudges: number };
    w.__nudges = 0;
    document.addEventListener(
      "animationstart",
      (e) => {
        if ((e as AnimationEvent).animationName === name) w.__nudges += 1;
      },
      true
    );
  }, ANIMATION_NAME);
}

/** Zero the counter, wait out a real time window, and report what fired inside it. */
async function countNudges(page: Page, windowMs: number): Promise<number> {
  await page.evaluate(() => {
    (window as unknown as { __nudges: number }).__nudges = 0;
  });
  // A literal wall-clock window is the measurement here, not a substitute for a wait-for.
  await page.waitForTimeout(windowMs);
  return page.evaluate(() => (window as unknown as { __nudges: number }).__nudges);
}

/** A brand-new account lands on the welcome overlay; clear it so the dashboard is reachable. */
async function dismissWelcome(page: Page): Promise<void> {
  const lookAround = page.getByRole("button", { name: "Look around first" });
  const armed = await lookAround
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!armed) return;
  await lookAround.click();
  await expect(lookAround).toBeHidden({ timeout: 15_000 });
  await page.waitForTimeout(1200);
}

/**
 * The first add row actually on screen on the dashboard, outside the drawer.
 *
 * Deliberately found by its composite class rather than by label. The dashboard renders the same
 * panel under two titles — "Ideas" (one card, every day, since the 2026-08-18 split) and
 * "Things to do" — so any label-based locator is really an assertion about which dashboard
 * variant the seeded account happened to get, which is not what this test is about.
 *
 * Filtered to visible because the lower cards sit below the fold clipped by the dock, and an add
 * row the driver cannot see is not one they could have typed into. Scoped to `main` so it can
 * never accidentally match the drawer's own copy of the same control.
 */
function dashboardAddInput(page: Page) {
  return page
    .locator("main .action-item-add-composite input[type='text']")
    .filter({ visible: true })
    .first();
}

test.describe("ideas tab nudge", () => {
  test.beforeEach(async ({ page }) => {
    // Every rule below is defined relative to "has never opened the panel", and that flag is
    // per-device and persistent by design — so without this, test order would decide results.
    await page.goto("/");
    await page.evaluate(() => window.localStorage.removeItem("jrc:ideas-opened"));
  });

  test("idles on the dashboard, and stops for good once opened", async ({ page }) => {
    const log = (s: string) => console.log(`  ${s}`);

    await page.goto("/");
    await dismissWelcome(page);

    const tab = page.getByRole("button", { name: "Ideas and reminders" });
    await expect(tab).toBeVisible({ timeout: 20_000 });
    await assertNudgeWired(page);
    await armCounter(page);

    // ---- 1. it nudges on a ~5s cadence ---------------------------------------
    const idle = await countNudges(page, WATCH_MS);
    log(`nudges in ${WATCH_MS / 1000}s on the dashboard, never opened: ${idle}`);
    // 5s cadence across a 12s window is 2 or 3 depending on where the window lands.
    expect(idle).toBeGreaterThanOrEqual(2);
    expect(idle).toBeLessThanOrEqual(4);

    // ---- 2. opening it retires the idle nudge --------------------------------
    await tab.click();
    const dialog = page.getByRole("dialog", { name: "Ideas and reminders" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const afterOpen = await countNudges(page, WATCH_MS);
    log(`nudges in ${WATCH_MS / 1000}s after opening once: ${afterOpen}`);
    expect(afterOpen).toBe(0);

    // ...and it stays retired across a reload, which is the point of persisting the flag.
    await page.reload();
    await expect(tab).toBeVisible({ timeout: 20_000 });
    await armCounter(page);
    const afterReload = await countNudges(page, WATCH_MS);
    log(`nudges in ${WATCH_MS / 1000}s after a reload: ${afterReload}`);
    expect(afterReload).toBe(0);
  });

  test("never idles away from the dashboard", async ({ page }) => {
    const log = (s: string) => console.log(`  ${s}`);

    await page.goto("/");
    await dismissWelcome(page);
    // Straight to a page you sit and read on, with the flag still unset — so the ONLY thing
    // that can be keeping the tab still here is the route check.
    await page.goto("/runs");

    const tab = page.getByRole("button", { name: "Ideas and reminders" });
    await expect(tab).toBeVisible({ timeout: 20_000 });
    await assertNudgeWired(page);
    await armCounter(page);

    const idle = await countNudges(page, WATCH_MS);
    log(`nudges in ${WATCH_MS / 1000}s on /runs, never opened: ${idle}`);
    expect(idle).toBe(0);
  });

  test("adding to a list nudges, but only with the drawer shut", async ({ page }) => {
    const log = (s: string) => console.log(`  ${s}`);

    await page.goto("/");
    await dismissWelcome(page);

    const tab = page.getByRole("button", { name: "Ideas and reminders" });
    const dialog = page.getByRole("dialog", { name: "Ideas and reminders" });
    await expect(tab).toBeVisible({ timeout: 20_000 });
    await assertNudgeWired(page);
    await armCounter(page);

    // Burn the idle nudge first: from here on, the only thing that may move the tab is an add.
    await tab.click();
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    const text = `NUDGE-${STAMP}`;
    const drawerInput = dialog.getByLabel("Add an idea", { exact: true });
    await drawerInput.fill(text);
    await drawerInput.press("Enter");
    await expect(dialog.getByText(text)).toBeVisible({ timeout: 15_000 });

    // An add made inside the open drawer must NOT nudge: the tab is slid out of position and
    // the new row is already visible exactly where it was typed.
    const whileOpen = await countNudges(page, 2_500);
    log(`nudges from an add made inside the open drawer: ${whileOpen}`);
    expect(whileOpen).toBe(0);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Now the real case: add from the dashboard's own list with the drawer shut, long after
    // the panel has been opened — the one nudge that deliberately outlives the ceiling.
    const dashInput = dashboardAddInput(page);
    await expect(dashInput).toBeVisible({ timeout: 20_000 });

    await page.evaluate(() => {
      (window as unknown as { __nudges: number }).__nudges = 0;
    });
    await dashInput.fill(`${text}-DASH`);
    await dashInput.press("Enter");
    await expect(page.locator("main").getByText(`${text}-DASH`)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_000);

    const onAdd = await page.evaluate(
      () => (window as unknown as { __nudges: number }).__nudges
    );
    log(`nudges from an add made on the dashboard, drawer shut: ${onAdd}`);
    expect(onAdd).toBe(1);
  });
});
