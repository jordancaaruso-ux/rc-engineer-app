/**
 * demoTimingSite.ts — an in-memory fake LiveRC track site, for recording product video
 * without putting a real club, a real event, or real drivers on screen.
 *
 * Why this exists: URL Auto discovery is fed entirely by pages read off the club's timing
 * site, and it can only ever surface sessions the club actually published — so a demo is
 * hostage to whether the founder raced recently, and to whoever else was in that A-main.
 * Serving the pages ourselves makes the session list, its date, the field and the lap times
 * authored content, while every parser, matcher and cache downstream runs untouched.
 *
 * Wiring: `fetchUrlText` (the single fetch choke point for every timing parser and every
 * discovery/watch crawl) checks `serveDemoTimingPage` first. Nothing else changes.
 *
 * DEV ONLY, twice over: `NODE_ENV === "production"` refuses outright, and the env flag must
 * be set. This fabricates race results — it must be impossible to switch on for real users.
 *
 * Setup for a shoot: `npm run demo:timing:setup` (creates the track + sets the driver name),
 * then `DEMO_TIMING_SITE=1` in `.env.local` and restart the dev server.
 */

export const DEMO_TIMING_HOST = "ironbark.liverc.com";
export const DEMO_TIMING_ORIGIN = `https://${DEMO_TIMING_HOST}`;
export const DEMO_TRACK_NAME = "Ironbark Raceway";
export const DEMO_EVENT_ID = "90210";
export const DEMO_EVENT_LABEL = "Ironbark Winter Series - Round 4";

/**
 * Who the driver is in the invented results. Must match the account being recorded on:
 * the saved run labels the driver's own lap column from their `myName` setting, so a
 * mismatch puts two different names on one screen. `npm run demo:timing:setup` writes
 * both settings from this value — set `DEMO_TIMING_DRIVER_NAME` before running it to
 * match an account that already has a name (the seeded demo account is "Alex Marino").
 */
export const DEMO_DRIVER_NAME = process.env.DEMO_TIMING_DRIVER_NAME?.trim() || "Nic Swole";

/** Enabled only on a dev box with the flag explicitly set. Both conditions, always. */
export function isDemoTimingSiteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  return env.DEMO_TIMING_SITE === "1";
}

// ── The race day ──────────────────────────────────────────────────────────────
// One driver, one session in the picker: only the 2WD Modified A-main carries the demo
// driver. The other two races exist so the hub crawl has something to reject — discovery
// that finds one session among three reads as a search, not as a single hardcoded row.

type DemoDriver = { driverId: string; name: string; basePace: number; mistakeLap: number | null };

type DemoRace = {
  raceId: string;
  linkText: string;
  /** Minutes before "now" the session finished — keeps the list reading as today, every take. */
  minutesAgo: number;
  field: DemoDriver[];
};

/** The demo driver's A-main laps, hand-written: rolling start, a lap-7 marshal, then building to a late best. */
const DEMO_DRIVER_LAPS = [
  19.842, 18.214, 18.061, 17.945, 18.102, 17.883, 22.914, 18.336, 18.007,
  17.874, 17.802, 17.996, 17.741, 17.688, 17.913, 17.612, 17.795,
];

const MODIFIED_2WD_FIELD: DemoDriver[] = [
  { driverId: "118417", name: "Marcus Delaney", basePace: 17.46, mistakeLap: null },
  { driverId: "118203", name: DEMO_DRIVER_NAME, basePace: 17.61, mistakeLap: 7 },
  { driverId: "118755", name: "Tomas Brandt", basePace: 17.68, mistakeLap: null },
  { driverId: "118902", name: "Riley Fenwick", basePace: 17.83, mistakeLap: 11 },
  { driverId: "118344", name: "Devon Ashworth", basePace: 17.91, mistakeLap: null },
  { driverId: "118610", name: "Kai Lindqvist", basePace: 18.04, mistakeLap: 4 },
  { driverId: "118288", name: "Elliot Marsh", basePace: 18.17, mistakeLap: null },
  { driverId: "118471", name: "Priya Raman", basePace: 18.29, mistakeLap: 14 },
  { driverId: "118836", name: "Sam Okafor", basePace: 18.42, mistakeLap: null },
  { driverId: "118157", name: "Julian Vance", basePace: 18.66, mistakeLap: 9 },
];

const STOCK_13_5_FIELD: DemoDriver[] = [
  { driverId: "117021", name: "Aaron Whitlock", basePace: 19.12, mistakeLap: null },
  { driverId: "117338", name: "Beatrix Nolan", basePace: 19.28, mistakeLap: 6 },
  { driverId: "117544", name: "Cormac Reilly", basePace: 19.44, mistakeLap: null },
  { driverId: "117760", name: "Dana Petrov", basePace: 19.71, mistakeLap: 12 },
];

