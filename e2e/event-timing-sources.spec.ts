import { expect, test } from "@playwright/test";

/**
 * The event page shows one card, and the timing settings survive behind it.
 *
 * There used to be a second "LiveRC lap detection" card here carrying a diagnostic button,
 * watermark tables and a Raw JSON dump — developer plumbing in front of paying drivers. It is
 * gone, but two of the three settings it held are reachable nowhere else and the third,
 * race class, is the only switch that turns on race-result detection at all
 * (`syncEventLapSources` skips race entirely when it is empty). Deleting the card without
 * rehoming them would have silently made every meeting practice-only.
 *
 * So this asserts both halves: the debug surface is really gone, and the settings really save.
 * Driven end to end because the disclosure, the shared Save button and the PATCH round trip
 * are all client behaviour a typecheck cannot see.
 */
test("timing sources save from the folded-away row, and the debug card is gone", async ({
  page,
  request,
}) => {
  const tracksRes = await request.get("/api/tracks");
  const tracks = (await tracksRes.json()) as { tracks?: Array<{ id: string }> };
  const trackId = tracks.tracks?.[0]?.id;
  expect(trackId, "catalog needs at least one track").toBeTruthy();

  const created = await request.post("/api/events", {
    data: {
      name: `E2E Timing sources ${Date.now()}`,
      trackId,
      startDate: "2026-08-18",
      endDate: "2026-08-19",
    },
  });
  expect(created.ok(), `event create failed: ${created.status()}`).toBeTruthy();
  const eventId = ((await created.json()) as { event: { id: string } }).event.id;

  await page.goto(`/events/${eventId}`);

  await expect(page.getByText("LiveRC lap detection")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /diagnostic/i })).toHaveCount(0);

  // Closed by default — the point of the rework is that the page reads as one card.
  const raceClass = page.getByLabel("Race class");
  await expect(raceClass).toBeHidden();

  await page.getByText("Timing sources (advanced)").click();
  await expect(raceClass).toBeVisible();
  await raceClass.fill("17.5 Stock Buggy");

  // Unique per run: a results URL already on this track merges the two events instead of
  // saving, which is correct behaviour and would make a fixed URL fail on the second run.
  const resultsUrl = `https://tftr.liverc.com/results/?p=view_event&id=${eventId}`;
  await page.getByLabel("Results URL").fill(resultsUrl);

  // One Save button for the whole card, timing sources included.
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await page.getByText("Timing sources (advanced)").click();
  await expect(page.getByLabel("Race class")).toHaveValue("17.5 Stock Buggy");
  await expect(page.getByLabel("Results URL")).toHaveValue(resultsUrl);
});

/**
 * Native date pickers size to their own content and a grid item is `min-width: auto`, so the
 * date boxes could push out past the card edge on a phone. 390px is the review width.
 */
test("nothing overflows the page at 390px", async ({ page, request }) => {
  const tracks = (await (await request.get("/api/tracks")).json()) as {
    tracks?: Array<{ id: string }>;
  };
  const created = await request.post("/api/events", {
    data: {
      name: `E2E Width ${Date.now()}`,
      trackId: tracks.tracks?.[0]?.id,
      startDate: "2026-08-18",
      endDate: "2026-08-19",
    },
  });
  const eventId = ((await created.json()) as { event: { id: string } }).event.id;

  await page.goto(`/events/${eventId}`);
  const doc = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);
});
