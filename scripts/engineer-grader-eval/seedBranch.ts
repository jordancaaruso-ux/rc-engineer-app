/**
 * Materialize scenarios into real rows on a THROWAWAY database branch, so the live
 * answer path (runEngineerChatTurn) and its userId-scoped tools run unmodified.
 *
 * Each scenario gets its own synthetic User (email suffix below) → its userId-scoped
 * tools (search_runs / tire_history_at_track / …) see only that scenario's runs.
 *
 * SAFETY: this writes to whatever DATABASE_URL points at. It refuses unless you have
 * explicitly declared the current DATABASE_URL a throwaway branch:
 *   - GRADER_DATABASE_URL must equal DATABASE_URL   (conscious acknowledgement)
 *   - GRADER_DB_CONFIRM=1
 *   - if PROD_DATABASE_URL is set, its host must NOT match DATABASE_URL's host
 * Schema on the branch comes from `prisma migrate deploy` — NEVER `db push` (AGENTS rule 2).
 *
 * Standalone (smoke test):
 *   npx dotenv-cli -e .env.grader -- node --conditions=react-server --import tsx \
 *     scripts/engineer-grader-eval/seedBranch.ts --reset --dir=scripts/engineer-grader-eval/seed
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Scenario, ScenarioRun, ScenarioWorld, SeededScenario } from "./types";
import { loadScenariosFromDirs } from "./scenarioIo";

const SYNTH_EMAIL_SUFFIX = "@synthetic.grader.local";

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;
const asJsonOrUndef = (v: unknown): Prisma.InputJsonValue | undefined =>
  v == null ? undefined : (v as Prisma.InputJsonValue);

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    const m = url.match(/@([^/?]+)/);
    return m ? m[1] : null;
  }
}

/** Refuse to write unless the current DATABASE_URL is an explicitly-declared throwaway branch. */
export function assertGraderDb(): void {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) throw new Error("DATABASE_URL is not set");
  const host = hostOf(dbUrl);
  const prod = process.env.PROD_DATABASE_URL?.trim();
  if (prod && hostOf(prod) === host) {
    throw new Error(
      `REFUSING: DATABASE_URL host (${host}) matches PROD_DATABASE_URL — point DATABASE_URL at a throwaway Neon branch.`
    );
  }
  const declared = process.env.GRADER_DATABASE_URL?.trim();
  if (!declared || declared !== dbUrl) {
    throw new Error(
      `REFUSING to write: set GRADER_DATABASE_URL equal to DATABASE_URL to acknowledge it is a throwaway branch (current host: ${host}).`
    );
  }
  if (process.env.GRADER_DB_CONFIRM?.trim() !== "1") {
    throw new Error(`REFUSING to write: set GRADER_DB_CONFIRM=1 to seed the grader branch (target host: ${host}).`);
  }
}

function positiveLaps(laps: number[]): number[] {
  return laps.filter((x) => typeof x === "number" && x > 0);
}
function bestLap(laps: number[]): number | undefined {
  const p = positiveLaps(laps);
  return p.length ? Math.min(...p) : undefined;
}
function avgTop5(laps: number[]): number | undefined {
  const p = positiveLaps(laps).sort((a, b) => a - b).slice(0, 5);
  return p.length ? p.reduce((s, x) => s + x, 0) / p.length : undefined;
}

async function upsertTireType(tt: { displayName: string; modelCode: string }) {
  return prisma.tireType.upsert({
    where: { modelCode: tt.modelCode },
    create: { displayName: tt.displayName, modelCode: tt.modelCode },
    update: {},
  });
}
async function upsertAdditive(a: { displayName: string; modelCode: string }) {
  return prisma.additiveType.upsert({
    where: { modelCode: a.modelCode },
    create: { displayName: a.displayName, modelCode: a.modelCode },
    update: {},
  });
}

