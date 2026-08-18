import { test, expect } from "@playwright/test";

/**
 * Two cars in one garage may not share a name — the API refuses it, and the Add car form says so
 * before the driver presses the button. Reported 2026-08-18: identical names could be added freely,
 * which left two rows nothing in the app could tell apart.
 */
test("the second car with the same name is refused, by the API and on the form", async ({
  page,
  request,
}) => {
  const name = "Dup guard test car";

  const first = await request.post("/api/cars", { data: { name } });
  expect(first.status(), await first.text()).toBe(201);

  // Same name, different spelling of the same name to a human.
  const second = await request.post("/api/cars", { data: { name: "  dup GUARD test   car " } });
  expect(second.status()).toBe(409);
  expect(await second.text()).toContain("already have a car called");

  await page.goto("/cars");
  await page.getByRole("button", { name: "Add car" }).first().click();
  const field = page.getByLabel("Car name");
  await field.fill(name);
  await expect(page.getByText(`You already have a car called “${name}”`)).toBeVisible();
});
