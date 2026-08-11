import { test, expect } from "@playwright/test";

/**
 * The sheet behaves differently on a phone and on a desktop, and this is what holds that apart.
 *
 * WHY IT NEEDS ITS OWN SPEC. `playwright.config.ts` runs at 390px but with `isMobile: false`, so
 * `(pointer: fine)` matches and every other spec takes the DESKTOP path — even the ones named for
 * the phone. Without a run that sets `hasTouch`, the phone behaviour is not covered at all.
 *
 * The split itself is not cosmetic. A phone has to zoom in on a six-pixel box and take the screen
 * over, because the keyboard covers half of it. A desktop must do neither: the founder's complaint
 * (2026-08-11) was that clicking a box threw away the view they had set up for themselves.
 */

/** The page wrapper's transform is the ground truth for "did the sheet move or scale". */
async function pageTransform(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".origin-top-left");
    return el ? getComputedStyle(el).transform : "none";
  });
}

function scaleOf(transform: string): number {
  return Number(transform.match(/matrix\(([\d.]+)/)?.[1] ?? "1");
}

async function openXraySheet(page: import("@playwright/test").Page) {
  await page.goto("/debug/sheet-fill?blank=xray-x4-2026");
  // The box list arrives by fetch, so wait for a real box rather than a timeout.
  await expect(page.getByRole("button", { name: "Race", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(900); // let the page image paint and the view settle
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false });

  test("clicking a box focuses it without moving the sheet", async ({ page }) => {
    await openXraySheet(page);

    const before = await pageTransform(page);
    await page.getByRole("button", { name: "Bump steer", exact: true }).click();
    await page.waitForTimeout(700);

    expect(await pageTransform(page), "a click must not zoom or pan on a desktop").toBe(before);
    // Focused, so the value bar is offering the box — it just didn't take the screen over.
    await expect(page.locator("input[aria-label='Bump steer']")).toBeVisible();
  });

  test("the wheel zooms by a step, not a leap", async ({ page }) => {
    await openXraySheet(page);

    const stage = page.locator(".origin-top-left").locator("..");
    const box = await stage.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, -100); // one notch in
    await page.waitForTimeout(300);

    const scale = scaleOf(await pageTransform(page));
    expect(scale, "one notch must do something").toBeGreaterThan(1.05);
    expect(scale, "one notch must not leap across the sheet").toBeLessThan(1.35);
  });

  test("the caret goes in the box, and there is no bar under the sheet", async ({ page }) => {
    await openXraySheet(page);
    await page.getByRole("button", { name: "Bump steer", exact: true }).first().click();
    await page.waitForTimeout(500);

    // The founder's complaint (2026-08-11): typing dragged the window down to a bar below the page.
    // There is no bar on a desktop now, so there is nothing below the page to be dragged to.
    await expect(page.getByRole("button", { name: "Done" })).toHaveCount(0);

    const placed = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>("input[aria-label='Bump steer']");
      const box = [...document.querySelectorAll<HTMLElement>("[data-sheet-box]")].find(
        (el) => el.getAttribute("aria-label") === "Bump steer"
      );
      if (!input || !box) return null;
      const a = input.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      return { dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y), focused: document.activeElement === input };
    });
    expect(placed, "the box and its input must both exist").not.toBeNull();
    expect(placed!.focused, "the caret must be in the box on the sheet").toBe(true);
    expect(placed!.dx, "the input must sit on the box, not under the page").toBeLessThan(2);
    expect(placed!.dy, "the input must sit on the box, not under the page").toBeLessThan(2);
  });

  test("clicking a box never scrolls the window", async ({ page }) => {
    await openXraySheet(page);

    // The box furthest down the sheet is the worst case: it is the one that used to pull the window.
    const lowest = await page.evaluate(() => {
      const els = [...document.querySelectorAll<HTMLElement>("[data-sheet-box]")];
      const wide = els
        .map((el) => ({ label: el.getAttribute("aria-label") ?? "", top: el.getBoundingClientRect().top, w: el.getBoundingClientRect().width }))
        .filter((b) => b.w > 40 && b.label)
        .sort((a, b) => b.top - a.top);
      return wide[0]?.label ?? null;
    });
    expect(lowest, "there must be a box low on the sheet to click").not.toBeNull();

    await page.getByRole("button", { name: lowest!, exact: true }).first().click();
    await page.keyboard.type("4.5");
    await page.waitForTimeout(400);

    expect(await page.evaluate(() => window.scrollY), "typing must not move the window").toBe(0);
  });

  test("tab steps to the next box without touching the mouse", async ({ page }) => {
    await openXraySheet(page);
    await page.getByRole("button", { name: "Bump steer", exact: true }).first().click();
    await page.waitForTimeout(400);

    await page.keyboard.press("Tab");
    await page.waitForTimeout(400);

    const next = await page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement | null;
      return el?.tagName === "INPUT" ? el.getAttribute("aria-label") : null;
    });
    expect(next, "tab must land in another box, not out of the sheet").not.toBeNull();
    expect(next).not.toBe("Bump steer");
  });

  test("tab never gets stuck on a tick box", async ({ page }) => {
    await openXraySheet(page);
    await page.getByRole("button", { name: "Bump steer", exact: true }).first().click();
    await page.waitForTimeout(400);

    // A run of tabs crosses tick boxes, and a tick box has nothing to type into. Without something
    // holding the keyboard there, focus fell off the sheet and every keystroke after it went
    // nowhere — measured 2026-08-11, two boxes into a tab run.
    const labels: (string | null)[] = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(120);
      labels.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          return el?.tagName === "INPUT" ? el.getAttribute("aria-label") : null;
        })
      );
    }
    expect(labels.filter((l) => l === null), "the keyboard must never fall off the sheet").toEqual([]);
    expect(new Set(labels).size, "each tab must land somewhere new").toBeGreaterThan(5);
  });

  test("a tick box is answered by the click itself", async ({ page }) => {
    await openXraySheet(page);

    const plan = await (await page.request.get("/api/debug/sheet-plan?id=xray-x4-2026")).json();
    const tick = (plan.fields as { label: string; uiType: string }[]).find((f) => f.uiType === "checkbox");
    expect(tick, "the X4 sheet must have a tick box to test with").toBeTruthy();

    await page.getByRole("button", { name: tick!.label, exact: true }).first().click();
    await page.waitForTimeout(400);

    const state = await page.evaluate((label: string) => {
      const box = [...document.querySelectorAll<HTMLElement>("[data-sheet-box]")].find(
        (el) => el.getAttribute("aria-label") === label
      );
      return { marked: !!box?.querySelector("span"), focusedTag: document.activeElement?.tagName ?? null };
    }, tick!.label);

    expect(state.marked, "one click must put the mark on").toBe(true);
    expect(state.focusedTag, "a tick box has nothing to type, so it takes no focus").not.toBe("INPUT");
  });

  test("the whole page is on screen, not cropped", async ({ page }) => {
    await openXraySheet(page);

    // The stage is sized to the page, so nothing of the sheet sits outside it. A `maxHeight` used
    // to cut the last third off an A4 — including the comments box, which drivers do fill in.
    const fits = await page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>(".origin-top-left img");
      const stage = img?.closest<HTMLElement>(".overflow-hidden");
      if (!img || !stage) return null;
      return { image: Math.round(img.getBoundingClientRect().height), stage: stage.clientHeight };
    });
    expect(fits, "the sheet and its stage must both be measurable").not.toBeNull();
    expect(fits!.stage, "the stage must be tall enough for the whole page").toBeGreaterThanOrEqual(
      fits!.image - 2
    );
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a coarse pointer still zooms to the box it was given", async ({ page }) => {
    await openXraySheet(page);

    const coarse = await page.evaluate(
      () => !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    );
    expect(coarse, "this run has to actually look like a phone, or it proves nothing").toBe(true);

    await page.getByRole("button", { name: "Bump steer", exact: true }).click();
    await page.waitForTimeout(800);

    expect(
      scaleOf(await pageTransform(page)),
      "a phone cannot type into a six-pixel box, so it must zoom"
    ).toBeGreaterThan(2);
  });

  test("the value bar is still there, because a thumb needs it", async ({ page }) => {
    await openXraySheet(page);
    await page.getByRole("button", { name: "Bump steer", exact: true }).first().click();
    await page.waitForTimeout(800);

    // Removing the bar was a DESKTOP answer. Taking it off the phone too would put the caret back
    // in a six-pixel box under a keyboard covering half the screen.
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
  });
});

