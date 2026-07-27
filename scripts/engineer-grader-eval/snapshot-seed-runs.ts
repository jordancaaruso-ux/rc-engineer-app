/**
 * Snapshot the founder's REAL runs (read-only from prod) into seed scenarios — the
 * grounded, physically-coherent starting point the factory later perturbs. Each real
 * run becomes a `source:"seed"` Scenario whose world = that run + up to N preceding
 * same-car runs (the "day"), focus = the run itself.
 *
 * Read-only: findMany only, writes JSON files, never touches the DB. Run against prod
 * with .env.local. Then hand-curate the 8–12 you want into scenarios/ (edit questions,
 * pick modes) — this script just does the extraction.
 *
 * Run: npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *        scripts/engineer-grader-eval/snapshot-seed-runs.ts [--user-email=… --history=3]
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadFounderRatedExemplars } from "@/lib/engineerFeedback/calibratedJudge";
import {
  countNonEmptyKeys,
  resolveNormalizedAggregationData,
} from "@/lib/setupAggregations/eligibleDocAggregationCore";
import type { Scenario, ScenarioRun, ScenarioWorld, SetupPoolEntry } from "./types";
import { writeScenario } from "./scenarioIo";

const RUN_INCLUDE = {
  car: true,
  track: true,
  trackLayout: true,
  tireSet: { include: { tireType: true } },
  additiveType: true,
  setupSnapshot: true,
  event: true,
} satisfies Prisma.RunInclude;
type RunWithRels = Prisma.RunGetPayload<{ include: typeof RUN_INCLUDE }>;

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

function lapsOf(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "car";
}

async function resolveUser(emailArg: string | null): Promise<{ id: string; email: string | null }> {
  const email = (emailArg || process.env.ENGINEER_EVAL_USER_EMAIL || "").trim().toLowerCase();
  if (email) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
    if (!u) throw new Error(`User not found for email ${email}`);
    return u;
  }
  const latest = await prisma.run.findFirst({
    orderBy: { sortAt: "desc" },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (!latest) throw new Error("No runs in DB — pass --user-email or set ENGINEER_EVAL_USER_EMAIL");
  return { id: latest.userId, email: latest.user?.email ?? null };
}

function toScenarioRun(run: RunWithRels): ScenarioRun {
  return {
    label: run.sessionLabel ?? run.meetingSessionCode ?? undefined,
    setupData: (run.setupSnapshot?.data ?? {}) as Record<string, unknown>,
    lapTimes: lapsOf(run.lapTimes),
    lapSession: run.lapSession ?? undefined,
    bestLapSeconds: run.bestLapSeconds ?? undefined,
    avgTop5LapSeconds: run.avgTop5LapSeconds ?? undefined,
    tireRunNumber: run.tireRunNumber ?? undefined,
    handlingAssessmentJson: run.handlingAssessmentJson ?? undefined,
    handlingProblems: run.handlingProblems ?? undefined,
    notes: run.notes ?? undefined,
    driverNotes: run.driverNotes ?? undefined,
    carRating: run.carRating ?? undefined,
    sessionType: run.sessionType,
    meetingSessionType: run.meetingSessionType ?? undefined,
    meetingSessionCode: run.meetingSessionCode ?? undefined,
    raceClass: run.raceClass ?? undefined,
    trackDirection: run.trackDirection ?? undefined,
    conditionsAirTempC: run.conditionsAirTempC ?? undefined,
    conditionsTrackTempC: run.conditionsTrackTempC ?? undefined,
    conditionsHumidityPct: run.conditionsHumidityPct ?? undefined,
    conditionsCloudCoverPct: run.conditionsCloudCoverPct ?? undefined,
    conditionsWeatherCode: run.conditionsWeatherCode ?? undefined,
    conditionsWindKph: run.conditionsWindKph ?? undefined,
    conditionsSource: run.conditionsSource ?? undefined,
  };
}

function buildWorld(focus: RunWithRels, history: RunWithRels[]): ScenarioWorld {
  const chain = [...history, focus];
  const runs = chain.map((run, idx) => {
    const sr = toScenarioRun(run);
    sr.sortAtOffsetDays = chain.length - 1 - idx; // focus run = 0, older runs larger
    return sr;
  });
  return {
    car: {
      name: focus.car?.name ?? "Car",
      chassis: focus.car?.chassis ?? undefined,
      carClass: focus.car?.carClass ?? undefined,
      setupSheetTemplate: focus.car?.setupSheetTemplate ?? undefined,
      setupSheetModelId: focus.car?.setupSheetModelId ?? undefined,
    },
    track: {
      name: focus.track?.name ?? "Track",
      location: focus.track?.location ?? undefined,
      gripTags: focus.track?.gripTags ?? [],
      layoutTags: focus.track?.layoutTags ?? [],
    },
    trackLayout: focus.trackLayout ? { name: focus.trackLayout.name } : null,
    event: focus.event ? { name: focus.event.name, raceClass: focus.event.raceClass ?? undefined } : null,
    tireSet: focus.tireSet
      ? {
          label: focus.tireSet.label,
          setNumber: focus.tireSet.setNumber,
          initialRunCount: focus.tireSet.initialRunCount,
          mark: focus.tireSet.mark ?? undefined,
          insertLabel: focus.tireSet.insertLabel ?? undefined,
          tireType: focus.tireSet.tireType
            ? { displayName: focus.tireSet.tireType.displayName, modelCode: focus.tireSet.tireType.modelCode }
            : null,
        }
      : null,
    additive: focus.additiveType
      ? { displayName: focus.additiveType.displayName, modelCode: focus.additiveType.modelCode }
      : null,
    runs,
    focusRunIndex: runs.length - 1,
  };
}

/**
 * Pull the SETUP POOL — every setup sheet that feeds the aggregation dataset, app-wide.
 * This is the "full mix": many chassis and tuning philosophies, not just Jordan's own two
 * tracks. Mirrors the real rebuild's eligibility gate (eligibleForAggregationDataset +
 * PARSED/PARTIAL) and reuses its exact normalizer so pool values match what the community
 * aggregations were actually built from.
 *
 * PRIVACY: this crosses users. Setup sheets are competitively sensitive in RC, so the pool
 * (and anything generated from it) stays gitignored. Entries record `sourceSite` so
 * publicly-published sheets (e.g. petitrc imports) can be told apart from private uploads.
 */
