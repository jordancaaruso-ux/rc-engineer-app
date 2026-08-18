/**
 * Onboarding friction audit — the same first run, driven nine ways.
 *
 * The shipped first-run flow has never been driven as a real new user more than once. The north
 * star's own rollout table says as much ("built … not yet driven in a browser"), and
 * `/debug/onboarding-preview` can't close the gap: it renders the two onboarding surfaces with
 * fabricated props, so it shows you the copy but never what it COSTS to get through.
 *
 * Cost is the point. Reading the code tells you a screen exists; it does not tell you that the
 * Setup step opens on a tab which is empty by construction for everyone who has never logged a
 * run. So each persona below starts from a genuinely empty account and walks to a completed run
 * while the harness counts:
 *
 *   taps          — every deliberate interaction
 *   detours       — leaving the flow's own page to do something, and coming back
 *   blocked saves — a Save/Complete that produced an error instead of progress
 *   dead ends     — recorded by hand: nowhere on screen said how to go forward
 *
 * Wall clock is recorded but ranks nothing — headless timing is page load, not effort.
 * Screenshots are evidence, never the metric: `scripts/dev-layout-probe.ts` measured up to 98%
 * pixel difference between two runs of IDENTICAL code, purely from reveal animations.
 *
 *   npx playwright test e2e/onboarding-friction.spec.ts --no-deps --project=mobile-chromium
 *
 * Output lands in onboarding-friction/ (untracked): report.md, created.json, and numbered
 * screenshots per persona.
 *
 * CLEANUP IS NOT AUTOMATIC — deliberately. Every track and tire type a persona invents is written
 * to created.json by id, because `TireType.createdByUserId` is `onDelete: SetNull`: deleting the
 * throwaway accounts leaves invented tyres behind as orphans in the GLOBAL catalog. (The stale
 * "ZZ Onboarding Test Track" row on scratch-dev is what that looks like when nobody cleans up.)
 * Delete by recorded id, then `npm run onboarding:cleanup`. Doing it by hand keeps the delete
 * list inspectable rather than trusting a pattern match near real users' rows.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({
  storageState: { cookies: [], origins: [] },
  timezoneId: "Australia/Melbourne",
});
/*
 * Per-persona, not for the file. A walk that stalls is a harness bug, and a 15-minute stall
 * doubles the suite's wall clock before it tells you — one persona is ~60s, so 5 minutes is
 * generous and still fails fast.
 */
test.setTimeout(300_000);

const OUT = "onboarding-friction";

/** An existing track every persona can pick, so "the track is already there" is held constant. */
const EXISTING_TRACK = "TFTR";
/** Chassis whose calibration opens the upload door AND matches the PDF fixture below. */
const UPLOAD_CHASSIS = "Xray X4'26";
/** Another chassis with a real sheet, used where the upload door isn't the subject. */
const SHEET_CHASSIS = "Mugen MTC3";
/** The fillable sheet `e2e/setup-sheet-upload-door.spec.ts` already pins. */
const FIXTURE_PDF =
  "scripts/setup-extract-eval/gold/xray-x4-2026/files/x4_2026_set_up_editable_v02.pdf";

/**
 * Each persona's walk and its catalog writes are flushed to their own file the moment that walk
 * ends, and the report is assembled from those files.
 *
 * Not module-level arrays: Playwright tears the worker down after a failing test, and the fresh
 * worker starts with empty ones. That is exactly what happened on the first run after a persona
 * timed out — nine walks completed and the report contained three, silently.
 */
const created: { kind: string; id: string; label: string; persona: string }[] = [];

type EventKind = "tap" | "nav" | "detour" | "blocked" | "interrupt" | "deadEnd" | "note";
type Ev = { kind: EventKind; note: string };

type Walk = {
  id: string;
  title: string;
  events: Ev[];
  shots: string[];
  ms: number;
  completed: boolean;
  failed?: string;
};

/**
 * One persona's instrumented browser. The counters are a by-product of driving — a metric
 * collected in a separate pass is a metric that drifts from what actually happened.
 */
class Drive {
  readonly walk: Walk;
  private shotN = 0;
  private lastPath = "";
  private started = Date.now();

