import { expect, test } from "@playwright/test";

/**
 * The analyze flow's video steps, at three window sizes.
 *
 * Guards the thing that is easy to lose by accident: on a desktop window the picture must grow
 * into the window instead of staying phone-sized (it shipped at 768x432 inside a 1920x1080
 * window — 16% of the screen — because the flow was clamped to `max-w-6xl` and a fixed 16:9
 * box). It also drags a sector-line end, because the endpoint markers and the frame sizing
 * share the same coordinate maths: if the overlay stops covering the painted picture, the line
 * lands somewhere other than where you dropped it and nothing else here would notice.
 *
 * Runs against /debug/analyze-flow-preview — stubbed endpoints, generated sample video, so no
 * job, no upload and no DB writes.
 */

const SHOTS = process.env.SHOT_DIR ?? "e2e/.shots";

const SIZES = [
  { name: "desktop-1920", width: 1920, height: 1080, minPictureWidth: 1300 },
  { name: "laptop-1440", width: 1440, height: 900, minPictureWidth: 950 },
  { name: "phone-390", width: 390, height: 844, minPictureWidth: 330 },
];

for (const size of SIZES) {
  test(`analyze flow · video steps @ ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/debug/analyze-flow-preview");

    await page.getByRole("button", { name: /heat2_stand/ }).click();
    await page.getByRole("button", { name: /This run's laps/ }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Edit lines" }).click();
    await expect(page.getByRole("heading", { name: "Draw sector lines" })).toBeVisible();
    await page.waitForTimeout(500);

    const video = page.locator("video");
    const painted = await video.evaluate((el: HTMLVideoElement) => {
      const r = el.getBoundingClientRect();
      const va = el.videoWidth / el.videoHeight;
      const ca = r.width / r.height;
      return {
        w: va >= ca ? r.width : r.height * va,
        h: va >= ca ? r.width / va : r.height,
        top: r.top,
      };
    });
    // Everything the picture needs to work with — frame plus transport — has to be on screen
    // without scrolling, or the scrub controls sit below the fold on the step that uses them.
    const controlsBottom = await page
      .getByRole("button", { name: "+1 frame" })
      .evaluate((el) => el.getBoundingClientRect().bottom);

    console.log(
      `[${size.name}] picture=${Math.round(painted.w)}x${Math.round(painted.h)} ` +
        `(${((painted.w * painted.h) / (size.width * size.height) * 100).toFixed(0)}% of window) ` +
        `top=${Math.round(painted.top)} controlsBottom=${Math.round(controlsBottom)}`
    );
    await page.screenshot({ path: `${SHOTS}/lines-${size.name}.png` });

    expect(painted.w).toBeGreaterThan(size.minPictureWidth);
    expect(controlsBottom).toBeLessThanOrEqual(size.height);

    // Drag one end: the mark goes yellow and throws a crosshair, and the point follows.
    const handle = page.getByRole("button", { name: "Move SF endpoint 1" });
    const before = await handle.boundingBox();
    await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
    await page.mouse.down();
    await page.mouse.move(before!.x + 90, before!.y - 60, { steps: 8 });
    await page.screenshot({
      path: `${SHOTS}/handle-${size.name}.png`,
      clip: {
        x: Math.max(0, before!.x - 60),
        y: Math.max(0, before!.y - 140),
        width: Math.min(360, size.width - Math.max(0, before!.x - 60)),
        height: 240,
      },
    });
    await page.mouse.up();
    const after = await handle.boundingBox();
    expect(Math.abs(after!.x - before!.x - 68)).toBeLessThan(12);

    // The sync step shares the transport — it must size the same way.
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: /Continue to sync/ }).click();
    await expect(page.getByRole("heading", { name: "Sync the laps" })).toBeVisible();
    const syncWidth = await video.evaluate((el) => el.getBoundingClientRect().width);
    expect(syncWidth).toBeGreaterThan(size.minPictureWidth);
    await page.screenshot({ path: `${SHOTS}/sync-${size.name}.png` });
  });
}