async function buildSetupPool(limit: number): Promise<SetupPoolEntry[]> {
  const pool: SetupPoolEntry[] = [];
  const seenShape = new Set<string>();

  const docs = await prisma.setupDocument.findMany({
    where: {
      eligibleForAggregationDataset: true,
      parseStatus: { in: ["PARSED", "PARTIAL"] },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      parsedDataJson: true,
      sourceSite: true,
      setupSheetTemplate: true,
      createdSetup: { select: { data: true } },
      car: { select: { setupSheetTemplate: true } },
    },
  });

  for (const d of docs) {
    const data = resolveNormalizedAggregationData(d.parsedDataJson, d.createdSetup);
    // The rebuild drops documents with fewer than 2 non-empty keys — match that bar.
    if (!data || countNonEmptyKeys(data) < 2) continue;
    const surface = typeof data.track_surface === "string" ? data.track_surface : null;
    // Dedupe identical sheets (re-imports of the same PDF) by their value fingerprint.
    const shape = JSON.stringify(data);
    if (seenShape.has(shape)) continue;
    seenShape.add(shape);
    pool.push({
      id: `doc-${d.id.slice(-8)}`,
      setupSheetTemplate: d.car?.setupSheetTemplate ?? d.setupSheetTemplate ?? null,
      trackSurface: surface,
      data: data as Record<string, unknown>,
      source: "setup-document",
      sourceSite: d.sourceSite ?? null,
      keyCount: countNonEmptyKeys(data),
    });
  }

  // Run-attached snapshots too — these feed the per-car condition aggregations.
  const snaps = await prisma.setupSnapshot.findMany({
    where: { isLibrary: false, runs: { some: {} } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, data: true, car: { select: { setupSheetTemplate: true } } },
  });
  for (const s of snaps) {
    const data = (s.data ?? {}) as Record<string, unknown>;
    if (Object.keys(data).length < 2) continue;
    const shape = JSON.stringify(data);
    if (seenShape.has(shape)) continue;
    seenShape.add(shape);
    pool.push({
      id: `snap-${s.id.slice(-8)}`,
      setupSheetTemplate: s.car?.setupSheetTemplate ?? null,
      trackSurface: typeof data.track_surface === "string" ? data.track_surface : null,
      data,
      source: "run-snapshot",
      keyCount: Object.keys(data).length,
    });
  }

  return pool;
}

