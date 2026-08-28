/**
 * seed-demo-account.ts — build the shared read-only DEMO account from the founder's real
 * season (docs/MONETISATION_NORTH_STAR.md Phase 3). FOUNDER-RUN, like launch-live-stripe.ts.
 *
 *   npm run demo:seed -- --confirm-host=<db host>          # refuses without the matching host
 *   npm run demo:seed -- --confirm-host=... --months=7     # season window (default 7)
 *   npm run demo:seed -- --confirm-host=... --lag-days=2   # where the season ends (default 2)
 *
 * What it does, idempotently (wipe-and-reseed keyed STRICTLY by the fixed demo user id):
 *   1. Deletes + recreates the demo User (fixed id ⇒ live demo JWTs survive a reseed),
 *      with AuthAllowedEmail (sign-in gate) and a fake active Pro Subscription (entitlement).
 *   2. Copies the founder's last N months: cars, tracks(+layouts), race meetings, tire sets,
 *      setup snapshots (incl. base chain + car libraries), lap-import sessions, runs, lap sets +
 *      laps, between-run hints + dashboard suggestions, action items, event participations,
 *      and the curated Engineer threads listed in scripts/demo-curation-overlay.json.
 *   3. Anonymizes as it copies (word-boundary name table + transponder masking, deep into
 *      JSON payloads), then applies the founder's per-run overlay text on top.
 *   4. Anchors the whole season forward so its newest run sits `--lag-days` behind today
 *      (src/lib/demo/demoDateShift.ts — a frozen copy reads as a dead account within weeks).
 *
 * Deliberately NOT copied: batteries (feature retired), setup documents/calibrations (blob
 * PDFs can carry the founder's name in the sheet itself — runs render from snapshot JSON
 * without them), rendered setup PDFs (same reason), MyLaps/timing tokens, push devices.
 *
 * Events ARE copied as of 2026-08-25 — they used to be reused as global rows, which put the
 * founder's real name on the demo's Teammates card via shared-event co-presence, and pinned the
 * demo's runs to meetings the season shift cannot move. See the clone block below.
 *
 * Caches: Run.engineerSummaryJson rides along on the run rows. Hint/suggestion rows are
 * copied but their inputFingerprint hashes the OLD ids, so the first demo view of a page may
 * recompute (bounded by the demo account's own AI budgets). The founder's eyeball pass warms
 * the hot pages naturally.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  applyRunOverlay,
  buildScrubber,
  deepScrub,
  type CurationOverlay,
} from "@/lib/demo/anonymize";
import { demoCatalogUserId } from "@/lib/demo/demoAccess";
import { refreshDemoSeasonDates, settleDemoThreadDates } from "@/lib/demo/applyDemoDateShift";
import { DEMO_RECENCY_LAG_DAYS } from "@/lib/demo/demoDateShift";

// ── Config ────────────────────────────────────────────────────────────────────
const SOURCE_USER_ID = "cmo75nzr60000vl5kvr0rqhej"; // the founder
// Shared with the catalog scope filter — demo-owned tracks are hidden from the community list.
const DEMO_USER_ID = demoCatalogUserId();
const DEMO_USER_EMAIL = process.env.DEMO_USER_EMAIL?.trim() || "demo@jrcdynamics.com";
const DEMO_DRIVER_NAME = process.env.DEMO_DRIVER_NAME?.trim() || "Nic Swole"; // founder pick 2026-08-02
const DEFAULT_NAME_SCRUB = [
  { from: "Jordan Caruso", to: DEMO_DRIVER_NAME },
  { from: "Caruso", to: DEMO_DRIVER_NAME.split(" ").pop() ?? DEMO_DRIVER_NAME },
  { from: "Jordan", to: DEMO_DRIVER_NAME.split(" ")[0] ?? DEMO_DRIVER_NAME },
  { from: "jordancaaruso", to: "demodriver" },
];

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const months = Math.max(1, Number(argValue("months") ?? 7) || 7);
/** How far behind today the copied season's newest run should end up. */
const lagDays = Math.max(0, Number(argValue("lag-days") ?? DEMO_RECENCY_LAG_DAYS) || DEMO_RECENCY_LAG_DAYS);

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`\nDatabase host: ${dbHost}`);
  if (argValue("confirm-host") !== dbHost) {
    console.error(
      `Refusing to run: pass --confirm-host=${dbHost} to confirm you mean THIS database.`,
    );
    process.exit(1);
  }

  const overlayPath = path.join(__dirname, "demo-curation-overlay.json");
  const overlay: CurationOverlay = JSON.parse(readFileSync(overlayPath, "utf8"));
  const scrub = buildScrubber([...DEFAULT_NAME_SCRUB, ...(overlay.nameScrub ?? [])]);
  const scrubJson = <T>(v: T): T => (v == null ? v : deepScrub(v, scrub));

  const since = new Date();
  since.setMonth(since.getMonth() - months);
  console.log(`Season window: since ${since.toISOString().slice(0, 10)} (${months} months)`);
  console.log(`Demo user: ${DEMO_USER_ID} <${DEMO_USER_EMAIL}> "${DEMO_DRIVER_NAME}"\n`);

  // ── 1. Wipe + recreate the demo account ─────────────────────────────────────
  const existing = await prisma.user.findUnique({ where: { id: DEMO_USER_ID }, select: { id: true } });
  if (existing) {
    await prisma.user.delete({ where: { id: DEMO_USER_ID } });
    console.log("Deleted previous demo user (cascade).");
  }
  await prisma.user.create({
    data: { id: DEMO_USER_ID, email: DEMO_USER_EMAIL, name: DEMO_DRIVER_NAME },
  });
  await prisma.authAllowedEmail.upsert({
    where: { email: DEMO_USER_EMAIL },
    create: { email: DEMO_USER_EMAIL },
    update: {},
  });
  await prisma.subscription.create({
    data: {
      userId: DEMO_USER_ID,
      stripeSubscriptionId: "demo_sub_00000001",
      stripeCustomerId: "demo_cus_00000001",
      status: "active",
      tier: "pro",
      currentPeriodEnd: new Date("2099-01-01T00:00:00Z"),
      cancelAtPeriodEnd: false,
    },
  });

  // ── 2. Collect the source graph ─────────────────────────────────────────────
  const runs = await prisma.run.findMany({
    where: { userId: SOURCE_USER_ID, sortAt: { gte: since } },
    orderBy: { sortAt: "asc" },
  });
  console.log(`Source runs in window: ${runs.length}`);

  const carIds = new Set(runs.map((r) => r.carId).filter(Boolean) as string[]);
  const trackIds = new Set(runs.map((r) => r.trackId).filter(Boolean) as string[]);
  const tireSetIds = new Set(runs.map((r) => r.tireSetId).filter(Boolean) as string[]);
  const iltsIds = new Set(
    runs.map((r) => r.importedLapTimeSessionId).filter(Boolean) as string[],
  );
  const eventIds = new Set(runs.map((r) => r.eventId).filter(Boolean) as string[]);

  // Setup snapshots: every run's snapshot + base chains + the cars' library setups.
  const snapshotIds = new Set(runs.map((r) => r.setupSnapshotId));
  const librarySnapshots = await prisma.setupSnapshot.findMany({
    where: { userId: SOURCE_USER_ID, isLibrary: true, carId: { in: [...carIds] } },
  });
  for (const s of librarySnapshots) snapshotIds.add(s.id);
  // Base-chain closure (bounded walk).
  for (let i = 0; i < 5; i++) {
    const batch = await prisma.setupSnapshot.findMany({
      where: { id: { in: [...snapshotIds] } },
      select: { baseSetupSnapshotId: true },
    });
    const before = snapshotIds.size;
    for (const b of batch) if (b.baseSetupSnapshotId) snapshotIds.add(b.baseSetupSnapshotId);
    if (snapshotIds.size === before) break;
  }

  const [cars, tracks, layouts, tireSets, snapshots, iltsRows, events] = await Promise.all([
    prisma.car.findMany({ where: { id: { in: [...carIds] } } }),
    prisma.track.findMany({ where: { id: { in: [...trackIds] } } }),
    prisma.trackLayout.findMany({ where: { trackId: { in: [...trackIds] } } }),
    prisma.tireSet.findMany({ where: { id: { in: [...tireSetIds] } } }),
    prisma.setupSnapshot.findMany({ where: { id: { in: [...snapshotIds] } } }),
    prisma.importedLapTimeSession.findMany({ where: { id: { in: [...iltsIds] } } }),
    prisma.event.findMany({ where: { id: { in: [...eventIds] } } }),
  ]);

  // ── 3. Copy with an id map ──────────────────────────────────────────────────
  const idMap = new Map<string, string>();
  const remap = (oldId: string | null | undefined): string | null =>
    oldId ? idMap.get(oldId) ?? null : null;
  const newId = (oldId: string): string => {
    const id = `demo${randomBytes(10).toString("hex")}${createHash("sha1").update(oldId).digest("hex").slice(0, 4)}`;
    idMap.set(oldId, id);
    return id;
  };
  const strip = <T extends { id: string; userId?: string | null; createdAt?: Date; updatedAt?: Date }>(
    row: T,
  ) => {
    const { id, userId, ...rest } = row as Record<string, unknown> & T;
    void id;
    void userId;
    return rest as Omit<T, "id" | "userId">;
  };
  /**
   * Prisma rejects a plain JS `null` for nullable Json columns on create — a read gives
   * `null` for DB NULL, a write demands the `DbNull` marker. Convert the named keys in place.
   */
  const fixJsonNulls = <T extends Record<string, unknown>>(row: T, keys: string[]): T => {
    const out: Record<string, unknown> = { ...row };
    for (const k of keys) {
      if (k in out && out[k] === null) out[k] = Prisma.DbNull;
    }
    return out as T;
  };
  const RUN_JSON_KEYS = [
    "tirePrep",
    "lapTimes",
    "lapSession",
    "handlingAssessmentJson",
    "engineerSummaryJson",
    "engineerDeepDiveJson",
  ];

  for (const t of tracks) {
    await prisma.track.create({
      data: { ...strip(t), id: newId(t.id), userId: DEMO_USER_ID },
    });
  }
  for (const l of layouts) {
    await prisma.trackLayout.create({
      data: { ...strip(l), id: newId(l.id), trackId: remap(l.trackId)!, userId: DEMO_USER_ID },
    });
  }
  for (const c of cars) {
    await prisma.car.create({
      data: { ...strip(c), id: newId(c.id), userId: DEMO_USER_ID, notes: c.notes ? scrub(c.notes) : c.notes },
    });
  }
  for (const ts of tireSets) {
    await prisma.tireSet.create({
      data: { ...strip(ts), id: newId(ts.id), userId: DEMO_USER_ID, notes: ts.notes ? scrub(ts.notes) : ts.notes },
    });
  }

  /*
   * Events used to be reused rather than copied — "events are global per track/meeting", which
   * is true of the model and was wrong for the demo, in two ways at once.
   *
   * 1. It leaked. `loadOutWithYou` finds other drivers by shared event, so a demo run pinned to
   *    the founder's real "TFTR Clubday" put his real name and best lap on the demo's Teammates
   *    card, in front of every anonymous visitor. Measured on production 2026-08-25. Any other
   *    driver at those ten meetings would surface the same way.
   * 2. It froze. A shared meeting cannot be moved by the season shift — moving it would drag
   *    the date under every real driver who raced it — so a shifted run would sit at a meeting
   *    still dated last winter.
   *
   * Cloned events are demo-owned and hang off the demo's own cloned tracks, and BOTH event
   * discovery queries (`findEventByTrackAndResultsUrl`, `findJoinableTeamEvent`) are scoped by
   * trackId, so no real user can reach them. Timing-source URLs come across so the meeting
   * still reads as real; they are never polled for the demo account.
   */
  for (const e of events) {
    await prisma.event.create({
      data: {
        ...strip(e),
        id: newId(e.id),
        userId: DEMO_USER_ID,
        name: scrub(e.name),
        trackId: remap(e.trackId),
        trackLayoutId: remap(e.trackLayoutId),
        trackNameSnapshot: e.trackNameSnapshot ? scrub(e.trackNameSnapshot) : e.trackNameSnapshot,
        legacyTrackJson: scrubJson(e.legacyTrackJson) as Prisma.InputJsonValue | undefined ?? undefined,
      },
    });
  }
  console.log(`Cloned ${events.length} race meetings (demo-owned — no shared rows with the founder).`);

  // Snapshots pass 1 (base links null), pass 2 patches them.
  for (const s of snapshots) {
    await prisma.setupSnapshot.create({
      data: {
        ...strip(s),
        id: newId(s.id),
        userId: DEMO_USER_ID,
        carId: remap(s.carId),
        baseSetupSnapshotId: null,
        data: scrubJson(s.data) as object,
        setupDeltaJson: scrubJson(s.setupDeltaJson) as object | undefined ?? undefined,
        // Rendered sheet PDFs carry the founder's name in the sheet itself — drop them.
        renderedSetupPdfPath: null,
        renderedSetupPdfGeneratedAt: null,
      },
    });
  }
  for (const s of snapshots) {
    if (s.baseSetupSnapshotId && idMap.has(s.baseSetupSnapshotId)) {
      await prisma.setupSnapshot.update({
        where: { id: idMap.get(s.id)! },
        data: { baseSetupSnapshotId: idMap.get(s.baseSetupSnapshotId)! },
      });
    }
  }

  for (const ilts of iltsRows) {
    await prisma.importedLapTimeSession.create({
      data: {
        ...fixJsonNulls(strip(ilts) as Record<string, unknown>, ["parsedPayload", "fieldStatsJson"]),
        id: newId(ilts.id),
        userId: DEMO_USER_ID,
        linkedRunId: null, // runs point at ILTS, not vice versa — safe to leave null
        // Remapped onto the demo's own event clone. A session whose event fell outside the
        // season window has no clone to point at and is unlinked rather than left pointing at
        // the founder's global row — same leak the run copy below used to have.
        linkedEventId: remap((ilts as { linkedEventId?: string | null }).linkedEventId ?? null),
        parsedPayload: scrubJson(ilts.parsedPayload) as Prisma.InputJsonValue,
      } as Prisma.ImportedLapTimeSessionUncheckedCreateInput,
    });
  }

  let runCount = 0;
  for (const r of runs) {
    const curated = applyRunOverlay(
      {
        ...r,
        notes: r.notes ? scrub(r.notes) : r.notes,
        driverNotes: r.driverNotes ? scrub(r.driverNotes) : r.driverNotes,
      },
      overlay.runs?.[r.id],
    );
    const scrubbedJson = {
      lapSession: r.lapSession === null ? Prisma.DbNull : (scrubJson(r.lapSession) as Prisma.InputJsonValue),
      handlingAssessmentJson:
        r.handlingAssessmentJson === null
          ? Prisma.DbNull
          : (scrubJson(r.handlingAssessmentJson) as Prisma.InputJsonValue),
      engineerSummaryJson:
        r.engineerSummaryJson === null
          ? Prisma.DbNull
          : (scrubJson(r.engineerSummaryJson) as Prisma.InputJsonValue),
    };
    await prisma.run.create({
      data: {
        ...fixJsonNulls(strip(curated) as Record<string, unknown>, RUN_JSON_KEYS),
        id: newId(r.id),
        userId: DEMO_USER_ID,
        carId: remap(r.carId),
        trackId: remap(r.trackId),
        trackLayoutId: remap(r.trackLayoutId),
        tireSetId: remap(r.tireSetId),
        setupSnapshotId: remap(r.setupSnapshotId)!,
        importedLapTimeSessionId: remap(r.importedLapTimeSessionId),
        eventId: remap(r.eventId), // the demo's own clone — never the founder's shared row
        batteryId: null,
        sourceSetupDocumentId: null,
        sourceSetupCalibrationId: null,
        ...scrubbedJson,
      } as Prisma.RunUncheckedCreateInput,
    });
    runCount++;
  }
  console.log(`Copied ${runCount} runs (+${cars.length} cars, ${tracks.length} tracks, ${snapshots.length} snapshots, ${iltsRows.length} lap sessions).`);

  // Lap sets + laps.
  const lapSets = await prisma.runImportedLapSet.findMany({
    where: { runId: { in: runs.map((r) => r.id) } },
    include: { laps: true },
  });
  for (const set of lapSets) {
    const { laps, ...setRow } = set;
    const setNewId = newId(set.id);
    await prisma.runImportedLapSet.create({
      data: {
        ...strip(setRow as typeof setRow & { userId?: string }),
        id: setNewId,
        runId: remap(set.runId)!,
        driverName: set.isPrimaryUser ? DEMO_DRIVER_NAME : scrub(set.driverName),
        normalizedName: set.isPrimaryUser
          ? DEMO_DRIVER_NAME.toLowerCase()
          : scrub(set.normalizedName),
      },
    });
    for (const lap of laps) {
      const { id: lapId, lapSetId, ...lapRest } = lap;
      void lapId;
      void lapSetId;
      await prisma.runImportedLap.create({ data: { ...lapRest, lapSetId: setNewId } });
    }
  }
  console.log(`Copied ${lapSets.length} lap sets.`);

  // Between-run hints + dashboard suggestions (stale fingerprints recompute lazily).
  const [hints, suggestions] = await Promise.all([
    prisma.engineerBetweenRunHint.findMany({ where: { primaryRunId: { in: runs.map((r) => r.id) } } }),
    prisma.engineerDashboardSuggestion.findMany({ where: { primaryRunId: { in: runs.map((r) => r.id) } } }),
  ]);
  for (const h of hints) {
    await prisma.engineerBetweenRunHint.create({
      data: {
        ...strip(h),
        id: newId(h.id),
        userId: DEMO_USER_ID,
        primaryRunId: remap(h.primaryRunId)!,
        referenceRunId: remap((h as { referenceRunId?: string | null }).referenceRunId ?? null),
        payloadJson: scrubJson(h.payloadJson) as object,
      },
    });
  }
  for (const s of suggestions) {
    await prisma.engineerDashboardSuggestion.create({
      data: {
        ...strip(s),
        id: newId(s.id),
        userId: DEMO_USER_ID,
        primaryRunId: remap(s.primaryRunId)!,
        payloadJson: scrubJson(s.payloadJson) as Prisma.InputJsonValue,
      },
    });
  }

  // Action items (the dashboard's test plan / reminders).
  const actionItems = await prisma.actionItem.findMany({
    where: { userId: SOURCE_USER_ID, isArchived: false },
  });
  for (const a of actionItems) {
    await prisma.actionItem.create({
      data: {
        ...strip(a),
        id: newId(a.id),
        userId: DEMO_USER_ID,
        text: scrub(a.text),
        normKey: scrub(a.normKey),
        sourceRunId: remap(a.sourceRunId),
      },
    });
  }

  // Event participations for the season's events.
  const participations = await prisma.eventParticipation.findMany({
    where: { userId: SOURCE_USER_ID, eventId: { in: [...eventIds] } },
  });
  for (const p of participations) {
    const { id, userId, ...rest } = p as Record<string, unknown> & typeof p;
    void id;
    void userId;
    // `eventId` is required, so a participation whose meeting was not cloned is dropped rather
    // than written against the founder's global row.
    const eventId = remap(p.eventId);
    if (!eventId) continue;
    await prisma.eventParticipation.create({
      data: { ...(scrubJson(rest) as typeof rest), userId: DEMO_USER_ID, eventId },
    });
  }

  // Curated Engineer threads (founder-picked ids in the overlay).
  let threadCount = 0;
  for (const threadId of overlay.includeThreadIds ?? []) {
    const thread = await prisma.engineerChatThread.findFirst({
      where: { id: threadId, userId: SOURCE_USER_ID },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!thread) {
      console.warn(`  overlay thread ${threadId} not found — skipped`);
      continue;
    }
    const { messages, ...threadRow } = thread;
    const created = await prisma.engineerChatThread.create({
      data: {
        ...strip(threadRow),
        id: newId(thread.id),
        userId: DEMO_USER_ID,
        primaryRunId: remap(thread.primaryRunId) ?? undefined,
        compareRunId: remap(thread.compareRunId) ?? undefined,
        focusAnchorJson: scrubJson(remapJsonIds(thread.focusAnchorJson, idMap)) as object | undefined ?? undefined,
      },
    });
    for (const m of messages) {
      const { id, threadId: tid, ...rest } = m as Record<string, unknown> & typeof m;
      void id;
      void tid;
      await prisma.engineerChatMessage.create({
        data: {
          ...rest,
          threadId: created.id,
          content: scrub(m.content),
          metadataJson: scrubJson(remapJsonIds(m.metadataJson, idMap)) as object | undefined ?? undefined,
        },
      });
    }
    threadCount++;
  }
  console.log(`Copied ${threadCount} curated Engineer threads.`);

  // App settings — identity + onboarding suppression only. Never timing tokens.
  const now = new Date().toISOString();
  for (const [key, value] of [
    ["myName", DEMO_DRIVER_NAME],
    ["liveRcDriverName", DEMO_DRIVER_NAME],
    ["speedhiveDriverName", DEMO_DRIVER_NAME],
    ["onboardingSeenAt", now],
    ["onboardingCompletedAt", now],
  ] as const) {
    await prisma.appSetting.create({ data: { userId: DEMO_USER_ID, key, value } });
  }

  /*
   * ── 4. Anchor the season ───────────────────────────────────────────────────
   * The copy above keeps every original date, which is right — the season's shape, its gaps and
   * its back-to-back weekends are what make it read as real. But the founder's newest run is
   * whenever he last raced, and the app is full of 30-day windows, so a copy left where it
   * landed shows a visitor an account that has done nothing all month.
   *
   * One delta, applied to everything, moves the whole season without disturbing its shape.
   * `--lag-days` sets how far behind today the newest run sits; `demo:refresh` re-anchors it on
   * a schedule from here on, so this pass matters only for the minutes after a re-seed.
   */
  const shift = await refreshDemoSeasonDates({ lagDays, force: true });
  console.log(
    `\nSeason anchored: moved ${shift.deltaDays >= 0 ? "+" : ""}${shift.deltaDays} days ` +
      `(${shift.newestRunBefore?.slice(0, 10) ?? "—"} → ${shift.newestRunAfter?.slice(0, 10) ?? "—"}, ` +
      `newest run now ${lagDays} day(s) ago).`,
  );

  /*
   * Conversations get their own pass. They are not bound to the run timeline — the founder kept
   * asking the Engineer questions for a month after his last run — so the season delta above
   * overshoots them and parks the demo's history in the FUTURE. Caught on the first real seed:
   * threads dated 2026-09-18 against a 2026-08-25 today. See `placeDemoThread`.
   */
  const settled = await settleDemoThreadDates();
  console.log(
    `Conversations settled: ${settled.threads} threads, newest ${settled.newestAfter?.slice(0, 16).replace("T", " ") ?? "—"}` +
      (settled.movedForRunOrder > 0
        ? ` (${settled.movedForRunOrder} pushed to sit after the run they discuss)`
        : ""),
  );

  // ── 5. Review aids ──────────────────────────────────────────────────────────
  const leftover = await prisma.run.findMany({
    where: { userId: DEMO_USER_ID, OR: [{ notes: { contains: "Jordan", mode: "insensitive" } }, { driverNotes: { contains: "Jordan", mode: "insensitive" } }] },
    select: { id: true },
  });
  console.log(`\nScrub check — demo runs still mentioning "Jordan": ${leftover.length}`);

  /*
   * Co-presence leak check. The demo must share no event row with anyone, or its Teammates card
   * names a real driver to the public internet. This counts demo runs whose event is owned by
   * somebody else — it must be 0.
   */
  const sharedEvents = await prisma.run.count({
    where: { userId: DEMO_USER_ID, eventId: { not: null }, event: { userId: { not: DEMO_USER_ID } } },
  });
  console.log(`Leak check — demo runs on an event the demo does not own: ${sharedEvents}`);
  console.log("Done. Founder eyeball next: open the demo, read notes, open threads.");
  console.log(`Original→demo run ids are printed to help curate: edit ${overlayPath} keyed by ORIGINAL ids and re-run.`);
}

/** Replace any old ids appearing as string values inside a JSON blob (anchor/run refs). */
function remapJsonIds(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === "string") return idMap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => remapJsonIds(v, idMap));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = remapJsonIds(v, idMap);
    }
    return out;
  }
  return value;
}

main()
  .catch((err) => {
    console.error(`\n${err instanceof Error ? err.stack ?? err.message : err}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
