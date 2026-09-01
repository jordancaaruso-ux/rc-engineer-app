import { test, expect } from "@playwright/test";

/**
 * The lap sheet's target row is the run you opened, and it must say so.
 *
 * It shipped reading the primary IMPORT's timestamp instead of the run's, which
 * with no on-track wall time on the timing sheet degraded to the moment the laps
 * were pasted in. A run driven in the afternoon and imported after midnight
 * showed the *next day* on the one row you cannot untick, against a list of
 * siblings all dated correctly — so the pinned target read as somebody else's
 * session (reported 2026-08-12).
 *
 * The debug preview's anchor carries exactly that shape: a primary-user import
 * with `sessionCompletedAt: null` and a `createdAt` hours after the run. The
 * assertion is a cross-check rather than a hardcoded time — the sheet header and
 * the target row describe the same run, so they must print the same instant, and
 * neither can drift without the other noticing.
 */
test("the target row wears the opened run's own clock, not its import's", async ({ page }) => {
  await page.goto("/debug/lap-times-preview");
  await expect(page.getByText("Compared with")).toBeVisible({ timeout: 60_000 });

  // "Dayne Warren · 9 Aug, 1:20 PM · 11 laps" — the run's display instant.
  const subtitle = await page.locator("#lap-analysis-modal-title + p").innerText();
  const headerWhen = subtitle.split(" · ")[1];
  expect(headerWhen, `no time in sheet subtitle: ${subtitle}`).toMatch(/\d/);

  await page.getByRole("button", { name: "Change" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose sessions to compare" });
  await expect(dialog).toBeVisible();

  /*
   * The pinned target row: name on the first line, its wall time on the second. It carried
   * a "Target" badge until 2026-08-27, when the row moved up under the dropdown that picks
   * it and the badge became a third word for the same idea — so the hook is a testid now.
   */
  const targetRow = dialog.getByTestId("lap-compare-target-row");
  await expect(targetRow).toBeVisible();
  const targetWhen = targetRow.locator("span > span").nth(1);
  await expect(targetWhen).toContainText(headerWhen);

  // Same instant again in the session dropdown above it, which names this sheet.
  await expect(page.locator("#sheet-lap-compare-target")).toHaveValue("this_sheet");
  const selected = await page
    .locator("#sheet-lap-compare-target option:checked")
    .first()
    .innerText();
  expect(selected).toContain(headerWhen);
});
