/** Dump a doc's OCR engine, flagged keys, and key text values to eyeball local-OCR accuracy. */
import { prisma } from "@/lib/prisma";

const DOC = "cmrlh9xdr0001jr04ne9axz0s";
// Ground truth read off IMG_4248 (Ronald's sheet).
const GOLD: Record<string, string> = {
  driver: "Ronald", battery: "LRP 4200 Shorty", motor: "5t", pinion: "24", spur: "94",
  tires: "Ruddog 36", additive: "CS purple", warmer_c: "70", warmer_time: "12",
  transmitter: "Flysky Noble Pro +", servo: "Highest L210", steering_expo: "-24",
  droop_front: "23.6", droop_rear: "22.4", spring_front: "4.5", spring_rear: "4.25",
  shock_oil_front: "450", shock_oil_rear: "450", ride_height_front: "5.2", ride_height_rear: "5.5",
  car_weight: "1302", weight_balance_f_r: "49.75", top_deck_thickness_front: "2.0",
  top_deck_thickness_rear: "2.2", caster_front: "4", caster_rear: "2", camber_front: "2", camber_rear: "2",
};

async function main() {
  const doc = await prisma.setupDocument.findUnique({ where: { id: DOC }, select: { importDiagnosticJson: true, parsedDataJson: true } });
  const diag = doc?.importDiagnosticJson as Record<string, unknown>;
  const mapping = (diag?.mapping ?? {}) as Record<string, unknown>;
  const p = (doc?.parsedDataJson ?? {}) as Record<string, unknown>;
  console.log("ocrEngine:", mapping.ocrEngine, "| flaggedTextKeys:", JSON.stringify(mapping.flaggedTextKeys));
  const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[\s°%]/g, "").replace(/^[-+]/, "");
  let ok = 0, bad = 0;
  console.log("\n  KEY                         READ                  GOLD");
  for (const [k, g] of Object.entries(GOLD)) {
    const v = p[k];
    const match = norm(v).includes(norm(g)) || norm(g).includes(norm(v)) && norm(v) !== "";
    if (match) ok++; else bad++;
    console.log(`${match ? "  " : "❌"} ${k.padEnd(26)} ${String(v ?? "(blank)").slice(0,20).padEnd(21)} ${g}`);
  }
  console.log(`\n${ok}/${ok + bad} key fields match gold`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
