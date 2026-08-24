import { PrismaClient } from "@prisma/client";

/**
 * "Has Lucas logged anything since Andernach?"
 *
 * Anchors on his last run at a track/event matching /andernach/i, then lists every
 * run that sorts after it. Read-only. Point it at the right database — scratch-dev
 * is a clone from a past moment, so "no runs since" there is not evidence of anything.
 */

const prisma = new PrismaClient();
const USER_EMAIL = process.argv[3] ?? "lucas.urbain@yahoo.fr";
const NEEDLE = process.argv[2] ?? "andernach";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().replace("T", " ").slice(0, 16) : "—");

async function main() {
  const u = await prisma.user.findUnique({ where: { email: USER_EMAIL }, select: { id: true, name: true } });
  if (!u) throw new Error(`no user for ${USER_EMAIL}`);

  const select = {
    id: true,
    sortAt: true,
    sessionCompletedAt: true,
    createdAt: true,
    sessionLabel: true,
    sessionType: true,
    carNameSnapshot: true,
    trackNameSnapshot: true,
    bestLapSeconds: true,
    avgTop5LapSeconds: true,
    event: { select: { name: true, trackNameSnapshot: true } },
    track: { select: { name: true, location: true } },
  } as const;

  const all = await prisma.run.findMany({ where: { userId: u.id }, orderBy: { sortAt: "asc" }, select });

  const matches = (r: (typeof all)[number]) =>
    [r.trackNameSnapshot, r.track?.name, r.track?.location, r.event?.name, r.event?.trackNameSnapshot]
      .some((s) => s?.toLowerCase().includes(NEEDLE.toLowerCase()));

  const anchorIdx = all.map(matches).lastIndexOf(true);

  console.log(`${u.name ?? USER_EMAIL} — ${all.length} runs total`);
  if (anchorIdx === -1) {
    console.log(`\nNo run matches "${NEEDLE}". Last 5 runs so you can pick the anchor by hand:`);
    for (const r of all.slice(-5)) {
      console.log(`  ${iso(r.sortAt)}  ${r.trackNameSnapshot ?? r.track?.name ?? "—"}  ${r.event?.name ?? ""}`);
    }
    return;
  }

  const anchor = all[anchorIdx];
  const after = all.slice(anchorIdx + 1);
  console.log(`\nanchor — last "${NEEDLE}" run: ${iso(anchor.sortAt)}  ${anchor.event?.name ?? anchor.trackNameSnapshot ?? "—"}  (${anchor.sessionLabel ?? anchor.sessionType})`);

  if (!after.length) {
    const days = Math.floor((Date.now() - anchor.sortAt.getTime()) / 86_400_000);
    console.log(`\nNOTHING SINCE — ${days} days quiet.`);
    return;
  }

  console.log(`\n${after.length} run(s) since, oldest first:\n`);
  for (const r of after) {
    const where = r.event?.name ?? r.trackNameSnapshot ?? r.track?.name ?? "—";
    const pace = r.bestLapSeconds ? `best ${r.bestLapSeconds.toFixed(2)}s / top5 ${r.avgTop5LapSeconds?.toFixed(2) ?? "—"}s` : "no laps";
    console.log(`  ${iso(r.sortAt)}  ${where}  ${r.carNameSnapshot ?? "—"}  ${r.sessionLabel ?? r.sessionType}  ${pace}`);
    console.log(`      logged ${iso(r.createdAt)}${r.sessionCompletedAt ? `, on track ${iso(r.sessionCompletedAt)}` : ""}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
