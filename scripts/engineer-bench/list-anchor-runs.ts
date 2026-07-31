/**
 * List candidate anchor runs for a bench A/B.
 *
 * A bench case with `runPolicy:"latest"` answers about ONE run, and which run that is changes the
 * answer more than the model does. Left unpinned the bench grabs whatever is newest, so the subject
 * of the comparison drifts between arms. This prints the runs you can pin, with the signals that
 * actually decide whether a run makes a good test case: does it have notes, laps, a rating, worn
 * tyres, a car and track the Engineer can find community data for.
 *
 * Run: npm run engineer:bench:runs -- --limit=40
 *      npm run engineer:bench:runs -- --email=someone@example.com
 *
 * Read-only. Feed the ids you pick to `run-bench.ts --run-ids=`.
 */
import { prisma } from "@/lib/prisma";

function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

async function main() {
  const email = (arg("email") ?? process.env.ENGINEER_EVAL_USER_EMAIL ?? "").trim().toLowerCase();
  if (!email) throw new Error("Set --email= or ENGINEER_EVAL_USER_EMAIL");
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`No user for ${email}`);
  const limit = Math.max(1, Number(arg("limit") ?? 40) || 40);

  const runs = await prisma.run.findMany({
    where: { userId: user.id, loggingComplete: true },
    orderBy: { sortAt: "desc" },
    take: limit,
    select: {
      id: true,
      sortAt: true,
      sessionType: true,
      notes: true,
      driverNotes: true,
      handlingProblems: true,
      carRating: true,
      tireRunNumber: true,
      lapTimes: true,
      carNameSnapshot: true,
      trackNameSnapshot: true,
      car: { select: { name: true } },
      track: { select: { name: true, gripTags: true } },
      event: { select: { name: true } },
    },
  });

  console.log(`\n${runs.length} completed runs for ${email}\n`);
  for (const r of runs) {
    const when = r.sortAt ? r.sortAt.toISOString().slice(0, 10) : "?";
    const car = r.car?.name ?? r.carNameSnapshot ?? "—";
    const track = r.track?.name ?? r.trackNameSnapshot ?? r.event?.name ?? "—";
    const laps = Array.isArray(r.lapTimes) ? (r.lapTimes as unknown[]).length : 0;
    const text = [r.notes, r.driverNotes, r.handlingProblems]
      .filter(Boolean)
      .join(" | ")
      .replace(/\s+/g, " ");
    console.log(
      `${r.id}  ${when}  ${car.slice(0, 16).padEnd(16)} ${String(track).slice(0, 22).padEnd(22)} ` +
        `${String(r.sessionType).padEnd(12)} tyre#${String(r.tireRunNumber).padEnd(3)} ` +
        `rating=${String(r.carRating ?? "-").padEnd(3)} laps=${String(laps).padEnd(3)} notes=${text.length}ch`
    );
    if (text) console.log(`      "${text.slice(0, 200)}${text.length > 200 ? "…" : ""}"`);
  }
  console.log(`\nPin these with:  npm run engineer:bench -- --ids=<case,…> --run-ids=<run,…>\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
