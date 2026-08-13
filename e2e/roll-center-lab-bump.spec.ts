import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * The Lab's chassis pose: roll and bump, and the restyled schematic.
 *
 * Bump moves the chassis while the tyres stay planted, from the deck (ride height 0) to twice
 * static. Three things here cannot be answered by typechecking:
 *
 *  1. Does the drawing survive the extremes — the four-bar has to re-assemble at every step.
 *  2. Does the view hold still — the frame mounts ride up and down out of the derived viewBox,
 *     so without the bump extremes folded into `extraPoints` the whole drawing rescales as you
 *     drag, which looks like the car growing rather than moving.
 *  3. Is bump really a pose — the stored RC / rake row and its delta chips must not budge.
 */

const OUT = "roll-center-lab-shots";
mkdirSync(OUT, { recursive: true });

const BUMP = /Chassis bump/;
const ROLL = /Chassis roll angle/;

/** The schematic's viewBox — its height is derived from the drawing extents. */
async function viewBox(page: Page): Promise<string> {
  return (await page.locator("svg[role='img']").first().getAttribute("viewBox")) ?? "";
}

/** The three stored numbers (RC front, RC rear, rake) that a pose must never touch. */
async function storedRow(page: Page): Promise<string> {
  return (await page.locator("div.grid.grid-cols-3").first().innerText()).replace(/\s+/g, " ");
}

async function setBump(page: Page, mm: number) {
  await page.getByLabel(BUMP).fill(String(mm));
  await page.waitForTimeout(150);
}

test("chassis bump: deck to droop, stacked with roll, view holds still", async ({ page }) => {
  await page.goto("/analysis/roll-center");

  const bump = page.getByLabel(BUMP);
  await expect(bump).toBeVisible({ timeout: 30_000 });

  // Front axle default ride height is 5.0mm, so travel is 0 -> 10.
  expect(await bump.getAttribute("min")).toBe("0");
  expect(await bump.getAttribute("max")).toBe("10");
  expect(await bump.inputValue()).toBe("5");

  const boxStatic = await viewBox(page);
  const rowStatic = await storedRow(page);
  await page.screenshot({ path: `${OUT}/01-static.png` });

  // --- the deck: ride height 0, chassis plate down on the ground line ---
  await setBump(page, 0);
  await expect(page.getByText(/RH 0\.0mm/)).toBeVisible();
  await expect(page.locator("svg[role='img']").first()).toBeVisible();
  const boxDeck = await viewBox(page);
  await page.screenshot({ path: `${OUT}/02-deck.png` });

  // --- full droop: twice static ---
  await setBump(page, 10);
  await expect(page.getByText(/RH 10\.0mm/)).toBeVisible();
  await expect(page.locator("svg[role='img']").first()).toBeVisible();
  const boxDroop = await viewBox(page);
  await page.screenshot({ path: `${OUT}/03-droop.png` });

  /*
   * The view height is derived from the drawing extents, and the tallest thing in the drawing is
   * the tyre — whose top leans with camber, which gains as the chassis moves. So a few hundredths
   * of drift are inherent (chassis roll has always done the same). What must not happen is the
   * drawing visibly resizing: hold it to 1% of the frame height.
   */
  const h = (box: string) => Number(box.split(" ")[3]);
  const drift = (box: string) => Math.abs(h(box) - h(boxStatic)) / h(boxStatic);
  console.log(`  viewBox static ${boxStatic} | deck ${boxDeck} | droop ${boxDroop}`);
  console.log(`  height drift: deck ${(drift(boxDeck) * 100).toFixed(3)}% · droop ${(drift(boxDroop) * 100).toFixed(3)}%`);
  expect(drift(boxDeck), "the view must not visibly rescale at the deck").toBeLessThan(0.01);
  expect(drift(boxDroop), "the view must not visibly rescale at full droop").toBeLessThan(0.01);

  // --- roll and bump stack ---
  await setBump(page, 3);
  await page.getByLabel(ROLL).fill("3");
  await page.waitForTimeout(200);
  await expect(page.getByText(/3\.0° · RC/)).toBeVisible();
  await expect(page.getByText(/RH 3\.0mm/)).toBeVisible();
  await page.screenshot({ path: `${OUT}/04-roll-and-bump.png` });

  // --- a pose is not a setup change ---
  expect(await storedRow(page), "bump must not move the stored RC/rake row").toBe(rowStatic);

  // --- the roll centre really moves with bump (the whole point) ---
  await page.getByLabel(ROLL).fill("0");
  await setBump(page, 0);
  const rcDeck = await page.getByText(/0\.0° · RC/).innerText();
  await setBump(page, 10);
  const rcDroop = await page.getByText(/0\.0° · RC/).innerText();
  expect(rcDroop, "roll centre must migrate across the bump travel").not.toBe(rcDeck);
  console.log(`  RC at the deck : ${rcDeck.replace(/\s+/g, " ")}`);
  console.log(`  RC at droop    : ${rcDroop.replace(/\s+/g, " ")}`);
});

test("each slider resets on its own, and reset stops the animation", async ({ page }) => {
  await page.goto("/analysis/roll-center");
  const resetRoll = page.getByRole("button", { name: "Reset roll" });
  const resetBump = page.getByRole("button", { name: "Reset bump" });
  await expect(resetRoll).toBeVisible({ timeout: 30_000 });

  // Nothing to undo at rest — present but inert, so the card never reflows.
  await expect(resetRoll).toBeDisabled();
  await expect(resetBump).toBeDisabled();

  await page.getByLabel(ROLL).fill("2.5");
  await setBump(page, 8);
  await expect(resetRoll).toBeEnabled();
  await expect(resetBump).toBeEnabled();

  // Each undoes only its own axis — that is the point of splitting them.
  await resetRoll.click();
  await expect(page.getByText(/0\.0° · RC/)).toBeVisible();
  await expect(page.getByText(/RH 8\.0mm/)).toBeVisible();
  await expect(resetRoll).toBeDisabled();
  await expect(resetBump).toBeEnabled();

  await resetBump.click();
  await expect(page.getByText(/RH 5\.0mm/)).toBeVisible();
  await expect(resetBump).toBeDisabled();
  await page.screenshot({ path: `${OUT}/07-reset.png` });
});

test("ghost takes the same bump and stays legible", async ({ page }) => {
  await page.goto("/analysis/roll-center");
  await expect(page.getByLabel(BUMP)).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /Compare current/i }).click();
  await page.waitForTimeout(300);

  // Move the live car away from the ghost so the two are distinguishable.
  await page.getByLabel(/Under hub/i).first().fill("1.5");
  await page.waitForTimeout(300);
  await setBump(page, 2);
  await page.screenshot({ path: `${OUT}/05-ghost-bumped.png` });

  // Both cars drawn: live solid + ghost dotted means more than one linkage group.
  const dotted = page.locator("svg[role='img'] line[stroke-dasharray='1 3']");
  expect(await dotted.count(), "ghost members must be drawn dotted").toBeGreaterThan(0);
});

test("light mode: the thin strokes still read on paper", async ({ page }) => {
  await page.goto("/analysis/roll-center");
  await expect(page.getByLabel(BUMP)).toBeVisible({ timeout: 30_000 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.waitForTimeout(300);
  await setBump(page, 1.5);
  await page.screenshot({ path: `${OUT}/06-light.png` });
});
