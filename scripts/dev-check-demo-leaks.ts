/**
 * dev-check-demo-leaks.ts — DEV ONLY. Does the demo account still say the founder's name anywhere
 * a marketing screenshot could catch it?
 *
 *   npm run demo:leaks
 *
 * The race-day scrubber (`dev-demo-race-day.ts`) rewrites the fields it knows about — imported
 * payloads, lap sets, notes, Engineer messages. This looks for what it does NOT cover, because a
 * `\b` word boundary never fires inside `A800R_Caruso_2026.pdf`: underscores are word characters,
 * so an underscore-joined name survives every pass. Read-only; it changes nothing.
 */
import { prisma } from "@/lib/prisma";
import { demoCatalogUserId } from "@/lib/demo/demoAccess";

const DEMO = demoCatalogUserId();
const LEAK = /caruso|jordan/i;

type Hit = { where: string; id: string; text: string };

async function main() {
  console.log(`Database host: ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown"}`);
  const hits: Hit[] = [];
  const add = (where: string, id: string, text: string | null | undefined) => {
    if (text && LEAK.test(text)) hits.push({ where, id, text });
  };

  const [snapshots, documents, cars, tireSets, events, tracks, lapSets, sessions, runs, messages] =
    await Promise.all([
      prisma.setupSnapshot.findMany({ where: { userId: DEMO }, select: { id: true, name: true } }),
      prisma.setupDocument.findMany({ where: { userId: DEMO }, select: { id: true, originalFilename: true, storagePath: true } }),
      prisma.car.findMany({ where: { userId: DEMO }, select: { id: true, name: true } }),
      prisma.tireSet.findMany({ where: { userId: DEMO }, select: { id: true, label: true } }),
      prisma.event.findMany({ where: { userId: DEMO }, select: { id: true, name: true } }),
      prisma.track.findMany({ where: { userId: DEMO }, select: { id: true, name: true } }),
      prisma.runImportedLapSet.findMany({ where: { run: { userId: DEMO } }, select: { id: true, driverName: true, displayName: true, normalizedName: true } }),
      prisma.importedLapTimeSession.findMany({ where: { userId: DEMO }, select: { id: true, eventDetectionSessionLabel: true, sourceUrl: true, parsedPayload: true, fieldStatsJson: true } }),
      prisma.run.findMany({ where: { userId: DEMO }, select: { id: true, notes: true, driverNotes: true, lapSession: true } }),
      prisma.engineerChatMessage.findMany({ where: { thread: { userId: DEMO } }, select: { id: true, content: true } }),
    ]);

  for (const s of snapshots) add("SetupSnapshot.name", s.id, s.name);
  for (const d of documents) {
    add("SetupDocument.originalFilename", d.id, d.originalFilename);
    add("SetupDocument.storagePath", d.id, d.storagePath);
  }
  for (const c of cars) add("Car.name", c.id, c.name);
  for (const t of tireSets) add("TireSet.label", t.id, t.label);
  for (const e of events) add("Event.name", e.id, e.name);
  for (const t of tracks) add("Track.name", t.id, t.name);
  for (const l of lapSets) {
    add("RunImportedLapSet.driverName", l.id, l.driverName);
    add("RunImportedLapSet.displayName", l.id, l.displayName);
    add("RunImportedLapSet.normalizedName", l.id, l.normalizedName);
  }
  for (const s of sessions) {
    add("ImportedLapTimeSession.label", s.id, s.eventDetectionSessionLabel);
    add("ImportedLapTimeSession.sourceUrl", s.id, s.sourceUrl);
    add("ImportedLapTimeSession.parsedPayload", s.id, JSON.stringify(s.parsedPayload)?.slice(0, 20000));
    add("ImportedLapTimeSession.fieldStatsJson", s.id, JSON.stringify(s.fieldStatsJson)?.slice(0, 20000));
  }
  for (const r of runs) {
    add("Run.notes", r.id, r.notes);
    add("Run.driverNotes", r.id, r.driverNotes);
    add("Run.lapSession", r.id, JSON.stringify(r.lapSession)?.slice(0, 20000));
  }
  for (const m of messages) add("EngineerChatMessage.content", m.id, m.content);

  if (hits.length === 0) {
    console.log("Clean: no 'Jordan' or 'Caruso' anywhere in the demo account.");
    return;
  }
  console.log(`${hits.length} leak(s):`);
  for (const h of hits) {
    const at = h.text.search(LEAK);
    console.log(`  ${h.where}  ${h.id}\n      …${h.text.slice(Math.max(0, at - 60), at + 80).replace(/\s+/g, " ")}…`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
