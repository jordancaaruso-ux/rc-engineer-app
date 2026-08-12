import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * The computed-geometry strip on a drawn sheet, at phone width.
 *
 * Two questions, neither of which typechecking can answer. Does the strip read as chrome above the
 * paper rather than a card stacked on it, and does the roll centre actually MOVE when a shim value
 * changes — the argument for putting geometry on an editable surface in the first place.
 *
 * Driven through `/debug/roll-center-strip`, which pairs an A800RR setup with an Xray sheet picture
 * because no A800RR blank is checked into the repo. See that page for why.
 */

const OUT = "roll-center-strip-shots";
mkdirSync(OUT, { recursive: true });

const STRIP = "[data-testid='sheet-geometry-strip']";

test("geometry strip — collapsed, expanded, and moving", async ({ page }) => {
  await page.goto("/debug/roll-center-strip");

  const strip = page.locator(STRIP);
  await expect(strip).toBeVisible({ timeout: 30_000 });

  // The collapsed line is the whole readout for a driver who never opens it.
  const collapsed = await strip.locator("button").innerText();
  expect(collapsed).toMatch(/RC\s*[-−+]?\d+\.\d\s*\/\s*[-−+]?\d+\.\d/);
  await page.waitForTimeout(600); // let the sheet picture paint underneath
  await page.screenshot({ path: `${OUT}/01-collapsed.png` });

  // Open the drawer: segmented front/rear, the schematic, the three rows, the Lab door.
  await strip.locator("button").first().click();
  await expect(strip.getByRole("link", { name: "Open in Lab" })).toBeVisible();
  await expect(strip.locator("svg").nth(1)).toBeVisible();
  await page.screenshot({ path: `${OUT}/02-expanded-front.png` });

  await strip.getByRole("radio", { name: "Rear", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/03-expanded-rear.png` });

  /*
   * The move. Under-hub shims are sign-inverted in the pack — raising the hub drops the lower ball
   * in the knuckle frame, so the roll centre goes UP. Half a millimetre should be worth about one.
   */
  const before = await strip.locator("button").first().innerText();
  await page.getByLabel("Under hub, front").fill("0.5");
  await page.waitForTimeout(300);
  const after = await strip.locator("button").first().innerText();

  expect(after, "the roll centre must move when a shim does").not.toBe(before);
  await page.screenshot({ path: `${OUT}/04-after-shim.png` });

  // And the neutral delta appears, counting from the values as loaded.
  await expect(strip.getByText(/↑|↓/).first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/05-delta.png` });

  console.log(`  collapsed before: ${before.replace(/\s+/g, " ")}`);
  console.log(`  collapsed after:  ${after.replace(/\s+/g, " ")}`);
});