test.describe("create / upload setup sheet", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("offers all three ways in", async ({ page }) => {
    await page.goto("/debug/onboarding-preview");
    await page.waitForTimeout(800);

    const opener = page.getByRole("button", { name: /Create \/ Upload setup sheet/ }).first();
    await expect(opener).toBeVisible({ timeout: 20_000 });
    await opener.click();
    await page.waitForTimeout(700);

    await expect(page.getByText("Fill in a blank sheet")).toBeVisible();
    await expect(page.getByText("Upload a sheet you've filled in")).toBeVisible();
    await expect(page.getByText("Start from a baseline")).toBeVisible();
  });

  test("a door that cannot work is greyed with the reason, never removed", async ({ page }) => {
    await page.goto("/debug/onboarding-preview");
    await page.waitForTimeout(800);

    // The "chassis with no calibration" fixture: nothing green-lit, no baselines published.
    const scenario = page
      .locator("div")
      .filter({ hasText: /^Car added — chassis with no calibration/ })
      .first();
    await scenario.scrollIntoViewIfNeeded();
    await scenario.getByRole("button", { name: /Create \/ Upload setup sheet/ }).first().click();
    await page.waitForTimeout(700);

    // All three still listed…
    await expect(page.getByText("Fill in a blank sheet")).toBeVisible();
    await expect(page.getByText("Upload a sheet you've filled in")).toBeVisible();
    await expect(page.getByText("Start from a baseline")).toBeVisible();
    // …and the two that cannot work say why, which is the whole point of leaving them there.
    await expect(page.getByText(/can't read a sheet for the Awesomatix A800 yet/)).toBeVisible();
    await expect(page.getByText("No baselines published for this chassis yet.")).toBeVisible();
  });
});
