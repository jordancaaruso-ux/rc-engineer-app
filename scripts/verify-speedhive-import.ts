/**
 * Live verification for the Speedhive lap import path — the exact code a user hits when they
 * paste a speedhive.mylaps.com session URL into Log run (LapTimesIngestPanel → /api/lap-time-sessions/import
 * → parseTimingUrl → speedhiveParser → importSpeedhiveSession → api2.mylaps.com).
 *
 * No DB, no auth — exercises the parser registry + live MYLAPS API and cross-checks the parsed
 * laps against the session's own classification (bestTime / numberOfLaps), so a pass means a
 * real user pasting this URL gets the right laps for the right driver.
 *
 * Run:   node --conditions=react-server --import tsx scripts/verify-speedhive-import.ts
 *        node --conditions=react-server --import tsx scripts/verify-speedhive-import.ts <session-url>
 *
 * Without a URL it self-discovers a recent completed session from the public events feed, so the
 * check stays evergreen (yesterday's fixture session never goes stale).
 */
import { selectUrlParser, parseTimingUrl } from "@/lib/lapUrlParsers/registry";
import { parseSpeedhiveSessionRef } from "@/lib/speedhive/speedhiveUrl";
import {
  fetchEventSessions,
  fetchSessionClassification,
  parseSpeedhiveLapTimeSeconds,
} from "@/lib/speedhive/speedhiveClient";
import { transponderNumberFromClassificationRow } from "@/lib/speedhive/speedhiveTransponder";
import { inferSourceType, isImportableParse } from "@/lib/lapImport/service";

const EVENTS_FEED = "https://eventresults-api.speedhive.com/api/v0.2.3/eventresults/events?count=30";

/** Fields present on live classification rows but not in the client's minimal type. */
function lapCountOfRow(row: unknown): number | null {
  const n = (row as { numberOfLaps?: unknown }).numberOfLaps;
  return typeof n === "number" && n > 0 ? n : null;
}

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  const mark = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Find a recent completed session (has classification rows + laps) from the public feed. */
async function discoverCompletedSessionUrl(): Promise<string> {
  const res = await fetch(EVENTS_FEED, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`events feed HTTP ${res.status}`);
  const events = (await res.json()) as Array<{ id: number; startDate?: string; name?: string }>;
  const today = new Date().toISOString().slice(0, 10);
  const past = events.filter((e) => (e.startDate ?? "9999") <= today);

  for (const ev of past.slice(0, 8)) {
    const sessions = await fetchEventSessions(ev.id).catch(() => []);
    // Prefer races/practice with a real startTime; "points" pseudo-sessions have epoch times.
    const candidates = sessions.filter(
      (s) => (s.type === "race" || s.type === "practice") && (s.startTime ?? "").startsWith("2")
    );
    for (const s of candidates.slice(0, 6)) {
      const rows = await fetchSessionClassification(s.id).catch(() => []);
      if (rows.length >= 2 && rows.some((r) => r.bestTime?.trim())) {
        console.log(
          `Discovered session: "${s.name}" (${s.type}) at event "${ev.name}" — ${rows.length} drivers`
        );
        return `https://speedhive.mylaps.com/events/${ev.id}/sessions/${s.id}`;
      }
    }
  }
  throw new Error("No completed session with classification found in recent public events.");
}

