/**
 * Marketing walkthrough — logs one complete run from a standing start, capturing a numbered frame
 * at every step and (optionally) a paced screen recording. Not a test: it asserts only enough to
 * fail loudly when it would otherwise record a misleading screen.
 *
 * Deliberately NO prior runs on the account (founder 2026-08-05), so there is no prefill offer and
 * every field is chosen on camera. The point being demonstrated is that it looks easy *while still
 * filling the whole sheet* — which is why the saved setup matters: one tap, ~70 parameters.
 *
 * The one staged element: LiveRC has no sessions at TFTR today, so the scan response is rewritten
 * to present the founder's REAL 3 Aug session as today's. Only the date moves — the session URL,
 * driver match and every lap time are fetched live from tftr.liverc.com by the app itself.
 *
 *   # frames only (fast)
 *   npx playwright test e2e/walkthrough.spec.ts --no-deps --project=mobile-chromium
 *   # frames + paced video, then convert with scripts/walkthrough-video.sh
 *   WALKTHROUGH_VIDEO=1 npx playwright test e2e/walkthrough.spec.ts --no-deps --project=mobile-chromium
 *
 * Frames land in walkthrough-frames/ (untracked).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Video mode paces interactions for a human viewer. Kept deliberately tight (founder: "much
 * quicker") — long enough to follow, short enough to feel effortless.
 */
const VIDEO = process.env.WALKTHROUGH_VIDEO === "1";

test.use({
  storageState: { cookies: [], origins: [] },
  timezoneId: "Australia/Melbourne",
  // 3× rather than the project's 2×: the CSS viewport stays 390×844 (so layout is identical) but
  // everything renders at 1170×2532 physical pixels. Playwright's VP8 screencast is the soft link
  // in the chain, and resolution is the one lever that meaningfully sharpens it.
  deviceScaleFactor: 3,
  video: VIDEO ? { mode: "on", size: { width: 1170, height: 2532 } } : "off",
});
test.setTimeout(600_000);

const OUT = "walkthrough-frames";
const captions: string[] = [];
let frameNo = 0;
let signInUrl = "";

test.beforeAll(() => {
  const out = execFileSync(
    "npx",
    ["dotenv-cli", "-e", ".env.local", "--", "node", "--conditions=react-server", "--import", "tsx",
      "scripts/dev-seed-walkthrough.ts"],
    { encoding: "utf8", shell: true, timeout: 180_000 },
  );
  const dbHost = out.match(/Database:\s*(\S+)/)?.[1] ?? "(unknown)";
  if (/ep-hidden-rice/.test(dbHost)) throw new Error(`REFUSING: seeded against PRODUCTION (${dbHost})`);
  signInUrl = out.match(/https?:\/\/\S*callback\/nodemailer\S+/)?.[0] ?? "";
  if (!signInUrl) throw new Error("no sign-in URL:\n" + out);
});

