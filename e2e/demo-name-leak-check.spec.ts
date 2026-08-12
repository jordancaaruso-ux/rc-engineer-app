/**
 * Guard: no real person's name may render on the demo account.
 *
 * The demo is public (/demo) and its screenshots go on the website, so a real name leaking through
 * is both a privacy problem and unusable as marketing. seed-demo-account.ts scrubs runs, setups and
 * threads but missed ImportedLapTimeSession — the imported lap fields carried the founder's name
 * and the full field of real racers from real club meetings.
 *
 * This walks the same pages the capture spec shoots and fails on any real name in the rendered
 * text. Keep it passing before publishing anything.
 *
 *   npx playwright test e2e/demo-name-leak-check.spec.ts --no-deps --project=mobile-chromium
 */
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: "Australia/Melbourne" });
test.setTimeout(900_000);

/** Real names that were present in the source data before anonymisation. */
const REAL_NAMES = [
  "Jordan", "Caruso", "jordancaaruso",
  "Ziebart", "Ilievski", "Budge", "Kalfoglou", "Peet", "Webster", "Cristian Silva",
  "Langan", "Calwell", "Oberstar", "Tran", "Beckett", "Marshall", "Withers", "Muffett",
  "Camilleri", "Spiers", "Boundy", "Hilyear", "De Nardis", "Moylan", "Vergunst",
];

const PAGES = [
  "/", "/analysis", "/runs/history", "/engineer", "/events", "/cars", "/setup",
  "/setup/comparison", "/tracks", "/tires", "/videos", "/teams", "/settings", "/laps/import",
];

test("no real names render anywhere on the demo account", async ({ page }) => {
  // The demo walkthrough auto-starts for this account and would dim every page it walks. It
  // does not hide text from `innerText`, so this spec would still pass — but a scrim over
  // fourteen pages makes any failure impossible to read. Mark it done before the first load.
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("jrc-demo-tour", JSON.stringify({ status: "done", stepIndex: 0 }));
    } catch {
      /* storage blocked — the tour degrades to in-memory and will show; harmless here */
    }
  });

  const out = execFileSync(
    "npx",
    ["dotenv-cli", "-e", ".env.local", "--", "node", "--conditions=react-server", "--import", "tsx",
      "scripts/dev-demo-signin.ts"],
    { encoding: "utf8", shell: true, timeout: 120_000 },
  );
  const signInUrl = out.match(/https?:\/\/\S*callback\/nodemailer\S+/)?.[0];
  if (!signInUrl) throw new Error("no sign-in URL:\n" + out);
  const ids: Record<string, string> = {};
  for (const m of out.matchAll(/^([A-Z_]+_ID)=(\S*)$/gm)) if (m[2]) ids[m[1]] = m[2];

  await page.goto(signInUrl);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });

  const targets = [...PAGES];
  if (ids.RUN_ID) targets.push(`/runs/${ids.RUN_ID}`);
  if (ids.CAR_ID) targets.push(`/cars/${ids.CAR_ID}`);
  if (ids.EVENT_ID) targets.push(`/events/${ids.EVENT_ID}`);
  if (ids.TRACK_ID) targets.push(`/tracks/${ids.TRACK_ID}`);

  const leaks: string[] = [];
  for (const path of targets) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
    const text = (await page.locator("body").innerText().catch(() => "")) || "";
    for (const name of REAL_NAMES) {
      if (new RegExp(`\\b${name}\\b`, "i").test(text)) {
        leaks.push(`${path} → "${name}"`);
      }
    }
    console.log(`  checked ${path}`);
  }

  if (leaks.length) console.log("\nLEAKS:\n" + leaks.map((l) => "  " + l).join("\n"));
  expect(leaks, `real names rendered on the demo account:\n${leaks.join("\n")}`).toEqual([]);
});