async function main() {
  const url = process.argv[2]?.trim() || (await discoverCompletedSessionUrl());
  console.log(`\nVerifying: ${url}\n`);

  // 1. Routing — the registry must hand this URL to the Speedhive parser, and the import
  //    service must tag the stored row sourceType "speedhive" (drives the source chip in Log run).
  console.log("Routing");
  const parser = selectUrlParser(url);
  check("registry routes to speedhive_api_v1", parser.id === "speedhive_api_v1", `got ${parser.id}`);
  check('inferSourceType → "speedhive"', inferSourceType(url) === "speedhive");
  const ref = parseSpeedhiveSessionRef(url);
  check("session ref parsed", ref != null, ref ? `sessionId=${ref.sessionId}` : "null");
  if (!ref) return;

  // Ground truth straight from the API, independent of the parser.
  const classification = await fetchSessionClassification(ref.sessionId);
  const rowsWithLaps = classification.filter((r) => lapCountOfRow(r) != null || r.bestTime?.trim());

  // 2. Anonymous parse (no driver identity) — what a user with no Speedhive settings gets.
  console.log("\nParse (no identity)");
  const anon = await parseTimingUrl(url);
  check("parser id", anon.parserId === "speedhive_api_v1", anon.parserId);
  check("importable (laps or sessionDrivers)", isImportableParse(anon), anon.message ?? undefined);
  const drivers = anon.sessionDrivers ?? [];
  check(
    "one sessionDriver per classified driver with laps",
    drivers.length > 0 && drivers.length <= classification.length,
    `${drivers.length} drivers vs ${classification.length} classification rows`
  );
  check(
    "primary laps = first sessionDriver laps",
    JSON.stringify(anon.laps) === JSON.stringify(drivers[0]?.laps)
  );

  // 3. Lap fidelity — parsed laps must reproduce each driver's classification stats.
  console.log("\nLap fidelity vs classification");
  let checkedDrivers = 0;
  for (const d of drivers) {
    const pos = Number(d.driverId.split("-").pop());
    const row = classification.find((r) => r.position === pos);
    if (!row) continue;
    checkedDrivers++;
    const best = row.bestTime ? parseSpeedhiveLapTimeSeconds(row.bestTime) : null;
    const parsedBest = Math.min(...d.laps);
    if (best != null) {
      check(
        `P${pos} ${d.driverName}: best lap matches (${best.toFixed(3)})`,
        Math.abs(parsedBest - best) < 0.0015,
        `parsed ${parsedBest.toFixed(3)}`
      );
    }
    const wantLaps = lapCountOfRow(row);
    if (wantLaps != null) {
      check(
        `P${pos} ${d.driverName}: lap count ${wantLaps}`,
        d.laps.length === wantLaps,
        `parsed ${d.laps.length}`
      );
    }
    check(
      `P${pos} laps sane (3s–15min, positive)`,
      d.laps.every((t) => t > 3 && t < 900)
    );
  }
  check("cross-checked at least one driver", checkedDrivers > 0, `${checkedDrivers} of ${rowsWithLaps.length}`);

  // 4. Driver matching — pretend to be a mid-field driver, by name then by transponder.
  //    This is the server-side half of "the right row is selected for the user".
  console.log("\nDriver identity matching");
  const target = classification.find(
    (r) => r.position && r.position > 1 && r.name?.trim() && drivers.some((d) => d.driverId.endsWith(`-${r.position}`))
  );
  if (target) {
    const byName = await parseTimingUrl(url, { driverName: target.name });
    check(
      `driverName "${target.name}" selects P${target.position}`,
      byName.sessionHint?.name === drivers.find((d) => d.driverId.endsWith(`-${target.position}`))?.driverName,
      `hint=${byName.sessionHint?.name}`
    );
    // Settings store transponders as number[] (parseSpeedhiveTransponderNumbersSetting) — mirror that.
    const tpRaw = transponderNumberFromClassificationRow(target);
    const tp = tpRaw != null ? Number(tpRaw) : null;
    if (tp != null && Number.isFinite(tp)) {
      const byTp = await parseTimingUrl(url, { speedhiveTransponderNumbers: [tp] });
      check(
        `transponder ${tp} selects P${target.position}`,
        byTp.sessionHint?.name === drivers.find((d) => d.driverId.endsWith(`-${target.position}`))?.driverName,
        `hint=${byTp.sessionHint?.name}`
      );
    } else {
      console.log("  [SKIP] no transponder on target row");
    }
  } else {
    console.log("  [SKIP] no non-P1 named driver to test matching with");
  }

  // 5. Session time — LiveRC supplies sessionCompletedAtIso; parity says Speedhive should too.
  //    (Known gap: parser reads startTime off classification rows, which never carry it.)
  console.log("\nSession time");
  check(
    "sessionCompletedAtIso present (LiveRC parity)",
    typeof anon.sessionCompletedAtIso === "string" && !!anon.sessionCompletedAtIso,
    String(anon.sessionCompletedAtIso)
  );

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("verify-speedhive-import crashed:", e);
  process.exitCode = 1;
});
