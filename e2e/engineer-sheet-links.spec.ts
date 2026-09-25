import { expect, test } from "@playwright/test";

/**
 * Run: `npm run test:engineer-sheet-links`
 *
 * Setup-change links (founder design 2026-09-24, built 2026-09-25): on a sheet the app cannot read,
 * the Engineer's words about a change it cannot identify are a link; a tap opens the changed boxes,
 * one "What is it?" box per change, and "Tell the Engineer" sends the names as the driver's next
 * message and saves them to the car. Every route is faked — the chat stream, the two runs' changes and
 * the save — so this costs no LLM call and needs no car on the test account.
 */

type SentBody = { messages?: Array<{ role: string; content: string }> };

const LINKED = "Two changes I can't identify";
const FIRST = `Your quickest run was 14:20. [${LINKED}](#sheet-abc123) came before the 14:06 gain.`;
const LINKS = { "sheet-abc123": { runId: "run-two", sinceRunId: "run-one" } };

async function stubRoutes(page: import("@playwright/test").Page, sent: SentBody[], saved: unknown[]) {
  await page.route("**/api/engineer/chat", async (route) => {
    sent.push(route.request().postDataJSON() as SentBody);
    const first = sent.length === 1;
    const reply = first ? FIRST : "Stiffer at the front, then. That brought the steering in sooner.";
    // As the server sends it: the links before the first word, then the words, then done.
    const body =
      (first ? `event: links\ndata: ${JSON.stringify({ links: LINKS })}\n\n` : "") +
      `event: status\ndata: ${JSON.stringify({ phase: "thinking" })}\n\n` +
      `event: token\ndata: ${JSON.stringify({ t: reply })}\n\n` +
      `event: done\ndata: ${JSON.stringify({ reply, nextQuestions: [], sheetLinks: first ? LINKS : {} })}\n\n`;
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body });
  });
  await page.route("**/api/runs/run-two/sheet-changes?since=run-one", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        // A chassis with no sheet picture: the list and the names are the whole of it.
        sheetMode: false,
        setupSheetModelId: null,
        editionBlankId: null,
        carId: "car-x4",
        sameDay: true,
        after: { runId: "run-two", clock: "14:06", day: "Wed 24 Sep", values: {} },
        before: { runId: "run-one", clock: "13:51", day: "Wed 24 Sep", values: {} },
        changes: [
          { key: "pinion", number: 1, pageNumber: 1, before: "38", after: "39", known: "pinion", savedName: null },
          { key: "text20", number: 2, pageNumber: 1, before: "1.2", after: "1.4", known: null, savedName: "front roll bar" },
          { key: "text34", number: 3, pageNumber: 1, before: "C=2.3", after: "C=2.5", known: null, savedName: null },
        ],
      }),
    });
  });
  await page.route("**/api/cars/car-x4/sheet-box-names", async (route) => {
    saved.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
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

test("a linked change opens its boxes, and the names go back to the Engineer and onto the car", async ({ page }) => {
  const sent: SentBody[] = [];
  const saved: unknown[] = [];
  await stubRoutes(page, sent, saved);
  await page.goto("/engineer");

  await ask(page, "What setup changes worked best today?");
  const transcript = page.getByTestId("engineer-transcript");
  const link = transcript.locator("[data-sheet-link]");
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText(LINKED);
  await expect(transcript).not.toContainText("#sheet");

  await link.click();
  const sheet = page.getByTestId("engineer-sheet-changes");
  await expect(sheet.getByRole("heading")).toHaveText("3 changes before your 14:06 run");
  // The box the Engineer reads is listed by its name, with nothing to type.
  await expect(sheet.getByText("38 → 39")).toBeVisible();
  await expect(sheet.getByText("· pinion")).toBeVisible();
  const names = sheet.getByPlaceholder("What is it? e.g. front roll bar");
  await expect(names).toHaveCount(2);
  // A box this driver named on this car before comes back filled in.
  await expect(names.nth(0)).toHaveValue("front roll bar");
  await names.nth(1).fill("front spring");

  await sheet.getByRole("button", { name: "Tell the Engineer" }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].messages?.at(-1)).toEqual({
    role: "user",
    content: "Before my 14:06 run I changed the pinion 38 → 39, the front roll bar 1.2 → 1.4 and the front spring C=2.3 → C=2.5.",
  });
  // Only the name that is new is saved; the one it already had is not sent again.
  expect(saved).toEqual([{ names: { text34: "front spring" } }]);
});
