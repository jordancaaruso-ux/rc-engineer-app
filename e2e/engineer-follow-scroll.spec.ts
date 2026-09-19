import { expect, test } from "@playwright/test";

/**
 * Run: `npm run test:engineer-follow`
 *
 * The complaint this locks down (2026-09-01): the Engineer's answer streamed in below the fold
 * and the driver had to scroll after every reply to read it. The transcript must follow the
 * newest words on its own — and stop following the moment the driver scrolls up to re-read
 * something, or the panel fights them.
 *
 * The chat route is faked, so this costs no LLM call and needs no entitlement: what is under
 * test is the transcript's own scrolling, not the answer.
 */

const LINES = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of the answer, long enough to fill the well.`);

async function stubChat(page: import("@playwright/test").Page) {
  await page.route("**/api/engineer/chat", async (route) => {
    const parts = LINES.map((l) => `event: token\ndata: ${JSON.stringify({ t: `${l}\n\n` })}\n\n`).join("");
    const body = `event: status\ndata: ${JSON.stringify({ phase: "preparing" })}\n\n${parts}event: done\ndata: ${JSON.stringify({ reply: LINES.join("\n\n") })}\n\n`;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      body,
    });
  });
}

/** How far the transcript is from its own bottom, in px. */
function distanceFromBottom(page: import("@playwright/test").Page) {
  return page.getByTestId("engineer-transcript")
    .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
}

/**
 * The composer only sends once React has attached its key handler, and a send made a beat too
 * early is swallowed with no trace — so press until the question is actually on screen. Nothing
 * here is about scrolling; it is just the difference between a real failure and a race.
 */
async function ask(page: import("@playwright/test").Page, question: string) {
  const composer = page.getByLabel("Message to engineer");
  const bubble = page.getByText(question, { exact: false });
  await expect
    .poll(
      async () => {
        if ((await bubble.count()) > 0) return true;
        await composer.fill(question);
        await composer.press("Enter");
        return (await bubble.count()) > 0;
      },
      { timeout: 15000 },
    )
    .toBe(true);
}

test("the transcript follows the answer to the bottom", async ({ page }) => {
  await stubChat(page);
  await page.goto("/engineer");

  await ask(page, "Why is the car loose?");

  await expect(page.getByText("Line 40 of the answer", { exact: false })).toBeVisible();

  // The foot of the thread is on screen without anyone touching the scrollbar.
  await expect.poll(() => distanceFromBottom(page), { timeout: 5000 }).toBeLessThan(8);
  await page.screenshot({ path: "e2e/.shots/engineer-follows-bottom.png" });
});

test("scrolling up to re-read stops the follow, and coming back resumes it", async ({ page }) => {
  await stubChat(page);
  await page.goto("/engineer");

  await ask(page, "First question");
  await expect.poll(() => distanceFromBottom(page), { timeout: 5000 }).toBeLessThan(8);

  const well = page.getByTestId("engineer-transcript");
  await well.evaluate((el) => { el.scrollTop = 0; });
  await expect.poll(() => distanceFromBottom(page)).toBeGreaterThan(100);

  // Content arriving while the driver is reading history must not yank them down…
  await well.evaluate((el) => {
    const inner = el.firstElementChild as HTMLElement;
    const grown = document.createElement("div");
    grown.style.height = "600px";
    inner.appendChild(grown);
  });
  await page.waitForTimeout(300);
  expect(await well.evaluate((el) => el.scrollTop)).toBe(0);

  // …but sending the next question puts them back on the newest words.
  await ask(page, "Second question");
  await expect.poll(() => distanceFromBottom(page), { timeout: 5000 }).toBeLessThan(8);
});

test("it follows on a desktop window too, where the grid row owns the height", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubChat(page);
  await page.goto("/engineer");

  await ask(page, "Why is the car loose?");

  await expect(page.getByText("Line 40 of the answer", { exact: false })).toBeVisible();
  await expect.poll(() => distanceFromBottom(page), { timeout: 5000 }).toBeLessThan(8);
  await page.screenshot({ path: "e2e/.shots/engineer-follows-bottom-desktop.png" });
});
