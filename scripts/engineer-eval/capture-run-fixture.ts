/**
 * Capture a REAL per-run driver-data block — what the Engineer is handed for one driver's run.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx scripts/engineer-eval/capture-run-fixture.ts --email you@example.com [--run <id>] [--out <file>]
 *
 * Renders driverData.ts for that account's latest run (or --run) against whatever DATABASE_URL
 * points at, prints it, and writes it to --out when given. Beside capture-range-fixture.ts, which
 * does the same for a range. Written 2026-09-21 to see, by eye, what a driver the Engineer cannot
 * read is actually sent (audit-by-dumping) — and to cut fixtures from the result.
 *
 * A capture of someone else's run is THEIR data: keep it out of fixtures/ (tracked) unless it has
 * been cut down to the car and the sheet. answers/ is git-ignored.
 */
import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { buildDriverDataBlocks } from "@/lib/engineer/driverData";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const email = argValue("--email");
  if (!email) throw new Error("--email is required");
  const user = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`No user with email ${email}`);

  const blocks = await buildDriverDataBlocks({ userId: user.id, runId: argValue("--run"), question: null });
  const content = blocks[0]?.content ?? "";
  if (!content) {
    console.log("No runs on that account — the Engineer is sent no driver data at all.");
    return;
  }
  console.log(content);
  console.log(`\n(${content.length} chars, ~${Math.round(content.length / 4)} tokens)`);
  const out = argValue("--out");
  if (out) {
    fs.writeFileSync(out, content + "\n");
    console.log(`→ ${out}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