async function main() {
  const user = await resolveUser(arg("user-email"));
  const history = Math.max(0, Math.floor(Number(arg("history") ?? 3)));
  console.log(`Founder user: ${user.email ?? user.id} · history depth ${history}`);

  const runs = await prisma.run.findMany({
    where: { userId: user.id },
    orderBy: { sortAt: "asc" },
    include: RUN_INCLUDE,
  });
  console.log(`Fetched ${runs.length} runs.`);

  const byCar = new Map<string, RunWithRels[]>();
  for (const r of runs) {
    const k = r.carId ?? "no-car";
    const arr = byCar.get(k);
    if (arr) arr.push(r);
    else byCar.set(k, [r]);
  }

  const outDir = path.join(process.cwd(), "scripts/engineer-grader-eval/seed");
  let count = 0;
  for (const carRuns of byCar.values()) {
    for (let i = 0; i < carRuns.length; i++) {
      const focus = carRuns[i];
      const world = buildWorld(focus, carRuns.slice(Math.max(0, i - history), i));
      const complaint = (focus.handlingProblems ?? "").trim();
      const question =
        complaint.length > 8
          ? `${complaint} What should I change for the next run?`
          : "That's my latest run logged. What should I change for the next one, if anything?";
      const scn: Scenario = {
        id: `seed-${String(++count).padStart(2, "0")}-${slug(focus.car?.name ?? "car")}-${focus.id.slice(-6)}`,
        version: 1,
        source: "seed",
        question,
        mode: "normal",
        world,
        coherence: { verdict: "pass", reason: "snapshot of a real logged run", checkedBy: "real-data" },
        tags: ["seed", "real-run"],
      };
      await writeScenario(outDir, scn);
    }
  }
  console.log(`Wrote ${count} seed scenarios → ${outDir}`);

  // Setup pool — the "full mix" of real sheets behind the aggregations.
  const pool = await buildSetupPool(Math.max(1, Math.floor(Number(arg("pool-limit") ?? 400))));
  const poolPath = path.join(outDir, "_setup-pool.json");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    poolPath,
    JSON.stringify({ generatedAtIso: new Date().toISOString(), entries: pool }, null, 2),
    "utf8"
  );
  const byTemplate = new Map<string, number>();
  for (const e of pool) byTemplate.set(e.setupSheetTemplate ?? "(none)", (byTemplate.get(e.setupSheetTemplate ?? "(none)") ?? 0) + 1);
  console.log(`Setup pool: ${pool.length} distinct sheets → ${poolPath}`);
  console.log(`  templates: ${[...byTemplate.entries()].map(([t, n]) => `${t}×${n}`).join(" · ") || "none"}`);
  if (pool.length === 0) {
    console.warn(
      `  ⚠ Empty pool — no SetupDocuments are flagged eligibleForAggregationDataset. ` +
        `The factory will fall back to the setups on your own runs (narrower mix).`
    );
  }

  // Also dump the judge's founder-rated exemplars (read-only from prod) so the branch
  // run — where engineerMessageRating is empty — can calibrate the grader from a file.
  // These are the frozen CALIBRATION set; synthetic scenarios are held-out by construction.
  const exemplars = await loadFounderRatedExemplars({ userId: user.id, maxExemplars: 12 });
  const resultsDir = path.join(process.cwd(), "scripts/engineer-grader-eval/results");
  await fs.mkdir(resultsDir, { recursive: true });
  const exemplarsFile = path.join(resultsDir, "exemplars.json");
  await fs.writeFile(
    exemplarsFile,
    JSON.stringify({ generatedAtIso: new Date().toISOString(), userEmail: user.email, exemplars }, null, 2),
    "utf8"
  );
  console.log(`Dumped ${exemplars.length} judge exemplars → ${exemplarsFile}`);
  console.log(`Next: hand-curate 8–12 seeds into scripts/engineer-grader-eval/scenarios/ (edit questions/modes).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
