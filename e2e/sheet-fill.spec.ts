import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Drives the setup-sheet fill surface at phone width and captures what it actually looks like.
 *
 * The question this is here to answer is not "does it render" — it is whether stepping box to box
 * on a real 200-box A4 sheet is a reasonable thing to ask of a driver. That can only be judged by
 * looking at it, so this walks the real screen and saves the frames.
 */

const OUT = "sheet-fill-shots";
mkdirSync(OUT, { recursive: true });

/*
 * This spec is about the PHONE, so it has to actually be one.
 *
 * `playwright.config.ts` runs at 390px with `isMobile: false`, which means `(pointer: fine)` matches
 * and the sheet takes its DESKTOP path — no value bar, no zoom on focus, the caret in the box. The
 * frames below were being captured from that path and called phone shots. See the same note in
 * `sheet-fill-pointer.spec.ts`, which exists to hold the two apart.
 */
test.use({ hasTouch: true, isMobile: true });

test("fill surface — Xray sheet, named boxes", async ({ page }) => {
  await page.goto("/debug/sheet-fill?blank=xray-x4-2026");

  // The box list arrives by fetch, so wait for a real box rather than a timeout.
  const firstBox = page.getByRole("button", { name: "Race", exact: true });
  await expect(firstBox).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(600); // let the sheet image paint

  await page.screenshot({ path: `${OUT}/01-xray-overview.png` });

  // Tap a box — this is the whole interaction being judged.
  await page.getByRole("button", { name: "Bump steer", exact: true }).click();
  await page.waitForTimeout(700); // the zoom transition
  await page.screenshot({ path: `${OUT}/02-xray-focused.png` });

  // Type a value and step on, the way a driver would go down the sheet.
  const input = page.locator("input[aria-label='Bump steer']");
  await input.fill("0.5");
  await input.press("Enter");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/03-xray-stepped.png` });

  // A few more so progress is visible, then back out to the whole sheet.
  for (const v of ["1.0", "2", "3.5"]) {
    const active = page.locator("input[aria-label]").first();
    if (await active.isVisible().catch(() => false)) {
      await active.fill(v);
      await active.press("Enter");
      await page.waitForTimeout(350);
    }
  }

  /*
   * Tick boxes: the sheet decides its own mark, and this one crosses rather than ticks.
   *
   * ONE tap does it, on a phone as on a desktop (founder, 2026-08-14). This used to take two — the
   * tap only focused the box and the mark was made by pressing "Not ticked" in the bar — which read
   * as a checkbox that would not check. The bar must still be showing the box afterwards, because
   * dropping focus here is what closes the keyboard mid-sheet.
   */
  await page.getByRole("button", { name: "Fr caster · box 1 of 3", exact: true }).click();
  await page.waitForTimeout(500);
  await expect(
    page.getByRole("button", { name: "Ticked", exact: true }),
    "one tap ticks the box, and the bar says so"
  ).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/07-xray-tick.png` });

  /*
   * THE KEYBOARD MUST NEVER CLOSE while a box is focused.
   *
   * A phone shows the keyboard for whatever is focused, so the only way to stop it opening and
   * closing between a tick box and a text box — half a second of the screen resizing twice, on
   * every step — is for focus never to leave the one input. That is checkable here even though a
   * headless browser has no keyboard: if the input still holds focus after tapping a tick box and
   * stepping on, a real phone keeps the keyboard up.
   */
  const focusedTag = () => page.evaluate(() => document.activeElement?.tagName ?? "");
  expect(await focusedTag(), "focus survives ticking a box").toBe("INPUT");
  await page.getByRole("button", { name: "Next box" }).click();
  await page.waitForTimeout(200);
  expect(await focusedTag(), "focus survives stepping on from a tick box").toBe("INPUT");
  await page.getByRole("button", { name: "Previous box" }).click();
  await page.waitForTimeout(200);
  expect(await focusedTag(), "focus survives stepping back").toBe("INPUT");

  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/04-xray-progress.png` });
});

test("fill surface — Mugen sheet, nothing named", async ({ page }) => {
  await page.goto("/debug/sheet-fill?blank=mugen-mtc3");

  const firstBox = page.getByRole("button", { name: /^Box 1 · page 1/ });
  await expect(firstBox).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/05-mugen-overview.png` });

  await firstBox.click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/06-mugen-focused.png` });
});
