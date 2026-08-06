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
