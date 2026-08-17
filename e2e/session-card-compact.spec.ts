import { expect, test } from "@playwright/test";

/** Scratch spec for the session-card compaction + chart→list focus. Delete after review. */

const SHOTS =
  "C:/Users/Jordan/AppData/Local/Temp/claude/c--Users-Jordan-rc-engineer-app/cb93f737-21e3-4d17-9d4e-c383a4f9a812/scratchpad";

/** Background of the row whose text contains `text`, as the browser computes it. */
async function bg(page: import("@playwright/test").Page, selector: string, text: string) {
  return page.evaluate(
    ([sel, needle]) => {
      const el = Array.from(document.querySelectorAll(sel)).find((node) =>
        (node.textContent ?? "").includes(needle)
      ) as HTMLElement | undefined;
      if (!el) return "MISSING";
      const cs = getComputedStyle(el);
      return `${cs.backgroundColor} | left-border ${cs.borderLeftColor}`;
    },
    [selector, text] as const
  );
}

test("chart focus lights the run row — desktop rail", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/debug/session-trend");
  await expect(page.getByText("Session trend").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1000);

  const rows = '[role="option"][data-run-id]';
  console.log("RAIL ROWS " + (await page.locator(rows).count()));
  const before = await bg(page, rows, "R3");

  const svg = page.getByRole("img", { name: /trend across/ }).first();
  const box = (await svg.boundingBox())!;
  // Chart is chronological left→right over 5 runs; R3 is the middle point.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35);
  await page.waitForTimeout(400);
  const after = await bg(page, rows, "R3");
  const neighbour = await bg(page, rows, "R2");
  console.log("R3 BEFORE " + before);
  console.log("R3 AFTER  " + after);
  console.log("R2 AFTER  " + neighbour);
  await page.screenshot({ path: `${SHOTS}/focus-1-desktop.png` });

  expect(after).not.toBe(before);
  expect(neighbour).toBe(before);

  // Pointer off the plot clears it.
  await page.mouse.move(box.x + box.width * 0.5, box.y - 120);
  await page.waitForTimeout(400);
  const cleared = await bg(page, rows, "R3");
  console.log("R3 CLEARED " + cleared);
  expect(cleared).toBe(before);
});

test("chart focus lights the run row — phone list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/debug/session-trend");
  await expect(page.getByText("Session trend").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1000);

  const rows = "main button";
  const before = await bg(page, rows, "R3");

  const svg = page.getByRole("img", { name: /trend across/ }).first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await bg(page, rows, "R3");
  console.log("PHONE R3 BEFORE " + before);
  console.log("PHONE R3 AFTER  " + after);
  await page.screenshot({ path: `${SHOTS}/focus-2-phone.png` });
  expect(after).not.toBe(before);
});

test("pace overview focus lights the driver row", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto("/debug/team-focus");
  await expect(page.getByText("Pace overview").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);

  const card = page.locator("section").first();
  const rowSel = "li button[data-driver-id]";
  const before = await bg(page, rowSel, "Mara Ellis");

  const svg = card.getByRole("img").first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.waitForTimeout(300);
  const after = await bg(page, rowSel, "Mara Ellis");
  console.log("DRIVER1 BEFORE " + before);
  console.log("DRIVER1 AFTER  " + after);
  await card.screenshot({ path: `${SHOTS}/focus-3-team.png` });
  expect(after).not.toBe(before);
});
