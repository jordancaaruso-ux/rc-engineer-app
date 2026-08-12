/**
 * The Appearance switch, driven the way a person drives it.
 *
 * Covers the two things that are easy to get wrong and invisible in a screenshot:
 * the choice has to survive a navigation (it is a cookie, not component state), and
 * the server has to be the one stamping `data-theme` on the very first byte — if the
 * client were doing it, every page load would flash charcoal before the paper landed.
 *
 *   npx playwright test e2e/theme-switch.spec.ts --no-deps --project=mobile-chromium
 */
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(600_000);

test("choosing Light persists across navigation and is stamped server-side", async ({ page }) => {
  const out = execFileSync(
    "npx",
    [
      "dotenv-cli", "-e", ".env.local", "--", "node", "--conditions=react-server",
      "--import", "tsx", "scripts/dev-demo-signin.ts",
    ],
    { encoding: "utf8", shell: true, timeout: 180_000 },
  );
  const dbHost = out.match(/Database:\s*(\S+)/)?.[1] ?? "(unknown)";
  if (/ep-hidden-rice/.test(dbHost)) throw new Error(`REFUSING: pointed at PRODUCTION (${dbHost})`);
  const signInUrl = out.match(/https?:\/\/\S*callback\/nodemailer\S+/)?.[0];
  if (!signInUrl) throw new Error("no sign-in URL:\n" + out);

  await page.goto(signInUrl);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });

  // Default: nobody's app changes colour on its own.
  await page.goto("/settings");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const group = page.getByRole("radiogroup", { name: "Theme" });
  await expect(group.getByRole("radio", { name: /Dark/ })).toHaveAttribute("aria-checked", "true");

  // Switching repaints immediately, without a reload.
  await group.getByRole("radio", { name: /Light/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("radio", { name: /Light/ })).toHaveAttribute("aria-checked", "true");

  // The browser chrome follows too, or the toolbar sits charcoal above a paper page.
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#EAE7E0");

  // It is a cookie, so it survives a navigation to a page that never saw the click…
  await page.goto("/runs/history");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // …and, crucially, it arrives in the HTML rather than being applied by script.
  // Fetching the markup directly proves there is no flash: no JS has run at all here.
  const html = await page.request.get("/analysis").then((r) => r.text());
  expect(html).toContain('data-theme="light"');

  // And back again.
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: /Dark/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
