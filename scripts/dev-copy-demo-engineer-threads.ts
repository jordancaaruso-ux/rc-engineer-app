/**
 * dev-copy-demo-engineer-threads.ts — DEV/FOUNDER ONLY.
 *
 * The demo account has zero Engineer threads, so the app's headline feature renders an empty
 * "No past conversations yet" on the public demo and in any marketing capture. seed-demo-account.ts
 * is supposed to copy curated threads across (scripts/demo-curation-overlay.json) but they are not
 * landing. This copies a named, founder-chosen set instead, scrubbed with the same name table the
 * rest of the demo data went through.
 *
 * Run anchors are dropped deliberately: the source threads point at the FOUNDER's run rows, which
 * the demo account does not own. Copying those ids would either 404 the anchor or leak a run the
 * demo user cannot see, so each copy lands as a general conversation.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-copy-demo-engineer-threads.ts
 *   ... --clear     # remove copies and start over
 *
 * Idempotent: clears the demo account's threads first, so re-running never duplicates.
 */
import { prisma } from "@/lib/prisma";
import { buildScrubber, deepScrub } from "@/lib/demo/anonymize";
import { demoCatalogUserId } from "@/lib/demo/demoAccess";

/** Founder-chosen 2026-08-05: the weekend story, the grounded setup answer, the beginner question. */
const THREAD_IDS = [
  "cms5zgqy60003l204y3w10qfo", // "Analyze my performance over the weekend, and the important setup changes"
  "cms6o9kpd000sl404en7ypylz", // "How can I get more steering into/rotation without losing rear grip"
  "cmrwzy4cs0003jl04s86zyd3w", // "Why is it so hard to turn my car the right way, I'm only just starting rc"
];

const args = process.argv.slice(2);

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`\nDatabase: ${dbHost}`);
  if (/ep-hidden-rice/.test(dbHost)) throw new Error("REFUSING TO RUN: that is PRODUCTION.");

  const demoId = demoCatalogUserId();
  const demoUser = await prisma.user.findUnique({
    where: { id: demoId },
    select: { id: true, name: true, email: true },
  });
  if (!demoUser) throw new Error("No demo account — run `npm run demo:seed` first.");

  // Existing copies go first so re-runs are clean rather than cumulative.
  const removed = await prisma.engineerChatThread.deleteMany({ where: { userId: demoId } });
  console.log(`cleared ${removed.count} existing demo thread(s)`);
  if (args.includes("--clear")) return;

  // Same substitutions the rest of the demo data went through, so a thread cannot reintroduce the
  // real name that the run/setup copy already scrubbed out.
  const demoName = demoUser.name?.trim() || "Alex Marino";
  const scrub = buildScrubber(
    [
      { from: "Jordan Caruso", to: demoName },
      { from: "Caruso", to: demoName.split(" ").pop() ?? demoName },
      { from: "Jordan", to: demoName.split(" ")[0] ?? demoName },
      { from: "jordancaaruso", to: "demodriver" },
    ],
    { transponders: true },
  );

  for (const id of THREAD_IDS) {
    const src = await prisma.engineerChatThread.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!src) {
      console.log(`  SKIP ${id} — not found`);
      continue;
    }

    const created = await prisma.engineerChatThread.create({
      data: {
        userId: demoId,
        createdAt: src.createdAt,
        updatedAt: src.updatedAt,
        // Anchors intentionally dropped — see header.
        primaryRunId: null,
        compareRunId: null,
        focusAnchorJson: undefined,
        messages: {
          create: src.messages.map((m) => {
            const row = m as unknown as Record<string, unknown>;
            return {
              role: row.role as string,
              content: scrub(String(row.content ?? "")),
              createdAt: m.createdAt,
              ...(row.contextJson ? { contextJson: deepScrub(row.contextJson, scrub) } : {}),
            };
          }),
        },
      },
      include: { messages: true },
    });

    const firstQ = created.messages.find((m) => (m as unknown as { role: string }).role === "user");
    console.log(
      `  copied ${created.messages.length} msg(s): "${String((firstQ as unknown as { content?: string })?.content ?? "").slice(0, 70)}…"`,
    );
  }

  const total = await prisma.engineerChatThread.count({ where: { userId: demoId } });
  console.log(`\ndemo account now has ${total} thread(s).\n`);
}

main()
  .catch((e) => {
    console.error("ERR: " + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
