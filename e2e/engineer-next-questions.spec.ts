import { expect, test } from "@playwright/test";

/**
 * Run: `npm run test:engineer-next`
 *
 * Follow-up buttons (founder, 2026-09-24): under the newest answer, the app's own "Other options"
 * and the two or three questions the Engineer picked; a tap sends. The route is faked — the stream
 * carries the `[[next: …]]` line the way the model writes it, to prove it never reaches the screen,
 * while `done` carries the questions the server cut out — so this costs no LLM call.
 */

type SentBody = { messages?: Array<{ role: string; content: string }> };

const FIRST = "Try one step softer on the front anti-roll bar. It may make turn-in gentler.";
const SECOND = "Two ways to keep the turn-in: one step less front toe-out, or a stiffer front spring.";

async function stubChat(page: import("@playwright/test").Page, sent: SentBody[]) {
  await page.route("**/api/engineer/chat", async (route) => {
    sent.push(route.request().postDataJSON() as SentBody);
    const first = sent.length === 1;
    const reply = first ? FIRST : SECOND;
    const next = first ? ["What if turn-in gets worse?", "What about the rear toe?"] : ["How do I test it?"];
    // The live stream as the server sends it: tokens, then done with the line already cut out.
    const body =
      `event: status\ndata: ${JSON.stringify({ phase: "thinking" })}\n\n` +
      `event: token\ndata: ${JSON.stringify({ t: reply })}\n\n` +
      `event: done\ndata: ${JSON.stringify({ reply, nextQuestions: next })}\n\n`;
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

test("the newest answer carries Other options and the Engineer's picks, and a tap sends", async ({ page }) => {
  const sent: SentBody[] = [];
  await stubChat(page, sent);
  await page.goto("/engineer");

  await ask(page, "Car is pushing mid-corner. What do I do?");
  const buttons = page.getByTestId("engineer-next-questions");
  await expect(buttons).toHaveCount(1);
  await expect(buttons.getByRole("button")).toHaveText(["Other options", "What if turn-in gets worse?", "What about the rear toe?"]);
  await expect(page.getByTestId("engineer-transcript")).not.toContainText("[[next");

  // A tap sends straight away, the button's words as the driver's message.
  await buttons.getByRole("button", { name: "What if turn-in gets worse?" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].messages?.at(-1)).toEqual({ role: "user", content: "What if turn-in gets worse?" });

  // Only the newest answer has buttons; the first answer's are gone.
  await expect(page.getByText(SECOND)).toBeVisible();
  await expect(buttons).toHaveCount(1);
  await expect(buttons.getByRole("button")).toHaveText(["Other options", "How do I test it?"]);

  // Other options sends the founder's words, and isn't offered again straight after.
  await buttons.getByRole("button", { name: "Other options" }).click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2].messages?.at(-1)).toEqual({ role: "user", content: "What are some other options I could try?" });
  await expect(buttons.getByRole("button", { name: "Other options" })).toHaveCount(0);
});