/** Create a synthetic user + full world for one scenario; returns who/what to ask. */
export async function seedScenario(scn: Scenario): Promise<SeededScenario> {
  const world: ScenarioWorld = scn.world;
  const user = await prisma.user.create({
    data: { email: `grader+${scn.id}${SYNTH_EMAIL_SUFFIX}`, name: `[grader-eval] ${scn.id}` },
  });

  const car = await prisma.car.create({
    data: {
      userId: user.id,
      name: world.car.name,
      chassis: world.car.chassis ?? undefined,
      carClass: world.car.carClass ?? undefined,
      setupSheetTemplate: world.car.setupSheetTemplate ?? undefined,
      setupSheetModelId: world.car.setupSheetModelId ?? undefined,
    },
  });

  const track = await prisma.track.create({
    data: {
      userId: user.id,
      name: world.track.name,
      location: world.track.location ?? undefined,
      gripTags: world.track.gripTags ?? [],
      layoutTags: world.track.layoutTags ?? [],
    },
  });

  const layout = world.trackLayout
    ? await prisma.trackLayout.create({ data: { userId: user.id, trackId: track.id, name: world.trackLayout.name } })
    : null;

  const event = world.event
    ? await prisma.event.create({
        data: {
          userId: user.id,
          trackId: track.id,
          trackLayoutId: layout?.id,
          name: world.event.name,
          raceClass: world.event.raceClass ?? undefined,
          // Synthetic meeting window; exact dates don't matter for the engineer context.
          startDate: new Date(Date.now() - 2 * 86_400_000),
          endDate: new Date(Date.now() + 86_400_000),
        },
      })
    : null;

  const tireType = world.tireSet?.tireType ? await upsertTireType(world.tireSet.tireType) : null;
  const tireSet = world.tireSet
    ? await prisma.tireSet.create({
        data: {
          userId: user.id,
          label: world.tireSet.label,
          setNumber: world.tireSet.setNumber ?? 1,
          initialRunCount: world.tireSet.initialRunCount ?? 0,
          mark: world.tireSet.mark ?? undefined,
          insertLabel: world.tireSet.insertLabel ?? undefined,
          tireTypeId: tireType?.id,
        },
      })
    : null;
  const additive = world.additive ? await upsertAdditive(world.additive) : null;

  const now = Date.now();
  const runIds: string[] = [];
  for (let i = 0; i < world.runs.length; i++) {
    const r: ScenarioRun = world.runs[i];
    const snap = await prisma.setupSnapshot.create({
      data: { userId: user.id, carId: car.id, data: asJson(r.setupData), isLibrary: false },
    });
    // Older runs first: default offset = distance from the focus run, +minutes to keep order stable.
    const offsetDays = r.sortAtOffsetDays ?? Math.max(0, world.runs.length - 1 - i);
    const sortAt = new Date(now - offsetDays * 86_400_000 + i * 60_000);
    const laps = Array.isArray(r.lapTimes) ? r.lapTimes : [];
    const run = await prisma.run.create({
      data: {
        userId: user.id,
        carId: car.id,
        trackId: track.id,
        trackLayoutId: layout?.id,
        eventId: event?.id,
        setupSnapshotId: snap.id,
        tireSetId: tireSet?.id,
        tireRunNumber: r.tireRunNumber ?? i + 1,
        additiveTypeId: additive?.id,
        lapTimes: asJson(laps),
        lapSession: asJsonOrUndef(r.lapSession),
        bestLapSeconds: r.bestLapSeconds ?? bestLap(laps),
        avgTop5LapSeconds: r.avgTop5LapSeconds ?? avgTop5(laps),
        handlingAssessmentJson: asJsonOrUndef(r.handlingAssessmentJson),
        handlingProblems: r.handlingProblems ?? undefined,
        notes: r.notes ?? undefined,
        driverNotes: r.driverNotes ?? undefined,
        carRating: r.carRating ?? undefined,
        sessionType: r.sessionType ?? "TESTING",
        meetingSessionType: r.meetingSessionType ?? undefined,
        meetingSessionCode: r.meetingSessionCode ?? undefined,
        raceClass: r.raceClass ?? undefined,
        trackDirection: r.trackDirection ?? undefined,
        conditionsAirTempC: r.conditionsAirTempC ?? undefined,
        conditionsTrackTempC: r.conditionsTrackTempC ?? undefined,
        conditionsHumidityPct: r.conditionsHumidityPct ?? undefined,
        conditionsCloudCoverPct: r.conditionsCloudCoverPct ?? undefined,
        conditionsWeatherCode: r.conditionsWeatherCode ?? undefined,
        conditionsWindKph: r.conditionsWindKph ?? undefined,
        conditionsSource: r.conditionsSource ?? undefined,
        loggingComplete: true,
        loggingCompletedAt: sortAt,
        sortAt,
      },
    });
    runIds.push(run.id);
  }

  const focusIdx = Math.min(Math.max(0, world.focusRunIndex), runIds.length - 1);
  return {
    scenarioId: scn.id,
    userId: user.id,
    runId: runIds[focusIdx] ?? runIds[runIds.length - 1],
    question: scn.question,
    mode: scn.mode,
  };
}

/** Delete every synthetic grader user (cascades to their cars/runs/snapshots). */
export async function purgeSynthetic(): Promise<number> {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: SYNTH_EMAIL_SUFFIX } },
    select: { id: true },
  });
  for (const u of users) await prisma.user.delete({ where: { id: u.id } });
  return users.length;
}

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

async function main() {
  assertGraderDb();
  const dir = arg("dir") ?? path.join(process.cwd(), "scripts/engineer-grader-eval/seed");
  const scenarios = await loadScenariosFromDirs([dir]);
  if (scenarios.length === 0) throw new Error(`No scenarios found in ${dir}`);

  if (process.argv.includes("--reset")) {
    const n = await purgeSynthetic();
    console.log(`Purged ${n} prior synthetic users.`);
  }

  const manifest: SeededScenario[] = [];
  for (const scn of scenarios) {
    const seeded = await seedScenario(scn);
    manifest.push(seeded);
    console.log(`Seeded ${scn.id} → user ${seeded.userId} · focus run ${seeded.runId}`);
  }

  const outDir = path.join(process.cwd(), "scripts/engineer-grader-eval/results");
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "seeded-manifest.json");
  await fs.writeFile(outFile, JSON.stringify({ seededAtIso: new Date().toISOString(), manifest }, null, 2), "utf8");
  console.log(`\nSeeded ${manifest.length} scenarios → manifest ${outFile}`);
}

// Only run main() when invoked directly (not when imported by the bench).
const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("engineer-grader-eval/seedBranch.ts");
if (invokedDirectly) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
