import { test, expect, type CDPSession, type Page } from "@playwright/test";

/**
 * Who owns a drag on the setup sheet: the sheet, or the page it is sitting in.
 *
 * Fitted, the whole sheet is on screen and there is nothing to pan to, so the finger belongs to the
 * page — without that the sheet is a dead zone most of the phone screen tall that the page cannot be
 * scrolled past (founder, 2026-08-16). Zoomed in it is the driver's only way to move around the
 * paper, so it belongs to the sheet. Two fingers always belong to the sheet.
 *
 * This is worth a spec because the whole thing turns on one CSS property (`touch-action` on the
 * stage) and one `preventDefault` on a two-finger touch-start, and nothing else in the app would
 * notice if either stopped working — the sheet would still render, still pinch on a desktop trackpad
 * and still pass every other test. The `control` test forces the old value back to prove the drag
 * really is doing something.
 *
 * Touch is dispatched over CDP: Playwright's `touchscreen` taps but does not drag, and a drag is the
 * whole question here.
 */

test.use({ hasTouch: true });

type Pt = { x: number; y: number; id: number };

type TouchEventType = "touchStart" | "touchEnd" | "touchMove" | "touchCancel";

async function send(cdp: CDPSession, type: TouchEventType, points: Pt[]) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id })),
  });
}

async function dragUp(cdp: CDPSession, from: { x: number; y: number }, by: number) {
  const p = { ...from, id: 1 };
  await send(cdp, "touchStart", [p]);
  for (let i = 1; i <= 10; i++) {
    await send(cdp, "touchMove", [{ ...p, y: from.y - (by * i) / 10 }]);
    await new Promise((r) => setTimeout(r, 16));
  }
  await send(cdp, "touchEnd", []);
  await new Promise((r) => setTimeout(r, 400));
}

async function pinchOut(cdp: CDPSession, centre: { x: number; y: number }) {
  const a = { x: centre.x - 20, y: centre.y, id: 1 };
  const b = { x: centre.x + 20, y: centre.y, id: 2 };
  await send(cdp, "touchStart", [a, b]);
  for (let i = 1; i <= 10; i++) {
    const spread = 20 + i * 10;
    await send(cdp, "touchMove", [
      { ...a, x: centre.x - spread },
      { ...b, x: centre.x + spread },
    ]);
    await new Promise((r) => setTimeout(r, 16));
  }
  await send(cdp, "touchEnd", []);
  await new Promise((r) => setTimeout(r, 300));
}

/** The transform on the page layer tells us the zoom without reaching into React. */
async function zoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>(".origin-top-left");
    const m = new DOMMatrixReadOnly(layer ? getComputedStyle(layer).transform : "none");
    return m.a;
  });
}

test("one finger scrolls the page at fit zoom, pans the sheet when zoomed in", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await page.goto("/debug/sheet-fill");

  const stage = page.locator("div.origin-top-left").first();
  await expect(stage).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500); // the page picture is a separate fetch

  const box = (await stage.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: Math.min(box.y + 120, 700) };

  expect(await zoom(page)).toBeCloseTo(1, 1);
  const before = await page.evaluate(() => window.scrollY);
  await dragUp(cdp, centre, 200);
  const afterFit = await page.evaluate(() => window.scrollY);
  console.log("fit zoom: scrollY", before, "->", afterFit);
  expect(afterFit).toBeGreaterThan(before + 50);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  await pinchOut(cdp, centre);
  const z = await zoom(page);
  console.log("after pinch, zoom =", z);
  expect(z).toBeGreaterThan(1.2);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  const zoomedBefore = await page.evaluate(() => window.scrollY);
  await dragUp(cdp, centre, 200);
  const zoomedAfter = await page.evaluate(() => window.scrollY);
  console.log("zoomed in: scrollY", zoomedBefore, "->", zoomedAfter);
  expect(zoomedAfter).toBe(zoomedBefore);
});

test("a tap on a box at fit zoom still opens it", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await page.goto("/debug/sheet-fill");
  const stage = page.locator("div.origin-top-left").first();
  await expect(stage).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  const target = page.locator("[data-sheet-box]").first();
  const b = (await target.boundingBox())!;
  const p = { x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 };
  await send(cdp, "touchStart", [p]);
  await send(cdp, "touchEnd", []);
  await page.waitForTimeout(600);

  console.log("after tap, zoom =", await zoom(page));
  await expect(page.locator("input").first()).toBeVisible();
  expect(await zoom(page)).toBeGreaterThan(1.2);
});

/** The control: force the old `touch-action: none` back on and the same drag should do nothing. */
test("control — touch-action none is the dead zone", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await page.goto("/debug/sheet-fill");
  const stage = page.locator("div.origin-top-left").first();
  await expect(stage).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const box = (await stage.boundingBox())!;

  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("div.origin-top-left")?.parentElement;
    if (el) el.style.touchAction = "none";
  });
  const before = await page.evaluate(() => window.scrollY);
  await dragUp(cdp, { x: box.x + box.width / 2, y: Math.min(box.y + 120, 700) }, 200);
  const after = await page.evaluate(() => window.scrollY);
  console.log("control (touch-action none): scrollY", before, "->", after);
  expect(after).toBe(before);
});

test("desktop wheel: fitted scrolls the page, ctrl-wheel zooms", async ({ page }) => {
  await page.goto("/debug/sheet-fill");
  const stage = page.locator("div.origin-top-left").first();
  await expect(stage).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const box = (await stage.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: Math.min(box.y + 120, 700) };

  await page.mouse.move(centre.x, centre.y);
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(300);
  const afterWheel = await page.evaluate(() => window.scrollY);
  console.log("wheel at fit zoom: scrollY", before, "->", afterWheel, "zoom", await zoom(page));
  expect(afterWheel).toBeGreaterThan(before + 50);
  expect(await zoom(page)).toBeCloseTo(1, 1);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.mouse.move(centre.x, centre.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await page.waitForTimeout(300);
  const z = await zoom(page);
  console.log("ctrl-wheel: zoom", z, "scrollY", await page.evaluate(() => window.scrollY));
  expect(z).toBeGreaterThan(1.2);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
