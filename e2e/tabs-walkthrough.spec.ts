/**
 * Marketing captures of every user-facing page, for the website.
 *
 * Driven on the shared DEMO account: these are read-only views, and the demo carries a full
 * anonymised season (178 runs), so pages render real content instead of empty states. Names in the
 * demo data are fictional — scripts/dev-scrub-demo-lap-sessions.ts anonymises the imported lap
 * fields, which seed-demo-account.ts misses.
 *
 * Deliberately never sends an Engineer message — answers cost money per call. Existing threads are
 * captured as they are.
 *
 *   npx playwright test e2e/tabs-walkthrough.spec.ts --no-deps --project=mobile-chromium
 *
 * Frames land in tabs-frames/ (untracked), at 1170×2532 (390×844 CSS at 3×).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.use({
  storageState: { cookies: [], origins: [] },
  timezoneId: "Australia/Melbourne",
  // 3× rather than the project's 2×: same CSS viewport, ~2.25× the pixels.
  deviceScaleFactor: 3,
});
test.setTimeout(1_800_000);

const OUT = "tabs-frames";

type Surface = { slug: string; path: string; caption: string };

/** Pages a visitor can reach without signing in — captured before auth, since several redirect
 *  away once a session exists. */
const PUBLIC_SURFACES: Surface[] = [
  { slug: "welcome", path: "/welcome", caption: "Welcome — the public landing page." },
  { slug: "login", path: "/login", caption: "Sign in." },
  { slug: "demo-splash", path: "/demo", caption: "Demo entry — try it without an account." },
];

function signedInSurfaces(ids: Record<string, string>): Surface[] {
  const s: Surface[] = [
    { slug: "dashboard", path: "/", caption: "Dashboard — the day at a glance: pace, what changed, what to try." },
    { slug: "analysis", path: "/analysis", caption: "Analysis — the season's shape rather than a single run." },
    { slug: "roll-center", path: "/analysis/roll-center", caption: "Roll Centre Lab — geometry worked out visually." },
    { slug: "sessions", path: "/runs/history", caption: "Sessions — every run logged, filterable and comparable." },
    { slug: "log-run", path: "/runs/new", caption: "Log a run — the six-step wizard." },
    { slug: "engineer", path: "/engineer", caption: "Engineer — ask about your own car, grounded in your own runs." },
    { slug: "events", path: "/events", caption: "Events — race meetings and track days." },
    { slug: "garage", path: "/cars", caption: "Garage — the cars, and the setups behind them." },
    { slug: "setup-hub", path: "/setup", caption: "Setup — sheets, baselines and comparisons." },
    { slug: "setup-comparison", path: "/setup/comparison", caption: "Setup comparison — two setups side by side." },
    { slug: "setup-documents", path: "/setup-documents", caption: "Setup documents — uploaded sheets." },
    { slug: "setup-calibrations", path: "/setup-calibrations", caption: "Calibrations — mapping a PDF sheet to fields." },
    { slug: "chassis-types", path: "/setup-sheet-models", caption: "Chassis types — the sheet model behind each car." },
    { slug: "tracks", path: "/tracks", caption: "Tracks — the shared catalog, with layouts and timing sources." },
    { slug: "tires", path: "/tires", caption: "Tire catalog — compounds and what has been run on them." },
    { slug: "additives", path: "/additives", caption: "Additives." },
    { slug: "videos", path: "/videos", caption: "Video — onboard footage synced to lap data." },
    { slug: "video-analysis", path: "/videos/analysis", caption: "Video analysis jobs." },
    { slug: "lap-import", path: "/laps/import", caption: "Lap import — pull times from a timing site." },
    { slug: "teams", path: "/teams", caption: "Teams — shared runs and setups between teammates." },
    { slug: "settings", path: "/settings", caption: "Settings — timing identity, units, and account." },
    { slug: "billing", path: "/billing", caption: "Billing — plan and subscription." },
  ];
  if (ids.RUN_ID) s.push({ slug: "run-detail", path: `/runs/${ids.RUN_ID}`, caption: "A logged run: laps, setup, and how it felt." });
  if (ids.CAR_ID) s.push({ slug: "car-detail", path: `/cars/${ids.CAR_ID}`, caption: "A car — its setups and history." });
  if (ids.SETUP_CAR_ID && ids.SETUP_ID) {
    s.push({ slug: "setup-detail", path: `/cars/${ids.SETUP_CAR_ID}/setups/${ids.SETUP_ID}`, caption: "A saved setup, in full." });
  }
  if (ids.EVENT_ID) s.push({ slug: "event-detail", path: `/events/${ids.EVENT_ID}`, caption: "A race meeting — every run across the weekend." });
  if (ids.TRACK_ID) s.push({ slug: "track-detail", path: `/tracks/${ids.TRACK_ID}`, caption: "A track — layouts, timing source, and your history there." });
  return s;
}

