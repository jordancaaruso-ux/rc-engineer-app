import { expect, test } from "@playwright/test";

/**
 * Tap-to-zoom on the picture, on the steps after the lines are drawn.
 *
 * Picking the frame a car crosses a line on is pixel work: at phone size the car is a few
 * pixels wide. Drawing has the loupe; Sync and Mark magnify the picture itself — one tap
 * closer, two closer still, a third back out to the whole frame.
 *
 * The two things worth guarding are the two that are easy to break by accident: the spot you
 * tapped must come to the middle of the frame (a zoom that lands somewhere else is worse than
 * the lines must magnify with the picture, or a sector line would sit somewhere other than
 * the bit of track it was drawn on. Runs against /debug/analyze-flow-preview — stubbed
 * endpoints and a generated video, so no job, no upload, no DB writes.
 */

const SHOTS = process.env.SHOT_DIR ?? "e2e/.shots";

/** The frame's own transform, as the browser resolves it. */
async function frameScale(page: import("@playwright/test").Page) {
  return page.locator("video").evaluate((el: HTMLVideoElement) => {
    const wrapper = el.parentElement!;
    const m = new DOMMatrixReadOnly(getComputedStyle(wrapper).transform);
    return { a: m.a, e: m.e, f: m.f };
  });
}

/** A run of the flow that nothing an earlier test left behind can steer — the in-flow line
 *  editor keeps its draft in localStorage, and a stale one skips the door this spec presses. */
async function freshPreview(page: import("@playwright/test").Page) {
  await page.goto("/debug/analyze-flow-preview");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
}

async function gotoSync(page: import("@playwright/test").Page) {
  await freshPreview(page);
  await page.getByRole("button", { name: /heat2_stand/ }).click();
  await page.getByRole("button", { name: /This run's laps/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Continue to sync/ }).click();
  await expect(page.getByRole("heading", { name: "Sync", exact: true })).toBeVisible();
  await page.waitForTimeout(500);
}

test("tapping the picture zooms to the tap, twice, then back out", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoSync(page);

  const video = page.locator("video");
  const frame = (await video.boundingBox())!;
  // Off-centre, but not so far out that the clamp (no black margin) moves the picture for us.
  const tap = { x: frame.x + frame.width * 0.35, y: frame.y + frame.height * 0.6 };

  const labels = page.locator("span", { hasText: /^(SF|Esses)$/ });
  const spread = async () => {
    const boxes = await labels.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })
    );
    return Math.hypot(boxes[0]!.x - boxes[1]!.x, boxes[0]!.y - boxes[1]!.y);
  };

  const spreadFit = await spread();
  expect((await frameScale(page)).a).toBeCloseTo(1, 3);

  for (const [tapNo, expected] of [
    [1, 3.5],
    [2, 8],
  ] as const) {
    // Where the tapped pixel sits before the tap, in the transformed frame.
    const beforeM = await frameScale(page);
    const contentX = (tap.x - frame.x - beforeM.e) / beforeM.a;
    const contentY = (tap.y - frame.y - beforeM.f) / beforeM.a;

    await page.mouse.click(tap.x, tap.y);
    await page.waitForTimeout(120);

    const m = await frameScale(page);
    expect(m.a).toBeCloseTo(expected, 3);
    // The spot you tapped is now the middle of the frame — out from under the thumb that
    // was covering it, which is the whole point of tapping it.
    expect(Math.abs(frame.x + m.e + m.a * contentX - (frame.x + frame.width / 2))).toBeLessThan(1.5);
    expect(Math.abs(frame.y + m.f + m.a * contentY - (frame.y + frame.height / 2))).toBeLessThan(1.5);
    // The lines grew with the picture — same magnification, so a line still sits on its track.
    expect(await spread()).toBeCloseTo(spreadFit * expected, 0);
    await page.screenshot({ path: `${SHOTS}/zoom-tap${tapNo}.png` });
  }

  await expect(page.getByRole("button", { name: /Fit/ })).toBeVisible();

  // Third tap comes back out to the whole frame.
  await page.mouse.click(tap.x, tap.y);
  await page.waitForTimeout(120);
  const out = await frameScale(page);
  expect(out.a).toBeCloseTo(1, 3);
  expect(await spread()).toBeCloseTo(spreadFit, 0);
  await expect(page.getByRole("button", { name: /Fit/ })).toHaveCount(0);
});

test("a drag pans the magnified picture instead of zooming again", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoSync(page);

  const frame = (await page.locator("video").boundingBox())!;
  const tap = { x: frame.x + frame.width * 0.5, y: frame.y + frame.height * 0.5 };
  await page.mouse.click(tap.x, tap.y);
  await page.waitForTimeout(120);
  const before = await frameScale(page);
  expect(before.a).toBeCloseTo(3.5, 3);

  await page.mouse.move(tap.x, tap.y);
  await page.mouse.down();
  await page.mouse.move(tap.x - 120, tap.y - 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);

  const after = await frameScale(page);
  expect(after.a).toBeCloseTo(3.5, 3); // still the same magnification — a drag is not a tap
  expect(after.e - before.e).toBeCloseTo(-120, 0);
  expect(after.f - before.f).toBeCloseTo(-40, 0);
});

test("drawing lines does not zoom — the loupe is the magnifier there", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshPreview(page);
  await page.getByRole("button", { name: /heat2_stand/ }).click();
  await page.getByRole("button", { name: /This run's laps/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // The editor refuses to open until the picture is decoded ("still loading — try again").
  await page.waitForFunction(() => {
    const v = document.querySelector("video");
    return !!v && v.videoWidth > 0;
  });
  await page.getByRole("button", { name: "Edit lines" }).click();
  await expect(page.getByRole("heading", { name: "Draw sector lines" })).toBeVisible();
  await page.waitForTimeout(500);

  const frame = (await page.locator("video").boundingBox())!;
  await page.mouse.click(frame.x + frame.width * 0.2, frame.y + frame.height * 0.25);
  await page.waitForTimeout(120);
  expect((await frameScale(page)).a).toBeCloseTo(1, 3);
});
