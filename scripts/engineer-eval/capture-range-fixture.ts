/**
 * Capture a REAL range block as an eval fixture.
 *
 *   npm run engineer:range:fixture -- --email you@example.com --name range-keilor [--track <id>|--track-name Keilor] [--car <id>] [--from 2026-06-01] [--to 2026-09-14]
 *
 * Renders driverHistory.ts for that account and scope against whatever `.env.local` points
 * at (scratch-dev), and writes fixtures/<name>.txt — the file generate-conversations.ts uses
 * verbatim as the driver-data block for a context of that name. Also prints the block, so
 * the wire can be read by eye before any conversation is generated (audit-by-dumping).
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { buildDriverHistoryBlocks } from "@/lib/engineer/driverHistory";
import { parseRangeScope } from "@/lib/engineer/rangeScope";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const email = argValue("--email");
  const name = argValue("--name") ?? "range";
  if (!email) throw new Error("--email is required");
  const user = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`No user with email ${email}`);

  let trackId = argValue("--track");
  const trackName = argValue("--track-name");
  if (!trackId && trackName) {
    const track = await prisma.track.findFirst({
      where: { name: { contains: trackName, mode: "insensitive" }, runs: { some: { userId: user.id } } },
      select: { id: true, name: true },
    });
    if (!track) throw new Error(`No track like "${trackName}" with runs by ${email}`);
    console.log(`track: ${track.name} (${track.id})`);
    trackId = track.id;
  }
  const scope = parseRangeScope({ trackId, carId: argValue("--car"), from: argValue("--from"), to: argValue("--to") });
  if (!scope) throw new Error("bad scope");

  const blocks = await buildDriverHistoryBlocks({ userId: user.id, scope });
  const content = blocks[0]?.content ?? "";
  if (!content) {
    console.log("No runs in that range — nothing written.");
    return;
  }
  const out = path.join(__dirname, "fixtures", `${name}.txt`);
  fs.writeFileSync(out, content + "\n");
  console.log(content);
  console.log(`\n→ ${out} (${content.length} chars, ~${Math.round(content.length / 4)} tokens)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