test("log a complete run from scratch, capturing every step", async ({ page }) => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const beat = (ms: number) => page.waitForTimeout(VIDEO ? ms : Math.min(ms, 200));

  const shot = async (name: string, caption: string, opts?: { full?: boolean }) => {
    frameNo += 1;
    const id = String(frameNo).padStart(2, "0");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${id}-${name}.png` });
    if (opts?.full) await page.screenshot({ path: `${OUT}/${id}-${name}-full.png`, fullPage: true });
    captions.push(`${id}. **${name}** — ${caption}`);
    console.log(`  frame ${id}: ${name}`);
  };

  // Pickers render in a portal outside <main>, so those dumps need the whole body. Guarded: a
  // locator that never resolves would otherwise block until the test timeout.
  const dump = async (label: string, sel = "main") => {
    console.log(`\n===== ${label} =====`);
    try {
      const snap = await page.locator(sel).first().ariaSnapshot({ timeout: 5000 });
      console.log(snap.slice(0, 3500));
    } catch {
      console.log(`(no "${sel}" within 5s)`);
    }
  };

  // Present the real 3 Aug session as today's. Nothing but the timestamp is altered.
  await page.route("**/api/laps/scan-day-url", async (route) => {
    const res = await route.fetch();
    const json = await res.json().catch(() => null);
    const older = json?.olderCandidates ?? [];
    if (json && older.length) {
      const promoted = older.map((c: Record<string, unknown>) => {
        const shifted = new Date(String(c.sessionCompletedAtIso));
        const now = new Date();
        shifted.setUTCFullYear(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        return { ...c, sessionCompletedAtIso: shifted.toISOString() };
      });
      json.candidates = promoted;
      json.olderCandidates = [];
      json.olderCount = 0;
      json.totalCandidates = promoted.length;
      json.unimportedCount = promoted.length;
      json.matchedCount = promoted.length;
    }
    await route.fulfill({ response: res, json: json ?? undefined });
  });

  await page.context().addCookies([
    { name: "rc_tz", value: "Australia/Melbourne", domain: "localhost", path: "/" },
  ]);
  await page.goto(signInUrl);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  // A brand-new account can land on the welcome overlay; clear it so the recording starts on the app.
  const dismiss = page.getByRole("button", { name: /get started|got it|dismiss|close|skip/i }).first();
  if (await dismiss.count().catch(() => 0)) {
    await dismiss.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  await beat(1200);
  await shot("dashboard", "A new account, nothing logged yet.", { full: true });

  // ── Session ────────────────────────────────────────────────────────────────
  await page.goto("/runs/new");
  await page.waitForLoadState("networkidle");
  await beat(1000);
  await dump("SESSION (fresh, no prefill)");
  await shot("session-empty", "Step 1 of 6. Nothing carried over — the run starts blank.", { full: true });

  await page.getByRole("combobox", { name: "Car" }).selectOption({ label: "A800RR" });
  await beat(700);
  await page.getByRole("radio", { name: "Race meeting" }).click();
  await beat(800);

  // Pick today's meeting. Native <select>, so selectOption — clicking one opens an OS-level
  // dropdown that Playwright cannot drive and the run hangs.
  const eventSelect = page.getByRole("combobox", { name: "Event" });
  const optionLabels = await eventSelect.locator("option").allTextContents();
  console.log("  event options: " + JSON.stringify(optionLabels));
  const meetingLabel = optionLabels.find((t) => /TFTR Club Round 5/.test(t));
  if (meetingLabel) {
    await eventSelect.selectOption({ label: meetingLabel });
  } else {
    console.log("  !! meeting not in the event list");
  }
  await beat(800);
  await page.getByRole("radio", { name: "Qualifying" }).click();
  await beat(700);
  await shot("session-filled", "Car, today's meeting at TFTR, qualifying. Three taps.", { full: true });

  // ── Tires ──────────────────────────────────────────────────────────────────
  await page.getByRole("tab", { name: /^Tires/ }).click();
  await beat(700);
  await dump("TIRES (fresh)");
  await page.getByRole("button", { name: "Tire compound" }).click();
  await beat(600);
  await page.getByRole("textbox", { name: /Search tire types/ }).pressSequentially("Matrix", {
    delay: VIDEO ? 90 : 0,
  });
  await beat(700);
  await shot("tires-picker", "Step 2. Searching the tire catalog.");
  await page.getByRole("option", { name: /Matrix.*D36/ }).first().click();
  await beat(700);
  await expect(page.getByRole("button", { name: "Tire compound" })).toContainText("D36");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await beat(600);
  await shot("tires", "Matrix D36, brand new set.", { full: true });

  // ── Prep ───────────────────────────────────────────────────────────────────
  await page.getByRole("tab", { name: /^Prep/ }).click();
  await beat(700);
  await page.getByRole("button", { name: "Additive type" }).click();
  await beat(600);
  await page.getByRole("option", { name: "Mighty Gripper - Yellow" }).click();
  await beat(700);
  await expect(page.getByRole("button", { name: "Additive type" })).toContainText("Yellow");

  // A fresh account has NO prep applications ("0/3 · No tire prep logged") — unlike an account with
  // history, where one is carried forward already. Founder 2026-08-06: the additive prep and the 20
  // minutes of warming are part of what's being logged, so the application has to be added first.
  await page.getByRole("button", { name: /Add application/ }).click();
  await beat(800);

  // Adding an application defaults to additive-on at 20 minutes, but NOT in warmers — so the
  // warming has to be switched on explicitly.
  const inWarmers = page.getByRole("switch", { name: "In warmers" });
  if ((await inWarmers.getAttribute("aria-checked")) !== "true") {
    await inWarmers.click();
    await beat(700);
  }

  // Assert what the frame claims: additive applied, in warmers, 20 minutes.
  await expect(page.getByRole("switch", { name: "Additive this application" })).toHaveAttribute("aria-checked", "true");
  await expect(inWarmers).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Minutes, application 1", exact: true })).toContainText("20");
  await dump("PREP (additive applied, 20m in warmers)");
  await shot("prep-application", "Mighty Gripper Yellow, applied, 20 minutes in the warmers.", { full: true });

  // Collapse the minutes control so the step reads as a summary rather than mid-edit.
  await page.getByRole("button", { name: "Minutes, application 1", exact: true }).click();
  await beat(700);
  await shot("prep", "Step 3. Mighty Gripper Yellow applied, 20 minutes in the warmers.", { full: true });

  // ── Setup ──────────────────────────────────────────────────────────────────
  await page.getByRole("tab", { name: /^Setup/ }).click();
  await beat(700);
  await dump("SETUP (fresh)");
  await shot("setup-empty", "Step 4. No setup yet — but there's one saved.", { full: true });

  const savedTab = page.getByRole("tab", { name: /Saved/ });
  if (await savedTab.count()) {
    await savedTab.first().click();
    await beat(700);
  }
  // Native <select> again — selectOption, never click.
  const savedSelect = page.getByRole("combobox", { name: "Saved setup" });
  const savedOpts = await savedSelect.locator("option").allTextContents();
  const savedLabel = savedOpts.find((t) => /TFTR — medium grip/.test(t));
  if (!savedLabel) throw new Error("saved setup missing: " + JSON.stringify(savedOpts));
  await savedSelect.selectOption({ label: savedLabel });
  await beat(1400);
  await dump("SETUP (loaded)");
  await shot("setup-loaded", "One tap loads the saved setup — the whole sheet, every parameter, without typing any of it.", { full: true });

  // ── Laps ───────────────────────────────────────────────────────────────────
  await page.getByRole("tab", { name: /^Laps/ }).click();
  await page.waitForTimeout(2500); // the scan crawls LiveRC live
  await beat(1200);
  await shot("laps-scan", "Step 5. No lap times typed in — the app searched TFTR on LiveRC and found the session under this driver's name.", { full: true });

  await page.getByRole("button", { name: /Jordan Caruso.*Import/ }).click();
  await page.waitForTimeout(3500);
  await beat(1200);
  await shot("laps-imported", "One tap. Every lap straight off the timing system.", { full: true });

  // ── Feedback ───────────────────────────────────────────────────────────────
  await page.getByRole("tab", { name: /^Feedback/ }).click();
  await beat(800);
  await page.getByRole("radio", { name: "6 out of 10 — workable" }).click();
  await beat(600);
  const notes = page.getByRole("textbox", { name: "Session notes" });
  await notes.click();
  await notes.pressSequentially(
    "Not too bad, had a bit more mid corner steering but still lacking.",
    { delay: VIDEO ? 26 : 0 },
  );
  await beat(900);
  await shot("feedback-rating", "Step 6. How the car felt.", { full: true });

  await page.getByRole("tab", { name: "Show Handling detail" }).click();
  await beat(800);
  await page.getByRole("radio", { name: /^Entry — .*neutral/ }).click();
  await beat(450);
  await page.getByRole("radio", { name: /^Mid — .*understeer/ }).click();
  await beat(350);
  await page.getByRole("radio", { name: /^Mid — .*understeer/ }).click();
  await beat(450);
  await page.getByRole("radio", { name: /^Exit — .*oversteer/ }).click();
  await beat(700);
  // One tap = mild (a second would make it moderate, a third severe).
  await page.getByRole("button", { name: /^Snaps on power/ }).click();
  await beat(1200);
  await shot("feedback-handling", "Corner by corner: neutral entry, moderate mid understeer, mild exit oversteer — plus a mild snap on power.", { full: true });

  // ── Complete ───────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Complete" }).click();
  await page.waitForURL(/suggestRun=/, { timeout: 30_000 });
  const runId = new URL(page.url()).searchParams.get("suggestRun");
  if (!runId) throw new Error("no run id after completing: " + page.url());

  await page.waitForFunction(
    () => !!document.querySelector("main")?.textContent?.trim().length,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(2000);
  await beat(1400);
  await shot("dashboard-after", "Logged. The day updates itself.", { full: true });

  await page.goto(`/runs/${runId}`);
  await page.waitForFunction(
    () => !!document.querySelector("main")?.textContent?.trim().length,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(2500);
  await beat(1400);
  await shot("run-detail", "The finished run: imported laps, the setup it ran, and the feel that went with it.", { full: true });

  if (VIDEO) console.log("\nvideo (webm): " + (await page.video()?.path()));

  writeFileSync(
    `${OUT}/walkthrough.md`,
    [
      "# Logging a run from scratch — full walkthrough",
      "",
      "A brand-new account with no prior runs, so nothing is prefilled and every field is chosen",
      "on camera. Phone viewport, 390×844 at 3× (files are 1170×2532). `-full` variants are the",
      "same screen at full scroll height.",
      "",
      "## What was logged",
      "",
      "| | |",
      "|---|---|",
      "| Car | A800RR (chosen from two) |",
      "| Day | Race meeting — TFTR Club Round 5, today · Qualifying |",
      "| Tires | Matrix EP Touring D36, new set |",
      "| Prep | Mighty Gripper Yellow applied · 20 min in warmers |",
      "| Setup | Saved setup \"TFTR — medium grip\" — ~70 parameters in one tap |",
      "| Laps | Auto-imported from LiveRC · best 16.228 |",
      "| Feel | 6/10 · neutral entry, moderate mid understeer, mild exit oversteer, mild snap on power |",
      "",
      "## Honesty note",
      "",
      "The lap data is real — a session driven at TFTR on 3 August, fetched live from",
      "tftr.liverc.com by the app itself and matched to the driver by name and transponder.",
      "The only alteration is the session's **date**, shifted to today so the scan shows the",
      "one-tap path instead of an empty 'no sessions today'.",
      "",
      "## Video",
      "",
      "`bash scripts/walkthrough-video.sh` after a `WALKTHROUGH_VIDEO=1` run produces",
      "`walkthrough.mp4` (full pace) and `walkthrough-fast.mp4` (1.6×).",
      "",
      "## Frames",
      "",
      ...captions,
      "",
    ].join("\n"),
    "utf8",
  );
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