const MODIFIED_4WD_FIELD: DemoDriver[] = [
  { driverId: "119104", name: "Felix Amara", basePace: 16.94, mistakeLap: null },
  { driverId: "119267", name: "Georgia Sandoval", basePace: 17.08, mistakeLap: 8 },
  { driverId: "119483", name: "Hugo Lindstrom", basePace: 17.22, mistakeLap: null },
  { driverId: "119695", name: "Ivan Beckwith", basePace: 17.39, mistakeLap: 3 },
];

const RACES: DemoRace[] = [
  {
    raceId: "512043",
    linkText: "Race 12: 13.5 Stock Buggy (A-Main)",
    minutesAgo: 125,
    field: STOCK_13_5_FIELD,
  },
  {
    raceId: "512044",
    linkText: "Race 14: 2WD Modified Buggy (A-Main)",
    minutesAgo: 40,
    field: MODIFIED_2WD_FIELD,
  },
  {
    raceId: "512045",
    linkText: "Race 15: 4WD Modified Buggy (A-Main)",
    minutesAgo: 12,
    field: MODIFIED_4WD_FIELD,
  },
];

const RACE_LAP_COUNT = 17;

// ── Lap generation ────────────────────────────────────────────────────────────
// Seeded from the driver id, never Math.random: the same driver produces the same race
// every time, so a re-shoot matches the take before it.

function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Laps for one driver: slow opening lap, drifting pace, an optional marshal, tightening late. */
function lapsForDriver(driver: DemoDriver): number[] {
  if (driver.name === DEMO_DRIVER_NAME) return [...DEMO_DRIVER_LAPS];
  const rand = seededRandom(Number.parseInt(driver.driverId, 10));
  const laps: number[] = [];
  for (let lapNum = 1; lapNum <= RACE_LAP_COUNT; lapNum++) {
    if (lapNum === driver.mistakeLap) {
      laps.push(round3(driver.basePace + 4.2 + rand() * 1.6));
      continue;
    }
    // Drivers find the line over the run: the spread narrows and the pace creeps down.
    const settling = Math.min(1, (lapNum - 1) / 6);
    const drift = -0.16 * settling;
    const spread = 0.62 - 0.3 * settling;
    const opening = lapNum === 1 ? 2.05 : 0;
    laps.push(round3(driver.basePace + opening + drift + rand() * spread));
  }
  return laps;
}

// ── Page rendering ────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function clockParts(d: Date): { hour12: number; minute: string; meridiem: string } {
  const h = d.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return {
    hour12,
    minute: String(d.getMinutes()).padStart(2, "0"),
    meridiem: h < 12 ? "am" : "pm",
  };
}

/** "Aug 18, 2026 at 2:42pm" — the shape LiveRC uses in results-list rows. */
function listDate(d: Date): string {
  const { hour12, minute, meridiem } = clockParts(d);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${hour12}:${minute}${meridiem}`;
}

/** "Tuesday, 18 August 2026 at 2:42 PM" — the shape LiveRC uses in a session page title. */
function titleDate(d: Date): string {
  const { hour12, minute, meridiem } = clockParts(d);
  const monthLong = d.toLocaleString("en-US", { month: "long" });
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${monthLong} ${d.getFullYear()} at ${hour12}:${minute} ${meridiem.toUpperCase()}`;
}

/**
 * When each race finished, relative to now — so the picker always shows today's race day.
 * Clamped into today: a shoot that starts just after midnight still gets same-day sessions.
 */
function raceCompletedAt(race: DemoRace, now: Date): Date {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const target = new Date(now.getTime() - race.minutesAgo * 60_000);
  target.setSeconds(0, 0);
  return target.getTime() < startOfDay.getTime() + 60_000
    ? new Date(startOfDay.getTime() + 60_000)
    : target;
}

function formatTotalTime(laps: number[]): string {
  const total = laps.reduce((a, b) => a + b, 0);
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  // One decimal place, deliberately: the results row is scanned for the fastest lap by
  // picking the smallest 2-4 decimal number in it, and a 3-decimal total time wins that
  // scan and logs a false "fastest lap mismatch".
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function dashboardPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(DEMO_TRACK_NAME)} :: LiveRC</title></head>
<body>
  <h1>${escapeHtml(DEMO_TRACK_NAME)}</h1>
  <div class="current_event">
    <a href="/results/?p=view_event&amp;id=${DEMO_EVENT_ID}">${escapeHtml(DEMO_EVENT_LABEL)}</a>
  </div>
  <div class="practice_link"><a href="/practice/">Practice Sessions</a></div>
