import { expect, test } from "@playwright/test";

/**
 * Run: `npm run test:engineer-subject`
 *
 * The subject bar (back 2026-09-03) has three states, and each one must change what the chat
 * route is SENT — that is the whole point of the bar. The route is faked and its request body
 * captured, so this costs no LLM call and needs no entitlement. The fresh test account has no
 * runs, which is fine: Auto reads "No runs yet", a pin from a deep link falls back to the label
 * "Run", and General is General.
 */

type SentBody = { runId?: string; mode?: string; messages?: unknown[] };

async function stubChat(page: import("@playwright/test").Page, sent: SentBody[]) {
  await page.route("**/api/engineer/chat", async (route) => {
    sent.push(route.request().postDataJSON() as SentBody);
    const body = `event: status\ndata: ${JSON.stringify({ phase: "thinking" })}\n\nevent: token\ndata: ${JSON.stringify({ t: "Try a softer rear spring." })}\n\nevent: done\ndata: ${JSON.stringify({ reply: "Try a softer rear spring." })}\n\n`;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      body,
    });
  });
}

/** Press until the question is on screen — a send before hydration is swallowed silently. */
async function ask(page: import("@playwright/test").Page, question: string) {
  const composer = page.getByLabel("Message to engineer");
  const bubble = page.getByText(question, { exact: true });
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

test("General sends no run, and tapping back returns to Auto", async ({ page }) => {
  const sent: SentBody[] = [];
  await stubChat(page, sent);
  await page.goto("/engineer");

  const bar = page.getByRole("group", { name: "Engineer subject" });
  await expect(bar).toBeVisible();
  await expect(bar.getByText("No runs yet")).toBeVisible();

  await bar.getByRole("button", { name: /Ask a general question/ }).click();
  await expect(page).toHaveURL(/mode=general/);
  await expect(bar.getByRole("button", { name: /back onto your runs/ })).toBeVisible();

  await ask(page, "What does anti-squat do?");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].mode).toBe("general");
  expect(sent[0].runId).toBeUndefined();

  await bar.getByRole("button", { name: /back onto your runs/ }).click();
  await expect(page).not.toHaveURL(/mode=general/);
  await expect(bar.getByText("No runs yet")).toBeVisible();
});

test("a run pin from a deep link is sent as the run to read, and unpinning clears it", async ({ page }) => {
  const sent: SentBody[] = [];
  await stubChat(page, sent);
  await page.goto("/engineer?pin=run:run_abc123");

  const bar = page.getByRole("group", { name: "Engineer subject" });
  await expect(bar.getByRole("button", { name: /^Pinned to/ })).toBeVisible();

  await ask(page, "Why was I slow here?");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].runId).toBe("run_abc123");
  expect(sent[0].mode).toBeUndefined();

  await bar.getByRole("button", { name: /^Unpin/ }).click();
  await expect(page).not.toHaveURL(/pin=/);
  await expect(bar.getByText("No runs yet")).toBeVisible();
});
