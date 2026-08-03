import { expect, test } from "@playwright/test";

/**
 * The sequential setup fill parks its answers on the server as you go, and can be saved from any
 * question.
 *
 * This is driven end to end rather than against a preview page because the whole feature *is* the
 * round trip: what makes it worth having is that a real row survives a real reload. Stubbing the
 * fetch would test nothing that was broken.
 *
 * The suite's account is minted fresh and empty (see `auth.setup.ts`), so this makes its own car.
 * A car with no chassis gets `getDefaultSetupSheetTemplate()`, which is enough questions to walk.
 */

/** Answer the current question and move on. Works for text/number steps, which the default sheet leads with. */
async function answerAndAdvance(page: import("@playwright/test").Page, value: string) {
  const input = page.locator('input[enterkeyhint="next"]');
  await expect(input).toBeVisible();
  await input.fill(value);
  await page.getByRole("button", { name: /^(Next|Done)$/ }).click();
}

async function createCar(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const res = await request.post("/api/cars", {
    data: { name: `Draft spec car ${Date.now()}` },
  });
  expect(res.ok(), `car create failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { car?: { id: string }; id?: string };
  const id = body.car?.id ?? body.id;
  expect(id, "car create returned no id").toBeTruthy();
  return id as string;
}

test("a part-way fill survives a reload and can be resumed", async ({ page, request }) => {
  const carId = await createCar(request);

  await page.goto(`/cars/${carId}/setups/new`);
  await page.getByText("Start empty", { exact: true }).click();
  await page.getByRole("button", { name: "Start filling" }).click();

  await answerAndAdvance(page, "5.5");
  await answerAndAdvance(page, "6.0");
  await answerAndAdvance(page, "3.2");

  // Leave the fourth question half-typed — the case that used to lose keystrokes outright.
  const input = page.locator('input[enterkeyhint="next"]');
  await expect(input).toBeVisible();
  await input.fill("2.7-b");

  // The autosave is debounced; the pill is the honest signal that the row landed.
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.goto(`/cars/${carId}/setups/new`);
  await expect(page.getByText("Draft in progress")).toBeVisible();
  // Four, not three: half-typed text is persisted as a real value too, so locking the phone
  // mid-question keeps it. It's only *also* stored as `pendingText` so the input restores it.
  await expect(page.getByText(/4 of \d+ filled/)).toBeVisible();

  await page.getByRole("button", { name: "Resume" }).click();
  // Back on question 4, with the half-typed value still in the box.
  await expect(page.locator('input[enterkeyhint="next"]')).toHaveValue("2.7-b");
  await expect(page.getByText(/^4\/\d+$/)).toBeVisible();
});

test("Save & exit promotes the draft and clears the resume card", async ({ page, request }) => {
  const carId = await createCar(request);

  await page.goto(`/cars/${carId}/setups/new`);
  await page.getByText("Start empty", { exact: true }).click();
  await page.getByRole("button", { name: "Start filling" }).click();

  await answerAndAdvance(page, "5.5");
  await answerAndAdvance(page, "6.0");

  await page.getByRole("button", { name: "Save & exit" }).click();
  await expect(page).toHaveURL(new RegExp(`/cars/${carId}/setups/[^/]+$`));

  // The draft is deleted in the same transaction as the create, so the card must be gone.
  await page.goto(`/cars/${carId}/setups/new`);
  await expect(page.getByText("Draft in progress")).toHaveCount(0);
});

test("backing out asks, and Discard throws the draft away", async ({ page, request }) => {
  const carId = await createCar(request);

  await page.goto(`/cars/${carId}/setups/new`);
  await page.getByText("Start empty", { exact: true }).click();
  await page.getByRole("button", { name: "Start filling" }).click();

  await answerAndAdvance(page, "5.5");
  await answerAndAdvance(page, "6.0");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Cancel" }).click();
  const dialog = page.getByRole("dialog", { name: "Leave this fill?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Save draft & exit/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Keep filling/ })).toBeVisible();

  await dialog.getByRole("button", { name: /^Discard/ }).click();

  await page.goto(`/cars/${carId}/setups/new`);
  await expect(page.getByText("Draft in progress")).toHaveCount(0);
});
