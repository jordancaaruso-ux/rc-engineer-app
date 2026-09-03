import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * When a meeting runs is one question, asked once.
 *
 * A club race is one day and a big meeting is a weekend, and the old pair of `<input type="date">`
 * made the driver answer that twice — spin a wheel for a start date, then spin it again for an end
 * date that is usually the same day (founder 2026-09-03). One tap is now a one-day event and a
 * second tap stretches it into a range.
 *
 * Driven end to end because all of it is client behaviour: which tap means what, how two taps sort
 * themselves into start and end, and what the closed field says afterwards. None of it is visible
 * to a typecheck, and the last assertion is the one that matters — the dates the driver tapped are
 * the dates the event is created with.
 */

/** Day cells are labelled "Thursday, 3 September 2026"; `\b` stops 3 from also matching 13 and 23. */
function dayCell(sheet: Locator, day: number): Locator {
  return sheet
    .getByRole("button", { name: new RegExp(String.raw`\b${day} \w+ \d{4}$`) })
    .first();
}

function dateSheet(page: Page): Locator {
  return page.locator('[role=dialog][aria-label="Dates"]');
}

/**
 * Open the add-event form with the picker parked on a month that is entirely ahead of today.
 * Days 3 to 20 then exist whatever today is, and nothing collides with the "today" ring.
 */
async function openPickerOnNextMonth(page: Page): Promise<Locator> {
  await page.goto("/events");
  await page.getByRole("button", { name: /New event/i }).first().click();
  await page.getByRole("button", { name: "Dates" }).first().click();
  const sheet = dateSheet(page);
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Next month" }).click();
  return sheet;
}

test("one tap is a one-day meeting, and a second tap makes it a range", async ({ page }) => {
  const sheet = await openPickerOnNextMonth(page);

  await dayCell(sheet, 3).click();
  await expect(sheet.getByText(/^3 \w+ \d{4}$/)).toBeVisible();
  // A single day is a complete answer — no day count, because there is only one.
  await expect(sheet.getByText(/days$/)).toHaveCount(0);

  await dayCell(sheet, 7).click();
  await expect(sheet.getByText(/^3 – 7 \w+ \d{4}$/)).toBeVisible();
  await expect(sheet.getByText("· 5 days")).toBeVisible();

  // And the closed field carries the answer, so the form reads back without reopening.
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Dates" }).first()).toContainText(
    /^3 – 7 \w+ \d{4}$/
  );
});

/**
 * The old pair could be filled in the wrong order, which is why both forms carried an "End date
 * must be on or after the start date" warning. Two taps cannot produce that — whichever is earlier
 * is the start — so the warning has no state left to describe and is gone.
 */
test("tapping an earlier day second still reads start to end", async ({ page }) => {
  const sheet = await openPickerOnNextMonth(page);

  await dayCell(sheet, 20).click();
  await dayCell(sheet, 12).click();

  await expect(sheet.getByText(/^12 – 20 \w+ \d{4}$/)).toBeVisible();
  await expect(page.getByText(/End date must be on or after/)).toHaveCount(0);
});

/** A third tap starts a new meeting rather than nudging an end of the one already settled. */
test("a third tap starts over", async ({ page }) => {
  const sheet = await openPickerOnNextMonth(page);

  await dayCell(sheet, 3).click();
  await dayCell(sheet, 7).click();
  await dayCell(sheet, 15).click();

  await expect(sheet.getByText(/^15 \w+ \d{4}$/)).toBeVisible();
  await expect(sheet.getByText(/–/)).toHaveCount(0);
});

test("the range that was tapped is the range the event is created with", async ({
  page,
  request,
}) => {
  const trackName = `E2E Dates ${Date.now()}`;
  const trackRes = await request.post("/api/tracks", {
    data: { name: trackName, location: "E2E" },
  });
  expect(trackRes.ok(), `track create failed: ${trackRes.status()}`).toBeTruthy();

  const eventName = `E2E Date Range ${Date.now()}`;
  const sheet = await openPickerOnNextMonth(page);
  await dayCell(sheet, 3).click();
  await dayCell(sheet, 7).click();
  await sheet.getByRole("button", { name: "Done" }).click();

  const form = page.locator("form:visible").filter({ hasText: "Create event" });
  await form.getByPlaceholder(/BRCA Nationals/i).fill(eventName);
  await form.getByRole("button", { name: "Track", exact: true }).click();
  await page.getByRole("textbox", { name: "Search tracks or towns…" }).fill(trackName);
  await page.getByRole("option", { name: new RegExp(trackName) }).click();
  await form.getByRole("button", { name: "Create event" }).click();

  /*
   * Read back from the API rather than the list. This asserts what was *stored*, so it cannot
   * pass on a list that formats the wrong pair of dates nicely — and it dodges the two copies
   * of this form the page mounts for the two breakpoints.
   */
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const ym = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;

  await expect
    .poll(
      async () => {
        const listed = await request.get("/api/events");
        const body = (await listed.json()) as {
          events?: Array<{ name: string; startDate: string; endDate: string }>;
        };
        const saved = body.events?.find((e) => e.name === eventName);
        if (!saved) return null;
        return `${saved.startDate.slice(0, 10)}..${saved.endDate.slice(0, 10)}`;
      },
      { timeout: 15_000, message: "created event never appeared with the tapped dates" }
    )
    .toBe(`${ym}-03..${ym}-07`);
});