  constructor(
    readonly page: Page,
    id: string,
    title: string,
  ) {
    this.walk = { id, title, events: [], shots: [], ms: 0, completed: false };
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const path = new URL(frame.url()).pathname;
      if (path === this.lastPath) return;
      this.lastPath = path;
      this.walk.events.push({ kind: "nav", note: path });
    });
  }

  /** Flush to disk immediately — see the note on `created` about worker restarts. */
  finish() {
    this.walk.ms = Date.now() - this.started;
    writeFileSync(`${OUT}/walk-${this.walk.id}.json`, JSON.stringify(this.walk, null, 2), "utf8");
    const mine = created.filter((c) => c.persona === this.walk.id);
    if (mine.length) {
      writeFileSync(`${OUT}/created-${this.walk.id}.json`, JSON.stringify(mine, null, 2), "utf8");
    }
  }

  count(kind: EventKind) {
    return this.walk.events.filter((e) => e.kind === kind).length;
  }

  note(note: string) {
    this.walk.events.push({ kind: "note", note });
  }

  /** Nowhere on screen said how to go forward. Always paired with a screenshot. */
  async deadEnd(note: string) {
    this.walk.events.push({ kind: "deadEnd", note });
    await this.shot(`deadend-${note.slice(0, 28).replace(/\W+/g, "-")}`);
  }

  /** Complete refused: the run did not save. */
  blocked(note: string) {
    this.walk.events.push({ kind: "blocked", note });
  }

  /** The run DID save, but something stood between pressing Complete and being finished. */
  interrupt(note: string) {
    this.walk.events.push({ kind: "interrupt", note });
  }

  /** Left the flow's own page to do something elsewhere. */
  detour(note: string) {
    this.walk.events.push({ kind: "detour", note });
  }

  async shot(name: string) {
    const file = `${this.walk.id}-${String(++this.shotN).padStart(2, "0")}-${name}.png`;
    await this.page.screenshot({ path: `${OUT}/${file}`, fullPage: true }).catch(() => {});
    this.walk.shots.push(file);
    return file;
  }

  /** The single instrumented interaction — everything a persona does goes through here. */
  async tap(note: string, target: Locator, opts?: { timeout?: number }) {
    this.walk.events.push({ kind: "tap", note });
    await target.first().click({ timeout: opts?.timeout ?? 25_000 });
    await this.page.waitForTimeout(500);
  }

  async type(note: string, target: Locator, text: string) {
    this.walk.events.push({ kind: "tap", note });
    await target.first().fill(text);
    await this.page.waitForTimeout(200);
  }

  /** A native <select> counts as one interaction; it is one gesture on a phone. */
  async choose(note: string, target: Locator, label: string) {
    this.walk.events.push({ kind: "tap", note });
    await target.first().selectOption({ label });
    await this.page.waitForTimeout(500);
  }

  /**
   * Settle helper lifted from `e2e/light-mode-audit.spec.ts` — the app streams, so
   * `domcontentloaded` alone lands on an empty shell and every later selector races it.
   */
  async load(path: string) {
    await this.page.goto(path, { waitUntil: "domcontentloaded" });
    await this.page
      .waitForFunction(() => (document.body?.textContent?.length ?? 0) > 40, null, {
        timeout: 45_000,
      })
      .catch(() => {});
    await this.page.waitForLoadState("networkidle").catch(() => {});
    await this.page.waitForTimeout(1200);
  }

  /** Visible `role=alert` / `role=status` copy — how the app says no. */
  alerts() {
    return this.page.evaluate(() =>
      [...document.querySelectorAll("[role=alert],[role=status]")]
        .map((e) => (e.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean),
    );
  }

  /** Any dialog standing in the way — a refusal can arrive as a modal, not just an alert. */
  dialogText() {
    return this.page.evaluate(() =>
      [...document.querySelectorAll("[role=dialog]")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((e) => (e.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean),
    );
  }
}

/**
 * The host `.env.local` points at. Read here rather than shelled out through `dotenv-cli`: on
 * Windows `execFileSync(..., { shell: true })` mangles inline JS quoting, and this only ever
 * extracts the hostname — the credential half of the URL is never parsed, logged or returned.
 */
function dbHost(): string {
  const raw = readFileSync(".env.local", "utf8");
  const line = raw.split(/\r?\n/).find((l) => l.trimStart().startsWith("DATABASE_URL="));
  const afterAt = line?.split("@")[1] ?? "";
  return afterAt.split("/")[0].replace(/["']/g, "");
}

test.beforeAll(() => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const host = dbHost();
  // Same guard as light-mode-audit.spec.ts. This spec creates accounts AND global catalog rows.
  if (/ep-hidden-rice/.test(host)) throw new Error(`REFUSING: pointed at PRODUCTION (${host})`);
  console.log(`Database: ${host}`);
});

/* ------------------------------------------------------------------- shared steps */

/** A brand-new account, signed in, on the dashboard with the welcome overlay armed. */
async function freshAccount(d: Drive) {
  await d.load("/api/auth/dev-new-user");
  // Origin-agnostic on purpose: baseURL follows AUTH_URL, which moves between localhost and the
  // LAN IP depending on whether someone is testing on a phone.
  await expect(d.page).toHaveURL(/\/$/, { timeout: 25_000 });
}

/** Answer the welcome overlay. It is a portal behind a `mounted` guard — never in server HTML. */
async function answerWelcome(d: Drive, choice: "get-set-up" | "look-around") {
  const primary = d.page.getByRole("button", { name: "Get set up", exact: true });
  await primary.waitFor({ state: "visible", timeout: 25_000 });
  await d.shot("welcome");
  if (choice === "get-set-up") {
    await d.tap('welcome — "Get set up"', primary);
  } else {
    await d.tap(
      'welcome — "Look around first"',
      d.page.getByRole("button", { name: "Look around first" }),
    );
  }
  await d.page.waitForTimeout(1500);
}

/**
 * Add a car from the dashboard card. `chassis === null` takes the
 * "My chassis isn't listed" escape hatch and declines the sheet.
 */
async function addCar(d: Drive, chassis: string | null, carName: string) {
  await d.shot("dashboard-card");
  await d.tap('card row — "Add your car"', d.page.getByRole("link", { name: /Add your car/ }));
  await d.page.waitForTimeout(1500);
  d.detour("dashboard → /cars to add a car");
  await d.shot("cars-empty");

  // The form is collapsed behind a row whose label is the same word as the submit button.
  await d.tap('/cars — "Add car" (expands the form)', d.page.getByRole("button", { name: /^Add car$/ }));

  const select = d.page.getByLabel("Chassis type");
  await select.waitFor({ state: "visible", timeout: 20_000 });
  const options = (await select.locator("option").allTextContents()).map((o) => o.trim());
  d.note(`chassis picker offers ${options.length - 1}: ${options.slice(1).join(" · ")}`);
  await d.shot("cars-form");

  if (chassis === null) {
    const escape = options.find((o) => o.includes("isn’t listed") || o.includes("isn't listed"));
    if (!escape) {
      await d.deadEnd("no escape hatch for a chassis that isn't listed");
      throw new Error(`no 'not listed' option; got: ${options.join(" | ")}`);
    }
    await d.choose(`chassis — "${escape}"`, select, escape);
    await d.shot("blank-upload-door");
    // Decline the sheet: this persona doesn't have the fillable PDF.
    const decline = d.page.getByRole("button", { name: /I don’t have the sheet|I don't have the sheet/ });
    if (!(await decline.count())) {
      await d.deadEnd("no way past the blank-sheet door without a fillable PDF");
      throw new Error("no 'I don't have the sheet' escape");
    }
    await d.tap('"I don’t have the sheet"', decline);
    await d.page.waitForTimeout(1200);
    await d.shot("declined-sheet");
  } else {
    const match = options.find((o) => o.startsWith(chassis));
    if (!match) {
      await d.deadEnd(`chassis "${chassis}" is not offered`);
      throw new Error(`chassis "${chassis}" not offered; got: ${options.join(" | ")}`);
    }
    await d.choose(`chassis — "${match}"`, select, match);
  }

  await d.type("car name", d.page.getByLabel("Car name"), carName);
  await d.tap('"Add car" (submit)', d.page.getByRole("button", { name: /^Add car$|^Adding…$/ }).last());
  await d.page.waitForTimeout(3500);
  await d.shot("car-added");

  const after = await d.page.evaluate(() => location.pathname);
  d.note(`after adding a car the browser is still on ${after}`);
  return options;
}

/**
 * Open the log-run wizard by the most direct route actually on screen. If the car page offers a
 * way onward, take it — walking back to the dashboard to find a CTA is a detour the driver only
 * pays when nothing on the current page leads anywhere.
 */
async function openWizard(d: Drive) {
  const onwardHere = d.page.getByRole("link", { name: /Log your first run/ });
  if (await onwardHere.count()) {
    await d.shot("car-page-onward");
    await d.tap('"Log your first run" (from the car page)', onwardHere);
    await d.page.waitForTimeout(2500);
    await expect(d.page).toHaveURL(/\/runs\/new/, { timeout: 30_000 });
    await d.shot("wizard-session");
    return;
  }
  await d.load("/");
  d.detour("/cars → dashboard to reach the run CTA");
  await d.shot("dashboard-ready");
  await d.tap("dashboard CTA into the wizard", d.page.getByRole("link", { name: /Log your first run|Start a new run/ }));
  await d.page.waitForTimeout(2500);
  await expect(d.page).toHaveURL(/\/runs\/new/, { timeout: 30_000 });
  await d.shot("wizard-session");
}

/** Pick an existing track from the sheet. */
async function pickExistingTrack(d: Drive, name = EXISTING_TRACK) {
  await d.tap("track picker", d.page.getByRole("button", { name: "Track" }));
  await d.page.waitForTimeout(900);
  const dialog = d.page.getByRole("dialog");
  const hasSearch = await dialog.locator("input").count();
  const optionCount = await dialog.locator("button").count();
  d.note(`track sheet: ${optionCount - 2} tracks, search box ${hasSearch ? "present" : "ABSENT"}`);
  await d.shot("track-sheet");
  await d.tap(`track — "${name}"`, dialog.locator("button").filter({ hasText: name }));
  await d.page.waitForTimeout(1200);
}

/** Create a track from the chip that sits below the picker, not inside it. */
async function createTrack(d: Drive, name: string) {
  await d.tap("track picker (to look for a create option)", d.page.getByRole("button", { name: "Track" }));
  await d.page.waitForTimeout(900);
  const dialog = d.page.getByRole("dialog");
  const createInSheet = dialog.locator("button").filter({ hasText: /add a track|add “/i });
  if (await createInSheet.count()) {
    // The sheet can now finish the job it was opened for. The search field only exists above a
    // list length threshold, so typing into it is optional — never assume it is there.
    const search = dialog.locator("input");
    if (await search.count()) {
      await d.type("search for a track that isn't there", search.first(), name);
      await d.page.waitForTimeout(700);
    } else {
      d.note("no search box in the track sheet at this list length — scrolled to the create row");
    }
    await d.shot("track-no-match");
    await d.tap("add the missing track from inside the sheet", createInSheet);
    await d.page.waitForTimeout(900);
  } else {
    await d.deadEnd(
      "the track picker sheet offers no way to add a missing track — the “New track” chip is on the page behind it, so you must close the sheet to find it",
    );
    await d.tap("close the track sheet", dialog.getByRole("button", { name: "Close" }));
    await d.page.waitForTimeout(700);
    await d.tap('"New track" chip (below the picker)', d.page.getByRole("button", { name: "New track" }));
    await d.page.waitForTimeout(700);
  }
  await d.shot("new-track-open");
  // The name carries across from the search when the sheet handed it over; type it only if not.
  const nameField = d.page.getByPlaceholder("Track name");
  if ((await nameField.inputValue().catch(() => "")) !== name) {
    await d.type("track name", nameField, name);
  } else {
    d.note("track name carried across from the picker search — not typed twice");
  }
  await d.tap('"Add track"', d.page.getByRole("button", { name: /^Add track$|^Adding…$/ }));
  await d.page.waitForTimeout(2500);
  await d.shot("track-created");
}

/** Pick the first tyre compound the catalog offers. */
async function pickExistingTyre(d: Drive) {
  await d.tap("tyre picker", d.page.getByRole("button", { name: "Tire compound" }));
  await d.page.waitForTimeout(900);
  const dialog = d.page.getByRole("dialog");
  await d.shot("tyre-sheet");
  const options = dialog.locator("button").filter({ hasText: /^(?!.*Add new)(?!Close).+/ });
  await d.tap("tyre — first listed compound", options.nth(2));
  await d.page.waitForTimeout(1200);
}

/** Invent a tyre compound that isn't in the catalog. */
async function createTyre(d: Drive, name: string) {
  await d.tap("tyre picker", d.page.getByRole("button", { name: "Tire compound" }));
  await d.page.waitForTimeout(900);
  const dialog = d.page.getByRole("dialog");
  const search = dialog.locator("input").first();
  if (await search.count()) {
    await d.type("search for a compound that doesn't exist", search, name);
    await d.page.waitForTimeout(900);
  }
  await d.shot("tyre-no-match");
  const add = dialog.locator("button").filter({ hasText: /Add new tire type|Add “|Add a tire type/ });
  if (!(await add.count())) {
    await d.deadEnd("no way to add a tyre compound that isn't listed");
    return;
  }
  await d.tap("add a new tyre type", add);
  await d.page.waitForTimeout(800);
  const nameField = dialog.getByLabel("Tire type name");
  if (await nameField.count()) await d.type("tyre name", nameField, name);
  await d.tap('"Add tire type"', dialog.locator("button").filter({ hasText: /^Add tire type$|^Adding…$/ }));
  await d.page.waitForTimeout(2000);
  await d.shot("tyre-created");
}

/** The tyre-age chips are disabled until a compound is chosen. */
async function setTyreAge(d: Drive) {
  const chip = d.page.getByRole("button", { name: "New", exact: true });
  if (await chip.count()) await d.tap('tyre age — "New"', chip);
}

/** Step to a named wizard step via the tick bar. */
async function goToStep(d: Drive, step: string) {
  await d.tap(`step bar — ${step}`, d.page.locator(`[aria-label^="${step}"]`).last());
  await d.page.waitForTimeout(1800);
}

/**
 * Attach a setup from the wizard. Returns what the Setup step opened on, because the default
 * tab is the subject of the audit, not an implementation detail.
 */
async function attachSetup(d: Drive, mode: "blank" | "skip") {
  await goToStep(d, "Setup");
  await d.shot("setup-step-as-opened");

  // Scoped to the setup card — the Laps card further down the page has "Show …" tabs too, and a
  // page-wide query silently reported one of those instead.
  const openTab = await d.page.evaluate(() => {
    const card = document.querySelector(".run-section--setup");
    if (!card) return { selected: "(no setup card)", text: "" };
    const tabs = [...card.querySelectorAll("button")].filter((b) =>
      (b.getAttribute("aria-label") || "").startsWith("Show "),
    );
    const on = tabs.find(
      (b) => b.getAttribute("aria-selected") === "true" || b.getAttribute("aria-checked") === "true",
    );
    return {
      selected: tabs.length === 0 ? "(no source tabs — a source is already resolved)" : on ? (on.textContent || "").trim() : "(none selected)",
      text: (card.textContent || "").replace(/\s+/g, " ").slice(0, 140),
    };
  });
  d.note(`Setup step opens on: ${openTab.selected} — "${openTab.text}"`);

  if (mode === "skip") {
    d.note("persona attaches no setup at all");
    return;
  }

  /*
   * Three shapes are possible, so take whichever is on screen rather than assuming one:
   *  - source tabs, New not selected  → pay a tap to switch to it
   *  - source tabs, New selected      → nothing to pay
   *  - no tabs at all                 → the source is already resolved and the card is a summary
   *                                     row ("New blank setup") with an Edit button to open it
   */
  const newTab = d.page.locator('[aria-label="Show New setup"]');
  if (await newTab.count()) {
    const selected = await newTab.first().getAttribute("aria-selected");
    if (selected === "true") {
      d.note("Setup step already open on New — no tab change needed");
    } else {
      await d.tap('setup — "New" tab', newTab);
    }
  } else {
    const edit = d.page.locator(".run-section--setup").getByRole("button", { name: /^Edit$/ });
    if (await edit.count()) {
      await d.tap('setup — "Edit" (open the blank sheet)', edit);
    } else {
      await d.deadEnd("setup card offers neither a source tab nor a way to open the sheet");
      return;
    }
  }
  await d.page.waitForTimeout(2500);
  await d.shot("setup-blank-sheet");

  // First free-text box on the blank sheet. The sheet's inputs carry no aria-label at all,
  // so there is nothing more specific to aim at — which is itself worth recording.
  const boxes = d.page.locator(".run-section--setup input:visible");
  const n = await boxes.count();
  d.note(`blank sheet renders ${n} input boxes, none with an accessible label`);
  const typable = boxes.nth(1);
  if (await typable.count()) {
    await d.type("first value on the blank sheet", typable, "3.5");
    await d.page.waitForTimeout(800);
  }
}

/** Rate the car and press Complete, recording the refusal if there is one. */
async function completeRun(d: Drive) {
  await goToStep(d, "Feedback");
  await d.shot("feedback-step");
  await d.tap("rating — 8/10", d.page.locator('[aria-label="8 out of 10 — good"]'));
  await d.page.waitForTimeout(700);

  for (let attempt = 1; attempt <= 4; attempt++) {
    await d.tap(`"Complete"${attempt > 1 ? ` (attempt ${attempt})` : ""}`, d.page.getByRole("button", { name: /^Complete$|^Save edits$/ }));
    await d.page.waitForTimeout(3500);
    const url = d.page.url();
    if (!/\/runs\/new/.test(url)) {
      d.walk.completed = true;
      await d.shot("run-saved");
      d.note(`run completed, landed on ${new URL(url).pathname}`);
      return;
    }

    // A refusal can arrive as a modal rather than an alert. The GPS prompt is the one that
    // catches anyone who just created their own track: it asks a first-time user to go to
    // Google Maps and copy coordinates, at the moment they press Complete.
    const dialogs = await d.dialogText();
    const gps = dialogs.find((t) => /Set track GPS location/i.test(t));
    if (gps) {
      // Not a refusal: the run saves. It is a modal asking a first-timer to fetch coordinates
      // out of Google Maps at the exact moment they thought they were finished.
      d.interrupt("Complete opened the “Set track GPS location” modal — Google Maps coordinates asked for mid-save");
      await d.shot(`complete-gps-prompt-${attempt}`);
      await d.tap('"Not now" (dismiss the GPS modal)', d.page.getByRole("button", { name: "Not now" }));
      await d.page.waitForTimeout(2500);
      if (!/\/runs\/new/.test(d.page.url())) {
        d.walk.completed = true;
        await d.shot("run-saved");
        d.note(`run completed after dismissing the modal, landed on ${new URL(d.page.url()).pathname}`);
        return;
      }
      continue;
    }

    const said = [...(await d.alerts()), ...dialogs].join(" | ");
    d.blocked(said || "Complete did nothing and said nothing");
    await d.shot(`complete-blocked-${attempt}`);

    // Do what the app just asked for, so the next attempt measures the NEXT obstacle.
    if (/attach a setup/i.test(said)) {
      await attachSetup(d, "blank");
      await goToStep(d, "Feedback");
    } else if (/Select a track/i.test(said)) {
      await goToStep(d, "Session");
      await pickExistingTrack(d);
      await goToStep(d, "Feedback");
    } else if (/rate the car/i.test(said)) {
      await d.tap("rating — 8/10 (again)", d.page.locator('[aria-label="8 out of 10 — good"]'));
    } else {
      await d.deadEnd(`Complete refused and the reason wasn't actionable: ${said.slice(0, 120)}`);
      return;
    }
  }
}

/** Capture what the API handed back so created rows can be deleted by id later. */
function recordCatalogWrites(page: Page, persona: string) {
  page.on("response", async (res) => {
    const url = res.url();
    if (res.request().method() !== "POST") return;
    if (!/\/api\/(tracks|tire-types)$/.test(url)) return;
    if (res.status() >= 400) return;
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return;
    const kind = url.endsWith("/tracks") ? "track" : "tireType";
    const row = (body.track ?? body.tireType ?? body) as Record<string, unknown>;
    const id = typeof row?.id === "string" ? row.id : null;
    if (id) {
      created.push({
        kind,
        id,
        label: String(row.name ?? row.displayName ?? ""),
        persona,
      });
    }
  });
}

/* ------------------------------------------------------------------- the personas */

type Persona = {
  id: string;
  title: string;
  run: (d: Drive) => Promise<void>;
};

const personas: Persona[] = [
  {
    id: "P0",
    title: "Happy path — supported chassis, fillable PDF, existing track and tyres",
    run: async (d) => {
      await freshAccount(d);
      await answerWelcome(d, "get-set-up");
      await addCar(d, UPLOAD_CHASSIS, "P0 X4");
      // The upload door lives on /cars once a car exists.
      await d.tap("“Create / Upload setup sheet”", d.page.getByRole("button", { name: /Create \/ Upload setup sheet/ }));
      await d.page.waitForTimeout(1500);
      await d.shot("upload-doors");
      const doors = await d.page.evaluate(() =>
        [...document.querySelectorAll("[role=dialog] button")]
          .map((b) => `${(b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60)}${(b as HTMLButtonElement).disabled ? " (DISABLED)" : ""}`)
          .filter(Boolean),
      );
      d.note(`setup doors offered: ${doors.join(" · ")}`);
      const chooser = d.page.locator('input[type="file"]');
      d.walk.events.push({ kind: "tap", note: "upload the fillable sheet" });
      await chooser.first().setInputFiles(FIXTURE_PDF).catch(async () => {
        await d.deadEnd("no file input behind the upload door");
      });
      await d.page.waitForTimeout(20_000);
      await d.shot("after-upload");
      d.note(`after upload, on ${new URL(d.page.url()).pathname}`);
      await openWizard(d);
      await pickExistingTrack(d);
      await goToStep(d, "Tires");
      await pickExistingTyre(d);
      await setTyreAge(d);
      await completeRun(d);
    },
  },
  {
    id: "P1",
    title: "Supported chassis, no PDF — hand-build the sheet instead",
    run: async (d) => {
      await freshAccount(d);
      await answerWelcome(d, "get-set-up");
      await addCar(d, SHEET_CHASSIS, "P1 MTC3");
      await openWizard(d);
      await pickExistingTrack(d);
      await goToStep(d, "Tires");
      await pickExistingTyre(d);
      await setTyreAge(d);
      await attachSetup(d, "blank");
      await completeRun(d);
    },
  },
  {
    id: "P2",
    title: "Unreviewed chassis in the catalog",
    run: async (d) => {
      await freshAccount(d);
      await answerWelcome(d, "get-set-up");
      const options = await addCar(d, SHEET_CHASSIS, "P2 car");
      const unreviewed = options.filter((o) => /Unreviewed/.test(o));
      d.note(`chassis marked · Unreviewed: ${unreviewed.length ? unreviewed.join(" · ") : "none"}`);
      await openWizard(d);
      await pickExistingTrack(d);
      await goToStep(d, "Tires");
      await pickExistingTyre(d);
      await setTyreAge(d);
      await attachSetup(d, "blank");
      await completeRun(d);
    },
  },
  {
    id: "P3",
    title: "Chassis isn't in the list, and no fillable PDF either",
    run: async (d) => {
      await freshAccount(d);
      await answerWelcome(d, "get-set-up");
      await addCar(d, null, "P3 Yokomo BD12");
      await openWizard(d);
      await pickExistingTrack(d);
      await goToStep(d, "Tires");
      await pickExistingTyre(d);
      await setTyreAge(d);
      await attachSetup(d, "blank");
      await completeRun(d);
    },
  },
  {
    id: "P4",
    title: "Skips the setup entirely and tries to finish the run",
    run: async (d) => {
      await freshAccount(d);
      await answerWelcome(d, "get-set-up");
      await addCar(d, SHEET_CHASSIS, "P4 MTC3");
      await openWizard(d);
      await pickExistingTrack(d);
      await goToStep(d, "Tires");
      await pickExistingTyre(d);
      await setTyreAge(d);
      await attachSetup(d, "skip");
      await completeRun(d);
    },
  },
  {
    id: "P9",
    title: "Believes the coach line — skips tyres AND setup, both said to be optional",
    run: async (d) => {
      /*
       * The minimal honest path. The wizard's own first-run coach line on the Tires step reads
       * "Tires aren't required to save", and nothing says a setup is mandatory either.
       *
       * Isolated by probe (four variants, same account shape, one difference each):
       *   Session → Feedback                        → BLOCKED "attach a setup"
       *   Session → Tires tab (pick nothing)        → BLOCKED "attach a setup"
       *   Session → Setup tab (attach nothing)      → BLOCKED "attach a setup"
       *   Session → Tires tab → PICK A COMPOUND     → saves, with no setup attached
       * So a tyre choice is what satisfies the setup gate — tyres are fields on the setup sheet.
       * This persona takes the coach line at its word and therefore hits the wall.
       */
      await freshAccount(d);
      await answerWelcome(d, "get-set-up");
      await addCar(d, SHEET_CHASSIS, "P9 MTC3");
      await openWizard(d);
      await pickExistingTrack(d);
      await goToStep(d, "Tires");
      await d.shot("tires-coach-line");
      const coach = await d.page.evaluate(() =>
        /Tires aren.t required to save/i.test(document.body.textContent || ""),
      );
      d.note(coach ? 'the Tires step says "Tires aren\'t required to save"' : "no tyre coach line shown");
      d.note("takes that at its word: picks no compound, never opens the Setup step");
      await completeRun(d);
    },
  },
  {
    id: "P5",
    title: "Their track isn't in the catalog",
    run: async (d) => {
      await freshAccount(d);
      await answerWelcome(d, "get-set-up");
      await addCar(d, SHEET_CHASSIS, "P5 MTC3");
      await openWizard(d);
      await createTrack(d, `Audit Club ${Date.now().toString(36).slice(-5)}`);
      await goToStep(d, "Tires");
      await pickExistingTyre(d);
      await setTyreAge(d);
      await attachSetup(d, "blank");
      await completeRun(d);
    },
  },
  {
    id: "P6",
    title: "Their tyre compound isn't in the catalog",
    run: async (d) => {
      await freshAccount(d);
      await answerWelcome(d, "get-set-up");
      await addCar(d, SHEET_CHASSIS, "P6 MTC3");
      await openWizard(d);
      await pickExistingTrack(d);
      await goToStep(d, "Tires");
      await createTyre(d, `Audit Compound ${Date.now().toString(36).slice(-5)}`);
      await setTyreAge(d);
      await attachSetup(d, "blank");
      await completeRun(d);
    },
  },
  {
    id: "P7",
    title: "Dismisses both onboarding surfaces, then tries anyway",
    run: async (d) => {
      await freshAccount(d);
      await answerWelcome(d, "look-around");
      await d.shot("after-look-around");
      const ignore = d.page.getByRole("button", { name: "Ignore" });
      if (await ignore.count()) {
        await d.tap('card — "Ignore"', ignore);
        await d.page.waitForTimeout(2000);
      }
      await d.load("/");
      await d.shot("dashboard-after-ignore");
      const stillAsking = await d.page.evaluate(() =>
        (document.body.textContent || "").replace(/\s+/g, " "),
      );
      d.note(
        /no setup yet|Add a setup|Create \/ Upload setup sheet/i.test(stillAsking)
          ? "after Ignore, a second setup ask is on the dashboard"
          : "after Ignore, the dashboard stops asking",
      );
      // Timing identity — the row that leaves the flow.
      await d.load("/settings");
      d.detour("dashboard → /settings for timing details");
      await d.shot("settings-timing");
      const settingsFields = await d.page.evaluate(() =>
        [...document.querySelectorAll("input,select,textarea")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map((el) => el.getAttribute("aria-label") || el.getAttribute("placeholder") || "(unlabelled)"),
      );
      d.note(`/settings shows ${settingsFields.length} fields: ${settingsFields.join(" · ")}`);
      // The loaner / club-chip declaration was checked here until 2026-08-18, when it was taken
      // off /settings by founder call — a driver on a borrowed club chip isn't who this app is
      // for, so its absence is the decision, not a finding.

      await d.load("/cars");
      await d.tap('/cars — "Add car"', d.page.getByRole("button", { name: /^Add car$/ }));
      await d.choose("chassis", d.page.getByLabel("Chassis type"), SHEET_CHASSIS);
      await d.type("car name", d.page.getByLabel("Car name"), "P7 MTC3");
      await d.tap('"Add car" (submit)', d.page.getByRole("button", { name: /^Add car$|^Adding…$/ }).last());
      await d.page.waitForTimeout(3500);
      await d.load("/runs/new");
      await pickExistingTrack(d);
      await goToStep(d, "Tires");
      await pickExistingTyre(d);
      await setTyreAge(d);
      await attachSetup(d, "blank");
      await completeRun(d);
    },
  },
  {
    id: "P8",
    title: "Control — the SECOND run on a car that already has a setup",
    run: async (d) => {
      await freshAccount(d);
      await answerWelcome(d, "get-set-up");
      await addCar(d, SHEET_CHASSIS, "P8 MTC3");
      await openWizard(d);
      await pickExistingTrack(d);
      await goToStep(d, "Tires");
      await pickExistingTyre(d);
      await setTyreAge(d);
      await attachSetup(d, "blank");
      await completeRun(d);

      // Everything above is setup cost. The measurement starts here.
      d.note("=== SECOND RUN STARTS HERE — counters above are the first-run cost ===");
      const before = {
        taps: d.count("tap"),
        detours: d.count("detour"),
        blocked: d.count("blocked"),
      };
      await d.load("/runs/new");
      await d.shot("second-run-session");
      await pickExistingTrack(d);
      await goToStep(d, "Tires");
      await pickExistingTyre(d);
      await setTyreAge(d);
      await goToStep(d, "Setup");
      await d.shot("second-run-setup");
      const setupState = await d.page.evaluate(
        () => (document.querySelector(".run-section--setup")?.textContent || "").replace(/\s+/g, " ").slice(0, 180),
      );
      d.note(`second run, Setup step says: ${setupState}`);
      await completeRun(d);
      d.note(
        `SECOND RUN COST: ${d.count("tap") - before.taps} taps, ` +
          `${d.count("detour") - before.detours} detours, ` +
          `${d.count("blocked") - before.blocked} blocked saves`,
      );
    },
  },
];

for (const p of personas) {
  test(`${p.id} — ${p.title}`, async ({ page }) => {
    const d = new Drive(page, p.id, p.title);
    recordCatalogWrites(page, p.id);
    try {
      await p.run(d);
    } catch (err) {
      d.walk.failed = err instanceof Error ? err.message : String(err);
      await d.shot("failed");
    } finally {
      d.finish();
    }
    // The walk is the deliverable; a persona that hit a wall is data, not a test failure.
    console.log(
      `${p.id}: ${d.count("tap")} taps · ${d.count("detour")} detours · ` +
        `${d.count("interrupt")} interrupts · ${d.count("blocked")} blocked · ${d.count("deadEnd")} dead ends · ` +
        `${d.walk.completed ? "COMPLETED" : "did not complete"}` +
        (d.walk.failed ? ` · FAILED: ${d.walk.failed.slice(0, 120)}` : ""),
    );
  });
}

test.afterAll(() => {
  // Assembled from disk, so a worker restart can't quietly drop half the run.
  const files = readdirSync(OUT);
  const walks: Walk[] = files
    .filter((f) => f.startsWith("walk-") && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(`${OUT}/${f}`, "utf8")) as Walk);
  const allCreated = files
    .filter((f) => f.startsWith("created-") && f.endsWith(".json"))
    .flatMap((f) => JSON.parse(readFileSync(`${OUT}/${f}`, "utf8")) as typeof created);
  writeFileSync(`${OUT}/created.json`, JSON.stringify(allCreated, null, 2), "utf8");

  const rows = walks
    .map((w) => {
      const c = (k: EventKind) => w.events.filter((e) => e.kind === k).length;
      return {
        w,
        taps: c("tap"),
        detours: c("detour"),
        blocked: c("blocked"),
        interrupts: c("interrupt"),
        deadEnds: c("deadEnd"),
      };
    })
    .map((r) => ({
      ...r,
      // Weighted because the units aren't comparable: a tap is a second, a refusal is a
      // "have I broken it?". Weights are a judgement, so the raw columns stay visible.
      score: r.taps + r.detours * 3 + r.interrupts * 4 + r.blocked * 6 + r.deadEnds * 8,
    }))
    .sort((a, b) => b.score - a.score);

  const lines: string[] = [
    "# Onboarding friction — measured",
    "",
    "One brand-new account per persona, each walked from first sign-in to a completed run.",
    "Ranked by `taps + 3×detours + 4×interrupts + 6×blocked + 8×dead ends`. The weights are a",
    "judgement call, so every raw column is shown — re-rank them yourself if you disagree.",
    "",
    "| Persona | Score | Taps | Detours | Interrupts | Blocked saves | Dead ends | Finished | Wall clock |",
    "|---|---:|---:|---:|---:|---:|---:|:--:|---:|",
  ];
  for (const r of rows) {
    lines.push(
      `| **${r.w.id}** ${r.w.title} | ${r.score} | ${r.taps} | ${r.detours} | ${r.interrupts} | ${r.blocked} | ${r.deadEnds} | ${r.w.completed ? "yes" : "**no**"} | ${(r.w.ms / 1000).toFixed(0)}s |`,
    );
  }

  for (const r of rows) {
    lines.push("", `## ${r.w.id} — ${r.w.title}`, "");
    if (r.w.failed) lines.push(`> **Walk aborted:** ${r.w.failed}`, "");
    for (const e of r.w.events) {
      const prefix =
        e.kind === "tap"
          ? "- tap:"
          : e.kind === "nav"
            ? "- → "
            : e.kind === "detour"
              ? "- **detour:**"
              : e.kind === "blocked"
                ? "- **BLOCKED:**"
                : e.kind === "interrupt"
                  ? "- **INTERRUPT:**"
                  : e.kind === "deadEnd"
                    ? "- **DEAD END:**"
                    : "- _note:_";
      lines.push(`${prefix} ${e.note}`);
    }
    lines.push("", "Screenshots: " + r.w.shots.map((s) => `[${s}](${s})`).join(" · "));
  }

  const md = lines.join("\n");
  writeFileSync(`${OUT}/report.md`, md, "utf8");
  console.log(`\n${md.split("\n").slice(0, 22).join("\n")}\n…full report in ${OUT}/report.md`);
  console.log(`${walks.length} walks recorded`);
  console.log(`${allCreated.length} global catalog rows created — see ${OUT}/created.json`);
});
