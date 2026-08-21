/**
 * Write the reviewed track catalog into the database.
 *
 * DRY RUN BY DEFAULT — prints the whole plan and changes nothing. Pass --apply to write.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/track-catalog/import-catalog.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/track-catalog/import-catalog.ts --apply
 *
 * Two rules carry the safety of this script:
 *
 *  1. A track a driver already uses is UPDATED IN PLACE, never replaced. Its id never changes, so
 *     every run, event, favourite, layout and video stays attached. The seed fills the blanks —
 *     country, coordinates, timing link — and leaves everything a human set alone. A device GPS
 *     pin in particular always beats a geocode, because a driver standing at the track is a better
 *     source than a street address.
 *  2. `(catalogSource, catalogSourceRef)` is unique, so a second run updates the rows it made
 *     rather than making them again. That is what makes "seed once, top up by hand" safe.
 *
 * Every change is recorded in seeds/track-catalog/undo-<timestamp>.json with the previous value of
 * each field touched, so an --apply can be reversed field by field.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import type { TrackCandidate } from "./candidateTypes";

const prisma = new PrismaClient();

const DIR = "seeds/track-catalog";
const APPLY = process.argv.includes("--apply");

/** Owner of every seeded row. Must not look like a demo or `+ob…` throwaway account, or
 *  `trackCatalogScopeWhere()` would hide the entire catalog from real users. */
const SYSTEM_EMAIL = "catalog@jrcdynamics.com";
const SYSTEM_NAME = "Track catalog";