</body>
</html>`;
}

/** Deliberately empty: the demo shows one race session, so practice discovery finds nothing. */
function practiceCalendarPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Practice :: ${escapeHtml(DEMO_TRACK_NAME)} :: LiveRC</title></head>
<body>
  <h1>Practice Sessions</h1>
  <p>No practice sessions have been posted.</p>
</body>
</html>`;
}

function eventHubPage(now: Date): string {
  const rows = RACES.map((race) => {
    const when = raceCompletedAt(race, now);
    return `      <tr>
        <td><a href="/results/?p=view_race_result&amp;id=${race.raceId}">${escapeHtml(race.linkText)}</a></td>
        <td>${escapeHtml(listDate(when))}</td>
      </tr>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(DEMO_EVENT_LABEL)} :: ${escapeHtml(DEMO_TRACK_NAME)} :: LiveRC</title></head>
<body>
  <h1>${escapeHtml(DEMO_EVENT_LABEL)}</h1>
  <table class="event_results">
    <thead><tr><th>Race</th><th>Time Completed</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
}

function raceResultPage(race: DemoRace, now: Date): string {
  const when = raceCompletedAt(race, now);
  const withLaps = race.field.map((driver) => ({ driver, laps: lapsForDriver(driver) }));
  const winnerTotal = withLaps[0]!.laps.reduce((a, b) => a + b, 0);

  const rows = withLaps
    .map(({ driver, laps }, i) => {
      const fastest = Math.min(...laps);
      const behind =
        i === 0 ? "-" : `+${(laps.reduce((a, b) => a + b, 0) - winnerTotal).toFixed(1)}`;
      return `      <tr>
        <td class="position">${i + 1}</td>
        <td class="driver_name">${escapeHtml(driver.name)}</td>
        <td class="laps_time">${laps.length}/${formatTotalTime(laps)}</td>
        <td class="fast_lap">${fastest.toFixed(3)}</td>
        <td class="behind">${behind}</td>
        <td><a class="driver_laps" href="#laps-${driver.driverId}" data-driver-id="${driver.driverId}">Laps</a></td>
      </tr>`;
    })
    .join("\n");

  const lapScript = withLaps
    .map(({ driver, laps }) => {
      const entries = laps.map((t, i) => `{'lapNum':${i + 1},'time':'${t.toFixed(3)}'}`).join(",");
      return `racerLaps[${driver.driverId}] = {'driverName':'${driver.name.replace(/'/g, "")}','laps':[${entries}]};`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(race.linkText)} on ${escapeHtml(titleDate(when))} :: ${escapeHtml(DEMO_TRACK_NAME)} :: LiveRC</title>
</head>
<body>
  <h1>${escapeHtml(DEMO_EVENT_LABEL)}</h1>
  <h2>${escapeHtml(race.linkText)}</h2>
  <table class="race_results">
    <thead><tr><th>Pos</th><th>Driver</th><th>Laps/Time</th><th>Fast Lap</th><th>Behind</th><th></th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <script>
var racerLaps = [];
${lapScript}
  </script>
</body>
</html>`;
}

// ── The seam ──────────────────────────────────────────────────────────────────

export type DemoTimingPage = {
  ok: true;
  text: string;
  contentType: string;
  finalUrl: string;
};

/**
 * Answer a request for the demo track's site, or return null to let the real fetch run.
 * Null for every other host, so a demo shoot can still import from a real timing site.
 * `now` is injectable for tests; production callers never reach here at all.
 */
export function serveDemoTimingPage(url: string, now: Date = new Date()): DemoTimingPage | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== DEMO_TIMING_HOST) return null;

  const page = (text: string): DemoTimingPage => ({
    ok: true,
    text,
    contentType: "text/html; charset=utf-8",
    finalUrl: parsed.toString(),
  });

  const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
  const p = (parsed.searchParams.get("p") ?? "").toLowerCase();
  const id = parsed.searchParams.get("id")?.trim() ?? "";

  if (path === "" || path === "/index.php") return page(dashboardPage());
  if (path === "/practice") return page(practiceCalendarPage());

  if (path === "/results") {
    if (p === "view_race_result") {
      const race = RACES.find((r) => r.raceId === id);
      // An unknown race id is a real 404 on LiveRC too — say so rather than inventing a race.
      return race ? page(raceResultPage(race, now)) : null;
    }
    // Event hub, and the bare results index it falls back to, list the same race day.
    return page(eventHubPage(now));
  }

  return null;
}
