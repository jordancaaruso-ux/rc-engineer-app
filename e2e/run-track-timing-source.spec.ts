import { expect, test } from "@playwright/test";

/**
 * Logging a run must say whether the selected track has a timing site to search, and take the
 * URL on the spot when it doesn't.
 *
 * Tracks are a shared catalog, so the common case is logging at a venue someone else entered —
 * and a track row with no LiveRC/Speedhive URL searched nothing while looking identical to a
 * scan that came back empty. Driven end to end because the whole point is the round trip: the
 * URL is saved against a real (shared) track row and discovery re-points at it without leaving
 * the half-filled run.
 *
 * `?wizard=0` forces the classic single-page form so the lap panel is on screen without walking
 * the wizard — the panel is the same component in both.
 */

async function createTrackWithoutTiming(
  request: import("@playwright/test").APIRequestContext,
  name: string
): Promise<string> {
  const res = await request.post("/api/tracks", { data: { name, location: "E2E" } });
  expect(res.ok(), `track create failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { track?: { id: string } };
  expect(body.track?.id, "track create returned no id").toBeTruthy();
  return body.track!.id;
}

test("a track with no timing site says so, and takes the URL inline", async ({ page, request }) => {
  const name = `E2E Timing Gap ${Date.now()}`;
  await createTrackWithoutTiming(request, name);

  await page.goto("/runs/new?wizard=0");

  await page.getByRole("tab", { name: "Show Track" }).click();
  await page.getByRole("button", { name: "Track", exact: true }).click();
  await page.getByRole("textbox", { name: "Search tracks or towns…" }).fill(name);
  await page.getByRole("option", { name: new RegExp(name) }).click();

  // The state that used to read as a broken scan.
  await expect(page.getByText(`No timing site saved for ${name}`)).toBeVisible();

  await page
    .getByRole("textbox", { name: `Timing site URL for ${name}` })
    .fill("https://tftr.liverc.com");
  await page.getByRole("button", { name: "Save timing site" }).click();

  // Saved against the shared track row, and discovery now names what it searches.
  await expect(page.getByText(`Searching ${name} on LiveRC (tftr.liverc.com).`)).toBeVisible();
});

/**
 * The earlier ask: a track created mid-run now takes its timing page at creation, so the
 * driver never reaches the "No timing site saved" state at all. Asserted without a reload,
 * because the value of asking early is that discovery is already pointed somewhere by the
 * time they scroll down to the lap panel.
 */
test("a track created mid-run takes its timing page there and then", async ({ page }) => {
  const name = `E2E Timing At Birth ${Date.now()}`;

  await page.goto("/runs/new?wizard=0");

  await page.getByRole("tab", { name: "Show Track" }).click();
  await page.getByRole("button", { name: "New track" }).click();
  await page.getByPlaceholder("Track name").fill(name);
  await page.getByLabel("Timing pages — optional").fill("tftr.liverc.com");
  await page.getByRole("button", { name: "Add track" }).click();

  await expect(page.getByText(`Searching ${name} on LiveRC (tftr.liverc.com).`)).toBeVisible();
  await expect(page.getByText(`No timing site saved for ${name}`)).toHaveCount(0);
});

/**
 * A track holds one LiveRC slot and one Speedhive slot, and discovery searches both. The
 * split that makes both worth having is practice on Speedhive, race weekends on LiveRC —
 * so the box has to keep taking pastes rather than stopping at the first one.
 */
test("both timing pages can be added at once, and both get searched", async ({ page }) => {
  const name = `E2E Timing Both ${Date.now()}`;

  await page.goto("/runs/new?wizard=0");

  await page.getByRole("tab", { name: "Show Track" }).click();
  await page.getByRole("button", { name: "New track" }).click();
  await page.getByPlaceholder("Track name").fill(name);

  const timing = page.getByLabel("Timing pages — optional");
  await timing.fill("tftr.liverc.com");
  await timing.press("Enter");
  // First paste becomes a chip, and the box stays open for the second.
  await expect(page.getByText("tftr.liverc.com", { exact: true })).toBeVisible();

  await page.getByPlaceholder("Paste another timing page").fill("speedhive.mylaps.com/practice/4591");
  await page.getByRole("button", { name: "Add track" }).click();

  await expect(
    page.getByText(`Searching ${name} on LiveRC (tftr.liverc.com) and Speedhive.`)
  ).toBeVisible();
});

test("a bad timing page is caught in the row, before the track is created", async ({ page }) => {
  const name = `E2E Timing Typo ${Date.now()}`;

  await page.goto("/runs/new?wizard=0");

  await page.getByRole("tab", { name: "Show Track" }).click();
  await page.getByRole("button", { name: "New track" }).click();
  await page.getByPlaceholder("Track name").fill(name);
  await page.getByLabel("Timing pages — optional").fill("https://example.com/results");
  await page.getByRole("button", { name: "Add track" }).click();

  // Scoped to the row's own alert — Next's route announcer is also role="alert".
  await expect(page.locator("p[role=alert]")).toContainText(/LiveRC or Speedhive/i);
  // Still in the row, nothing saved — the name field is untouched and ready to retry.
  await expect(page.getByPlaceholder("Track name")).toHaveValue(name);
});