type Decision = { verdict: "accept" | "reject"; name?: string; merge?: boolean; trackId?: string };
type Matches = {
  proposals: {
    candidateKey: string;
    trackId: string;
    trackName: string;
    confidence: "confident" | "possible";
  }[];
  intraSetFolds: { keepKey: string; foldKey: string }[];
};

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** The free-text `location` the app shows: "Town, ST". Country is its own column now. */
function locationText(c: TrackCandidate): string | null {
  const parts = [c.city, c.region].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

async function main(): Promise<void> {
  const doc = readJson<{ candidates: TrackCandidate[] }>(`${DIR}/candidates.json`, {
    candidates: [],
  });
  const matches = readJson<Matches>(`${DIR}/matches.json`, { proposals: [], intraSetFolds: [] });
  const decisions = readJson<Record<string, Decision>>(`${DIR}/decisions.json`, {});

  const byKey = new Map(doc.candidates.map((c) => [c.key, c]));

  // An OSM element that is the same physical place as a LiveRC row: it does not become its own
  // track, it lends its traced coordinates to the row that carries the timing link.
  const foldedInto = new Map<string, TrackCandidate>();
  const foldedAway = new Set<string>();
  for (const fold of matches.intraSetFolds ?? []) {
    const donor = byKey.get(fold.foldKey);
    if (donor) {
      foldedInto.set(fold.keepKey, donor);
      foldedAway.add(fold.foldKey);
    }
  }

  const proposalByKey = new Map((matches.proposals ?? []).map((p) => [p.candidateKey, p]));

  const accepted = doc.candidates.filter((c) => {
    if (foldedAway.has(c.key)) return false;
    const d = decisions[c.key];
    return d?.verdict === "accept";
  });

  const undecided = doc.candidates.filter(
    (c) => !foldedAway.has(c.key) && !decisions[c.key]
  ).length;
  const rejected = Object.values(decisions).filter((d) => d.verdict === "reject").length;

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${accepted.length} accepted, ${rejected} rejected, ${undecided} still undecided`);
  if (undecided > 0) {
    console.log(`  (undecided rows are skipped; run the review tool to clear them)`);
  }
  if (accepted.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // ---- system account
  let systemUser = await prisma.user.findUnique({ where: { email: SYSTEM_EMAIL } });
  if (!systemUser) {
    console.log(`  system account ${SYSTEM_EMAIL} does not exist — will be created`);
    if (APPLY) {
      systemUser = await prisma.user.create({
        data: { email: SYSTEM_EMAIL, name: SYSTEM_NAME },
      });
    }
  }

  const existingByKey = new Map<string, { id: string }>();
  const alreadySeeded = await prisma.track.findMany({
    where: { catalogSource: { not: null } },
    select: { id: true, catalogSource: true, catalogSourceRef: true },
  });
  for (const t of alreadySeeded) {
    existingByKey.set(`${t.catalogSource}:${t.catalogSourceRef}`, { id: t.id });
  }

  const undo: unknown[] = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const samples: string[] = [];

  for (const c of accepted) {
    const decision = decisions[c.key]!;
    const donor = foldedInto.get(c.key);

    // A traced OSM pin beats a geocoded street address every time.
    const latitude = donor?.latitude ?? c.latitude;
    const longitude = donor?.longitude ?? c.longitude;
    const coordinateSource = donor ? "osm" : c.coordinateSource;

    const name = decision.name?.trim() || c.name;
    const proposal = proposalByKey.get(c.key);
    const mergeTargetId =
      decision.merge === false
        ? null
        : (decision.trackId ?? (proposal?.confidence === "confident" ? proposal.trackId : null));

    const seededId = existingByKey.get(c.key)?.id ?? null;
    const targetId = seededId ?? mergeTargetId;

    if (!targetId) {
      // ---- create
      if (samples.length < 8) samples.push(`  + ${name} — ${locationText(c) ?? "?"} (${c.countryCode ?? "?"})`);
      created++;
      if (APPLY && systemUser) {
        const track = await prisma.track.create({
          data: {
            name,
            location: locationText(c),
            countryCode: c.countryCode,
            region: c.region,
            latitude,
            longitude,
            locationSource: latitude != null ? coordinateSource : null,
            locationMarkedAt: latitude != null ? new Date() : null,
            liveRcUrl: c.liveRcUrl,
            catalogSource: c.source,
            catalogSourceRef: c.sourceRef,
            verifiedAt: new Date(),
            userId: systemUser.id,
          },
        });
        undo.push({ action: "created", trackId: track.id, key: c.key });
      }
      continue;
    }

    // ---- update in place
    const current = await prisma.track.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        name: true,
        location: true,
        countryCode: true,
        region: true,
        latitude: true,
        longitude: true,
        locationSource: true,
        locationMarkedAt: true,
        liveRcUrl: true,
        catalogSource: true,
        catalogSourceRef: true,
        verifiedAt: true,
      },
    });
    if (!current) {
      console.warn(`  ! ${c.key}: target track ${targetId} no longer exists — skipped`);
      continue;
    }

    const data: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};

    const set = (field: string, value: unknown, currentValue: unknown) => {
      if (value == null || value === currentValue) return;
      data[field] = value;
      before[field] = currentValue;
    };

    // The reviewer's rename is the only thing that overwrites a name drivers already recognise.
    if (decision.name && decision.name.trim() !== current.name) {
      set("name", decision.name.trim(), current.name);
    }
    if (!current.location) set("location", locationText(c), current.location);
    set("countryCode", c.countryCode, current.countryCode);
    set("region", c.region, current.region);
    if (!current.liveRcUrl) set("liveRcUrl", c.liveRcUrl, current.liveRcUrl);
    if (!current.verifiedAt) set("verifiedAt", new Date(), current.verifiedAt);
    set("catalogSource", c.source, current.catalogSource);
    set("catalogSourceRef", c.sourceRef, current.catalogSourceRef);

    // A driver's device pin was taken standing at the track. Never replace it with a geocode.
    const currentPinIsFromDevice = current.locationSource === "device";
    const currentHasPin = current.latitude != null && current.longitude != null;
    if (latitude != null && longitude != null && !currentPinIsFromDevice) {
      const better = !currentHasPin || (coordinateSource === "osm" && current.locationSource === "geocode");
      if (better) {
        set("latitude", latitude, current.latitude);
        set("longitude", longitude, current.longitude);
        set("locationSource", coordinateSource, current.locationSource);
        set("locationMarkedAt", new Date(), current.locationMarkedAt);
      }
    }

    if (Object.keys(data).length === 0) {
      unchanged++;
      continue;
    }

    updated++;
    if (samples.length < 8) {
      samples.push(`  ~ ${current.name} → ${Object.keys(data).join(", ")}`);
    }
    if (APPLY) {
      await prisma.track.update({ where: { id: targetId }, data });
      undo.push({ action: "updated", trackId: targetId, key: c.key, before });
    }
  }

  console.log("");
  console.log(`create: ${created}   update: ${updated}   already correct: ${unchanged}`);
  if (samples.length) {
    console.log("sample of the plan:");
    for (const s of samples) console.log(s);
  }

  if (APPLY) {
    const file = `${DIR}/undo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    fs.writeFileSync(file, JSON.stringify({ appliedAt: new Date().toISOString(), undo }, null, 1));
    console.log(`\nundo record -> ${file}`);
    console.log("Remember: POST /api/setup-aggregations/rebuild after any merge repointed runs.");
  } else {
    console.log("\nNothing written. Re-run with --apply to commit this plan.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
