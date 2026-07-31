import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test as setup } from "@playwright/test";

const STATE = "e2e/.auth/state.json";

/**
 * Mint a throwaway account and sign in through the real magic-link callback.
 *
 * Deliberately not stubbing auth: this is the one gate that can't be faked, and running it
 * every suite means a broken sign-in fails loudly instead of silently at 6am. The script is
 * the same one `test-onboarding` uses; it needs --conditions=react-server because the module
 * graph reaches `server-only` via perfStore.
 */
setup("authenticate as a fresh account", async ({ page }) => {
  const out = execFileSync(
    "npx",
    [
      "dotenv-cli",
      "-e",
      ".env.local",
      "--",
      "node",
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/dev-fresh-onboarding.ts",
    ],
    { encoding: "utf8", shell: true, timeout: 180_000 },
  );

  const dbHost = out.match(/Database:\s*(\S+)/)?.[1] ?? "(unknown)";
  const signInUrl = out.match(/https?:\/\/\S*callback\/nodemailer\S+/)?.[0];

  // Loud guard: a suite that quietly points at production is worse than no suite.
  if (/ep-hidden-rice/.test(dbHost)) {
    throw new Error(`REFUSING TO RUN: mint script targeted PRODUCTION (${dbHost})`);
  }
  console.log(`  auth: minted on ${dbHost}`);

  if (!signInUrl) throw new Error(`no sign-in URL in mint output:\n${out}`);

  await page.goto(signInUrl);
  // Landing anywhere other than /login means the token was accepted.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });

  if (!existsSync(dirname(STATE))) mkdirSync(dirname(STATE), { recursive: true });
  await page.context().storageState({ path: STATE });
});
