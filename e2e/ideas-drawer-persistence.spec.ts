/**
 * The Ideas drawer must agree with the database across a close and reopen.
 *
 *   npx playwright test e2e/ideas-drawer-persistence.spec.ts --project=mobile-chromium
 *
 * Written for the 2026-08-15 bug: the drawer fetched its lists only on the first open and
 * unmounted the panel on close, so reopening re-seeded from that first snapshot — items you
 * had added vanished and items you had removed came back, while the rows were saved the whole
 * time. Nothing in tsc, the unit tests or the build can see it; only driving it can.
 *
 * Every checkpoint asks BOTH sides: the DOM for what the drawer shows, and GET /api/action-items
 * over the browser's own cookies for what the server holds. A pass means they match.
 */
import { expect, test } from "@playwright/test";

const STAMP = Date.now();
const A = `REPRO-A-${STAMP}`;
const B = `REPRO-B-${STAMP}`;

test.setTimeout(180_000);

test("ideas drawer keeps edits across close/reopen", async ({ page }) => {
  const log = (s: string) => console.log(`  ${s}`);

  await page.goto("/");

  // Fresh account from the setup project: answer the welcome overlay if it's armed.
  // It is a portal behind a `mounted` guard, so it lands after first paint — `isVisible()`
  // is a snapshot and always misses it. Wait for it properly.
  const lookAround = page.getByRole("button", { name: "Look around first" });
  const armed = await lookAround
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (armed) {
    await lookAround.click();
    await expect(lookAround).toBeHidden({ timeout: 15_000 });
    await page.waitForTimeout(1200);
  }
  log(`welcome overlay armed: ${armed}`);

  const tab = page.getByRole("button", { name: "Ideas and reminders" });
  const dialog = page.getByRole("dialog", { name: "Ideas and reminders" });
  const input = dialog.getByLabel("Add an idea", { exact: true });

  /** What the server holds, over the browser's own cookies. */
  async function serverTry(): Promise<string[]> {
    const res = await page.request.get("/api/action-items?list=try");
    const json = (await res.json()) as { items?: { text: string }[] };
    return (json.items ?? []).map((i) => i.text);
  }

  /** What the drawer is showing right now. */
  async function drawerTry(): Promise<string[]> {
    return dialog.locator("div:not(.hidden) > div > ul > li p").allTextContents();
  }

  // ---- 1. open, add two items -------------------------------------------------
  await tab.click();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await input.waitFor({ state: "visible", timeout: 20_000 });
  log(`open #1, before adds — drawer: ${JSON.stringify(await drawerTry())}`);

  for (const text of [A, B]) {
    await input.fill(text);
    await dialog.getByRole("button", { name: "Add idea" }).first().click();
    await expect(dialog.getByText(text, { exact: true })).toBeVisible({ timeout: 15_000 });
  }

  const afterAddDom = await drawerTry();
  const afterAddApi = await serverTry();
  log(`open #1, after adds  — drawer: ${JSON.stringify(afterAddDom)}`);
  log(`open #1, after adds  — server: ${JSON.stringify(afterAddApi)}`);
  await page.screenshot({ path: "tmp-ideas-1-after-add.png" });

  // ---- 2. close, reopen (no page load in between) ------------------------------
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await page.waitForTimeout(600); // let the 260ms slide-out finish unmounting

  await tab.click();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await input.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(800);

  const reopenDom = await drawerTry();
  const reopenApi = await serverTry();
  log(`open #2, reopened    — drawer: ${JSON.stringify(reopenDom)}`);
  log(`open #2, reopened    — server: ${JSON.stringify(reopenApi)}`);
  await page.screenshot({ path: "tmp-ideas-2-reopened.png" });

  // ---- 3. what the dashboard card behind it shows ------------------------------
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(600);
  const cardDom = await page
    .locator("main")
    .getByText(new RegExp(`REPRO-[AB]-${STAMP}`))
    .allTextContents();
  log(`dashboard card       — shows: ${JSON.stringify(cardDom)}`);

  // ---- 4. hard reload, open again ----------------------------------------------
  await page.reload();
  await page.waitForTimeout(1500);
  if (await lookAround.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false)) {
    await lookAround.click();
    await expect(lookAround).toBeHidden({ timeout: 15_000 });
    await page.waitForTimeout(1000);
  }
  await tab.click();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await input.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(800);

  const afterReloadDom = await drawerTry();
  log(`after reload         — drawer: ${JSON.stringify(afterReloadDom)}`);
  await page.screenshot({ path: "tmp-ideas-3-after-reload.png" });

  // ---- 5. now DELETE one, close, reopen -----------------------------------------
  const rowA = dialog.locator("div:not(.hidden) > div > ul > li").filter({ hasText: A });
  await rowA.getByRole("button", { name: "Remove idea" }).click();
  await expect(dialog.getByText(A, { exact: true })).toBeHidden({ timeout: 15_000 });
  await page.waitForTimeout(800);
  log(`after delete of A    — drawer: ${JSON.stringify(await drawerTry())}`);
  log(`after delete of A    — server: ${JSON.stringify(await serverTry())}`);

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await page.waitForTimeout(600);
  await tab.click();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await input.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(800);

  const afterDeleteReopenDom = await drawerTry();
  const afterDeleteReopenApi = await serverTry();
  log(`delete → reopen      — drawer: ${JSON.stringify(afterDeleteReopenDom)}`);
  log(`delete → reopen      — server: ${JSON.stringify(afterDeleteReopenApi)}`);
  await page.screenshot({ path: "tmp-ideas-4-delete-reopened.png" });

  // ---- verdict -------------------------------------------------------------------
  log("");
  log(`server kept the adds:            ${reopenApi.includes(A) && reopenApi.includes(B)}`);
  log(`drawer showed them on reopen:    ${reopenDom.includes(A) && reopenDom.includes(B)}`);
  log(`drawer showed them after reload: ${afterReloadDom.includes(A) && afterReloadDom.includes(B)}`);
  log(`server really deleted A:         ${!afterDeleteReopenApi.includes(A)}`);
  log(`deleted A came BACK in drawer:   ${afterDeleteReopenDom.includes(A)}`);

  expect
    .soft(reopenDom, "drawer on reopen should still show the added items")
    .toEqual(expect.arrayContaining([A, B]));
  expect.soft(afterDeleteReopenDom, "a removed item must not come back on reopen").not.toContain(A);
  expect.soft(afterDeleteReopenDom, "the reopened drawer should match the server").toEqual(
    afterDeleteReopenApi,
  );
});
