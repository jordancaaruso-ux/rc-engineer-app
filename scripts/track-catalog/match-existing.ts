/**
 * Work out which candidates are tracks the catalog already has, and which pairs of candidates are
 * the same physical place seen by two sources.
 *
 * READ-ONLY — it never writes to the database. The output is a proposal that import-catalog.ts
 * acts on, and only after the founder has confirmed the doubtful ones in the review tool.
 *
 * Why this matters more than it looks: the existing rows are the ones real drivers actually use.
 * Getting a match wrong in the "no match" direction gives a driver two rows for their home track;
 * getting it wrong the other way silently rewrites a track's identity underneath their runs.
 * So only unambiguous evidence auto-confirms, and everything else goes to a human.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/track-catalog/match-existing.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { normalizeTrackName } from "./parseLiveRcAddress";
import type { TrackCandidate } from "./candidateTypes";

const prisma = new PrismaClient();

const CANDIDATES = "seeds/track-catalog/candidates.json";
const OUT = "seeds/track-catalog/matches.json";

/** Same name AND this close = certainly the same place. */
const CONFIDENT_PROXIMITY_M = 2_000;
/** Two sources describing one venue. Tighter, because names differ wildly between them. */
const SAME_PLACE_M = 400;

const EARTH_RADIUS_M = 6_371_000;
function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How much of the shorter name is contained in the longer one, by word.
 * "Southside RC" vs "Southside R/C Raceway" -> 1.0, because every word of the shorter appears.
 * Deliberately not Levenshtein: RC track names differ by whole words ("Raceway", "Club", "Park"),
 * not by typos.
 */
function nameContainment(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 1)
    );
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  const [small, large] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  let hits = 0;
  for (const w of small) if (large.has(w)) hits++;
  return hits / small.size;
}

type ExistingTrack = {
  id: string;
  name: string;
  nameKey: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  liveRcUrl: string | null;
  speedhiveUrl: string | null;
  verifiedAt: Date | null;
  catalogSource: string | null;
  catalogSourceRef: string | null;
  runCount: number;
  eventCount: number;
  favouriteCount: number;
};

type MatchProposal = {
  candidateKey: string;
  candidateName: string;
  trackId: string;
  trackName: string;
  confidence: "confident" | "possible";
  signals: string[];
  distanceM: number | null;
  containment: number;
  existing: {
    location: string | null;
    hasCoordinates: boolean;
    hasTimingLink: boolean;
    runCount: number;
    eventCount: number;
    favouriteCount: number;
  };
};