test("capture every page on the demo account", async ({ page }) => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const captions: string[] = [];
  let n = 0;

  const capture = async (s: Surface) => {
    n += 1;
    const id = String(n).padStart(2, "0");
    try {
      await page.goto(s.path, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => (document.querySelector("main, body")?.textContent?.trim().length ?? 0) > 40,
        undefined,
        { timeout: 45_000 },
      );
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(2200);

      await page.screenshot({ path: `${OUT}/${id}-${s.slug}.png` });

      // Inner scrollers clip fullPage captures at the viewport; unclamp them first so a long page
      // is actually captured long. (Found on the Engineer thread view.)
      await page.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
          const cs = getComputedStyle(el);
          if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 8) {
            el.style.setProperty("height", "auto", "important");
            el.style.setProperty("max-height", "none", "important");
            el.style.setProperty("overflow", "visible", "important");
          }
        }
      });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${id}-${s.slug}-full.png`, fullPage: true });

      captions.push(`${id}. **${s.slug}** (\`${s.path}\`) — ${s.caption}`);
      console.log(`  ${id} ${s.slug.padEnd(20)} ok`);
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      captions.push(`${id}. **${s.slug}** (\`${s.path}\`) — CAPTURE FAILED: ${msg}`);
      console.log(`  ${id} ${s.slug.padEnd(20)} FAILED — ${msg}`);
      await page.screenshot({ path: `${OUT}/${id}-${s.slug}-FAILED.png` }).catch(() => {});
    }
  };

  // ── Public pages, before any session exists ────────────────────────────────
  for (const s of PUBLIC_SURFACES) await capture(s);

  // ── Sign in as the demo account ────────────────────────────────────────────
  const out = execFileSync(
    "npx",
    ["dotenv-cli", "-e", ".env.local", "--", "node", "--conditions=react-server", "--import", "tsx",
      "scripts/dev-demo-signin.ts"],
    { encoding: "utf8", shell: true, timeout: 120_000 },
  );
  const dbHost = out.match(/Database:\s*(\S+)/)?.[1] ?? "(unknown)";
  if (/ep-hidden-rice/.test(dbHost)) throw new Error(`REFUSING: pointed at PRODUCTION (${dbHost})`);
  const signInUrl = out.match(/https?:\/\/\S*callback\/nodemailer\S+/)?.[0];
  if (!signInUrl) throw new Error("no sign-in URL:\n" + out);

  const ids: Record<string, string> = {};
  for (const m of out.matchAll(/^([A-Z_]+_ID)=(\S*)$/gm)) if (m[2]) ids[m[1]] = m[2];
  console.log("  ids: " + JSON.stringify(ids));

  await page.context().addCookies([
    { name: "rc_tz", value: "Australia/Melbourne", domain: "localhost", path: "/" },
  ]);
  await page.goto(signInUrl);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });

  for (const s of signedInSurfaces(ids)) await capture(s);

  // An open Engineer thread — the list shows the feature exists, the answer is the pitch.
  n += 1;
  const threadId = String(n).padStart(2, "0");
  try {
    await page.goto("/engineer", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const entry = page.locator("main button").filter({ hasText: /weekend|rotation|turn my car/i });
    if (await entry.count()) {
      await entry.first().click();
      await page.waitForFunction(
        () => (document.querySelector("main")?.textContent?.trim().length ?? 0) > 400,
        undefined,
        { timeout: 45_000 },
      );
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${OUT}/${threadId}-engineer-thread.png` });
      await page.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
          const cs = getComputedStyle(el);
          if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 8) {
            el.style.setProperty("height", "auto", "important");
            el.style.setProperty("max-height", "none", "important");
            el.style.setProperty("overflow", "visible", "important");
          }
        }
      });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/${threadId}-engineer-thread-full.png`, fullPage: true });
      captions.push(`${threadId}. **engineer-thread** — An answer in full: the Engineer reasoning about this car, citing its actual setup against the community.`);
      console.log(`  ${threadId} engineer-thread      ok`);
    } else {
      console.log(`  ${threadId} engineer-thread      NO THREAD FOUND`);
    }
  } catch (e) {
    console.log(`  ${threadId} engineer-thread      FAILED — ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }

  writeFileSync(
    `${OUT}/pages.md`,
    [
      "# Every page — walkthrough captures",
      "",
      "Captured on the shared demo account (178 runs of real season data, fully anonymised — every",
      "driver name in this data is fictional). Phone viewport 390×844 at 3×, so files are",
      "1170×2532. `-full` variants are the same screen at full scroll height.",
      "",
      "The first three are public pages, captured with no session. Everything after is signed in.",
      "",
      ...captions,
      "",
    ].join("\n"),
    "utf8",
  );
});
