import { expect, test } from "@playwright/test";

/**
 * Creating an event must not ask for timing URLs the app can already find.
 *
 * A track row carries its own LiveRC / Speedhive address, and lap discovery works from that
 * root. The log-run wizard has hidden the per-event practice/race URL boxes on that rule for
 * a while; the Events page never got it and kept asking. Driven end to end because the whole
 * behaviour is a client-side reaction to the track picker — nothing a typecheck can see.
 *
 * Tracks are created through the real API so the rows are shared-catalog rows, same as any
 * venue someone else entered.
 *
 * Both breakpoints mount the same form and both are in the DOM at once (the desktop copy is
 * hidden by `xl:flex`), so every locator is scoped to the visible one — otherwise every query
 * is a strict-mode violation.
 */

const PRACTICE_PLACEHOLDER = "LiveRC practice session list URL";
const RACE_PLACEHOLDER = "LiveRC results / race timing page URL";

/** The open add-event form at this breakpoint — the other breakpoint's copy is in the DOM too. */
function addEventForm(page: import("@playwright/test").Page) {
  return page.locator("form:visible").filter({ hasText: "Create event" });
}

/**
 * Choose a track through the picker sheet.
 *
 * The Track field stopped being a `<select>` when the Events form joined the rest of the app
 * on the searchable sheet, so `selectOption` no longer applies. The sheet is portalled to
 * `document.body` — only the trigger lives inside the form — which is why the search box and
 * the rows are located from the page while the trigger is located from the form.
 */
async function pickTrack(
  page: import("@playwright/test").Page,
  name: string
): Promise<void> {
  await addEventForm(page).getByRole("button", { name: "Track", exact: true }).click();
  await page.getByRole("textbox", { name: "Search tracks or towns…" }).fill(name);
  await page.getByRole("option", { name: new RegExp(name) }).click();
}

async function createTrack(
  request: import("@playwright/test").APIRequestContext,
  data: { name: string; liveRcUrl?: string; speedhiveUrl?: string }
): Promise<void> {
  const res = await request.post("/api/tracks", { data: { location: "E2E", ...data } });
  expect(res.ok(), `track create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test("the two timing URL boxes appear only for a track with no timing site", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const bare = `E2E Event Bare ${stamp}`;
  const linked = `E2E Event LiveRC ${stamp}`;
  await createTrack(request, { name: bare });
  await createTrack(request, { name: linked, liveRcUrl: "https://tftr.liverc.com" });

  await page.goto("/events");
  await page.getByRole("button", { name: "New event" }).click();

  const form = addEventForm(page);
  const practice = form.getByPlaceholder(PRACTICE_PLACEHOLDER);
  const race = form.getByPlaceholder(RACE_PLACEHOLDER);

  // Before a track is chosen there is nothing to point a URL at, so neither box is offered.
  await expect(practice).toHaveCount(0);
  await expect(race).toHaveCount(0);

  // A track with no timing site still needs them — this is the only way laps ever arrive.
  await pickTrack(page, bare);
  await expect(practice).toBeVisible();
  await expect(race).toBeVisible();

  // A track that carries a LiveRC address does not: the meeting is discoverable from the root.
  await pickTrack(page, linked);
  await expect(practice).toHaveCount(0);
  await expect(race).toHaveCount(0);
  await expect(form.getByText(`Laps pull automatically from ${linked}`)).toBeVisible();
});

/**
 * Speedhive counts as a timing site even though the event-level URLs are LiveRC-only —
 * syncEventLapSources ignores anything that isn't a LiveRC index page, so on a Speedhive
 * track these boxes are dead, not merely redundant.
 */
test("a Speedhive-only track hides them too", async ({ page, request }) => {
  const name = `E2E Event Speedhive ${Date.now()}`;
  await createTrack(request, {
    name,
    speedhiveUrl: "https://speedhive.mylaps.com/practice/4591",
  });

  await page.goto("/events");
  await page.getByRole("button", { name: "New event" }).click();

  const form = addEventForm(page);
  await pickTrack(page, name);

  await expect(form.getByPlaceholder(PRACTICE_PLACEHOLDER)).toHaveCount(0);
  await expect(form.getByPlaceholder(RACE_PLACEHOLDER)).toHaveCount(0);
  await expect(form.getByText(`Laps pull automatically from ${name}`)).toBeVisible();
});