async function main(): Promise<void> {
  const doc = JSON.parse(fs.readFileSync(CANDIDATES, "utf8")) as { candidates: TrackCandidate[] };
  const candidates = doc.candidates;

  const rows = await prisma.track.findMany({
    select: {
      id: true,
      name: true,
      location: true,
      latitude: true,
      longitude: true,
      liveRcUrl: true,
      speedhiveUrl: true,
      verifiedAt: true,
      catalogSource: true,
      catalogSourceRef: true,
      _count: { select: { runs: true, events: true, favouriteTracks: true } },
    },
  });

  const existing: ExistingTrack[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    nameKey: normalizeTrackName(r.name),
    location: r.location,
    latitude: r.latitude,
    longitude: r.longitude,
    liveRcUrl: r.liveRcUrl,
    speedhiveUrl: r.speedhiveUrl,
    verifiedAt: r.verifiedAt,
    catalogSource: r.catalogSource,
    catalogSourceRef: r.catalogSourceRef,
    runCount: r._count.runs,
    eventCount: r._count.events,
    favouriteCount: r._count.favouriteTracks,
  }));

  console.log(`live catalog: ${existing.length} tracks`);

  const byNameKey = new Map<string, ExistingTrack[]>();
  for (const t of existing) {
    const list = byNameKey.get(t.nameKey) ?? [];
    list.push(t);
    byNameKey.set(t.nameKey, list);
  }

  const proposals: MatchProposal[] = [];
  const alreadySeeded: string[] = [];

  for (const c of candidates) {
    // A row this import already created on a previous run — nothing to match, the key handles it.
    const previous = existing.find(
      (t) => t.catalogSource === c.source && t.catalogSourceRef === c.sourceRef
    );
    if (previous) {
      alreadySeeded.push(c.key);
      continue;
    }

    // The timing link is an identity claim: the same LiveRC subdomain IS the same track.
    const byLink = c.liveRcUrl ? existing.find((t) => t.liveRcUrl === c.liveRcUrl) : undefined;
    if (byLink) {
      proposals.push(buildProposal(c, byLink, ["same-liverc-url"], "confident"));
      continue;
    }

    const nameHits = byNameKey.get(c.nameKey) ?? [];
    const candidateHasPin = c.latitude != null && c.longitude != null;

    let best: { track: ExistingTrack; signals: string[]; confidence: "confident" | "possible" } | null =
      null;

    for (const t of nameHits) {
      const distance =
        candidateHasPin && t.latitude != null && t.longitude != null
          ? haversineMeters(
              { latitude: c.latitude!, longitude: c.longitude! },
              { latitude: t.latitude, longitude: t.longitude }
            )
          : null;

      if (distance != null && distance <= CONFIDENT_PROXIMITY_M) {
        best = { track: t, signals: ["exact-name", "within-2km"], confidence: "confident" };
        break;
      }
      if (distance == null) {
        // Identical name and no coordinates to argue with. Strong, but a human should see it —
        // "RC Raceway" is not a unique string.
        best = best ?? { track: t, signals: ["exact-name", "no-coordinates"], confidence: "possible" };
      } else {
        // Same name, far apart. Two different clubs sharing a common name.
        best = best ?? {
          track: t,
          signals: ["exact-name", `${Math.round(distance / 1000)}km-apart`],
          confidence: "possible",
        };
      }
    }

    // No name match: look for a near-identical place with a similar name.
    if (!best && candidateHasPin) {
      for (const t of existing) {
        if (t.latitude == null || t.longitude == null) continue;
        const distance = haversineMeters(
          { latitude: c.latitude!, longitude: c.longitude! },
          { latitude: t.latitude, longitude: t.longitude }
        );
        if (distance > SAME_PLACE_M) continue;
        const containment = nameContainment(c.name, t.name);
        if (containment >= 0.5) {
          best = {
            track: t,
            signals: [`within-${Math.round(distance)}m`, `name-overlap-${containment.toFixed(2)}`],
            confidence: "possible",
          };
          break;
        }
      }
    }

    if (best) proposals.push(buildProposal(c, best.track, best.signals, best.confidence));
  }

  function buildProposal(
    c: TrackCandidate,
    t: ExistingTrack,
    signals: string[],
    confidence: "confident" | "possible"
  ): MatchProposal {
    const distanceM =
      c.latitude != null && c.longitude != null && t.latitude != null && t.longitude != null
        ? Math.round(
            haversineMeters(
              { latitude: c.latitude, longitude: c.longitude },
              { latitude: t.latitude, longitude: t.longitude }
            )
          )
        : null;
    return {
      candidateKey: c.key,
      candidateName: c.name,
      trackId: t.id,
      trackName: t.name,
      confidence,
      signals,
      distanceM,
      containment: Number(nameContainment(c.name, t.name).toFixed(2)),
      existing: {
        location: t.location,
        hasCoordinates: t.latitude != null,
        hasTimingLink: Boolean(t.liveRcUrl || t.speedhiveUrl),
        runCount: t.runCount,
        eventCount: t.eventCount,
        favouriteCount: t.favouriteCount,
      },
    };
  }

  // ---- Two sources, one venue: a LiveRC row and an OSM element at the same place.
  // Left unhandled this creates a second row for exactly the tracks we know most about.
  const withPins = candidates.filter((c) => c.latitude != null && c.longitude != null);
  const intraSet: { keepKey: string; foldKey: string; distanceM: number; containment: number }[] = [];
  const folded = new Set<string>();

  for (const a of withPins) {
    if (a.source !== "liverc" || folded.has(a.key)) continue;
    for (const b of withPins) {
      if (b.source !== "osm" || folded.has(b.key)) continue;
      const distance = haversineMeters(
        { latitude: a.latitude!, longitude: a.longitude! },
        { latitude: b.latitude!, longitude: b.longitude! }
      );
      if (distance > SAME_PLACE_M) continue;
      // LiveRC keeps the identity — it carries the timing link — but OSM's traced pin is better.
      intraSet.push({
        keepKey: a.key,
        foldKey: b.key,
        distanceM: Math.round(distance),
        containment: Number(nameContainment(a.name, b.name).toFixed(2)),
      });
      folded.add(b.key);
      break;
    }
  }

  /**
   * Two candidates claiming the SAME existing track are two sources describing one venue, and the
   * proximity fold above will have missed them whenever one of the two has a bad pin.
   *
   * Real case from the first run: "Boronia Radio Controlled Car Club" (OSM, pinned 19m from the
   * existing track) and "Boronia Radio Controlled Car Club inc" (LiveRC, geocoded 3.4km off) both
   * matched "Boronia". They are 3.4km apart from each other, so the 400m rule never fired — but
   * they both matched the same row, which is stronger evidence of sameness than distance is.
   *
   * Left alone this is a corruption, not a duplicate: both would update the one track, and the
   * second would overwrite the first's catalogSourceRef. So the LiveRC row keeps the identity (it
   * carries the timing link) and the OSM row folds into it, lending the better pin.
   */
  const byTrackId = new Map<string, MatchProposal[]>();
  for (const p of proposals) {
    const list = byTrackId.get(p.trackId) ?? [];
    list.push(p);
    byTrackId.set(p.trackId, list);
  }
  const contested: { trackId: string; keptKey: string; foldedKeys: string[] }[] = [];
  for (const [trackId, group] of byTrackId) {
    if (group.length < 2) continue;
    const rank = (p: MatchProposal) =>
      (p.signals.includes("same-liverc-url") ? 4 : 0) +
      (p.confidence === "confident" ? 2 : 0) +
      (p.candidateKey.startsWith("liverc:") ? 1 : 0);
    const ordered = [...group].sort((a, b) => rank(b) - rank(a));
    const keeper = ordered[0]!;
    const losers = ordered.slice(1);
    for (const loser of losers) {
      if (folded.has(loser.candidateKey)) continue;
      intraSet.push({
        keepKey: keeper.candidateKey,
        foldKey: loser.candidateKey,
        distanceM: loser.distanceM ?? -1,
        containment: loser.containment,
      });
      folded.add(loser.candidateKey);
    }
    contested.push({
      trackId,
      keptKey: keeper.candidateKey,
      foldedKeys: losers.map((l) => l.candidateKey),
    });
  }
  const dedupedProposals = proposals.filter((p) => !folded.has(p.candidateKey));

  // ---- Duplicates that already exist in the catalog, surfaced by this pass.
  const existingDupes: { nameKey: string; tracks: { id: string; name: string; runCount: number }[] }[] =
    [];
  for (const [nameKey, group] of byNameKey) {
    if (group.length > 1) {
      existingDupes.push({
        nameKey,
        tracks: group.map((t) => ({ id: t.id, name: t.name, runCount: t.runCount })),
      });
    }
  }

  const confident = dedupedProposals.filter((p) => p.confidence === "confident").length;
  const possible = dedupedProposals.filter((p) => p.confidence === "possible").length;

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        existingTrackCount: existing.length,
        candidateCount: candidates.length,
        counts: {
          confident,
          possible,
          noMatch: candidates.length - dedupedProposals.length - folded.size - alreadySeeded.length,
          alreadySeeded: alreadySeeded.length,
          intraSetFolds: intraSet.length,
          contestedTracks: contested.length,
          existingDuplicateClusters: existingDupes.length,
        },
        proposals: dedupedProposals,
        intraSetFolds: intraSet,
        contestedTracks: contested,
        existingDuplicateClusters: existingDupes,
        alreadySeeded,
      },
      null,
      1
    )
  );

  console.log(`matches: ${confident} confident, ${possible} need review`);
  console.log(
    `new tracks: ${candidates.length - dedupedProposals.length - folded.size - alreadySeeded.length}`
  );
  console.log(`already seeded (re-run): ${alreadySeeded.length}`);
  console.log(`same-place folds (two sources, one venue): ${intraSet.length}`);
  if (contested.length > 0) {
    console.log(`  of which ${contested.length} were two candidates claiming one existing track`);
  }
  console.log(`pre-existing duplicate clusters in the catalog: ${existingDupes.length}`);
  console.log(`-> ${OUT}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
