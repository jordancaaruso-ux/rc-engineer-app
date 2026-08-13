/**
 * Render the share cards to PNG files and look at them.
 *
 * The model is unit-tested and the routes typecheck, but neither proves that satori actually
 * draws the layout — it is not a browser, it clips overflow silently, and it ignores CSS it does
 * not implement. The only way to know a card is right is to open the picture.
 *
 * No database and no server: it builds a card from a fixture and calls the same renderer the
 * route calls, so what lands in `out/` is what a driver would send.
 *
 *   npx tsx scripts/dev-share-card-shot.ts [outDir]
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildShareRunCard,
  defaultSectionsForMode,
  type ShareRunInput,
} from "@/lib/share/shareCardModel";
import { renderRunCard } from "@/lib/share/renderRunCard";

const LAPS = [
  15.612, 15.388, 15.201, 15.114, 15.276, 15.198, 15.34, 15.402, 15.887, 15.455,
  15.298, 15.221, 15.377, 15.509, 15.664, 15.812, 16.104, 16.398, 15.744,
];

const RUN: ShareRunInput = {
  sessionType: "RACE_MEETING",
  meetingSessionType: "QUALIFYING",
  sessionLabel: "Q2",
  lapTimes: LAPS,
  notes:
    "Loose on entry from the second lap once the fronts came in. Mid corner is fine. Rear steps out under brakes into 1 and 3 — had to be gentle with it. Traction rolled away in the last ninety seconds and I couldn't hold the line through the sweeper.",
  carRating: 7,
  tireRunNumber: 3,
  warmerTimingMinutes: 12,
  conditionsAirTempC: 24,
  conditionsTrackTempC: 31,
  conditionsHumidityPct: 48,
  conditionsWindKph: 11,
  car: { name: "Awesomatix A800RR" },
  track: { name: "Barton Park Raceway" },
  tireType: { displayName: "Volante VT-R2" },
  additiveType: { displayName: "Trinity Death Row" },
  event: { name: "Round 4 — NSW State Series" },
  handlingAssessmentJson: {
    version: 6,
    feelSteering: 1,
    onPower: -1,
    braking: -2,
    driveEase: -1,
    tractionRoll: 0,
  },
};

const SETUP = {
  camber_front: "-1.5",
  camber_rear: "-1.0",
  toe_front: "-0.5",
  toe_rear: "2.5",
  ride_height_front: "5.0",
  ride_height_rear: "5.5",
};
const PREVIOUS_SETUP = { ...SETUP, ride_height_rear: "5.0", toe_rear: "2.0" };

async function shoot(name: string, mode: "headline" | "full", overrides = {}, outDir: string) {
  const card = buildShareRunCard({
    run: RUN,
    mode,
    sections: defaultSectionsForMode(mode),
    dateTimeLabel: "9 Aug 2026, 10:42",
    driverName: "Jordan Caruso",
    setupData: SETUP,
    previousSetupData: PREVIOUS_SETUP,
    ...overrides,
  });

  const bytes = Buffer.from(await renderRunCard(card).arrayBuffer());
  const file = path.join(outDir, `${name}.png`);
  await writeFile(file, bytes);
  console.log(`${name}: ${card.height}px tall, ${(bytes.length / 1024).toFixed(0)} KB → ${file}`);
}

/*
 * There is no setup shot here on purpose. A setup share is now the driver's own PDF page,
 * resized and otherwise untouched — nothing this script could draw would be that page, so a
 * stand-in would only prove sharp can resize. Look at a real one through the route instead.
 */

async function main() {
  const outDir = process.argv[2] ?? path.join(process.cwd(), "share-shots");
  await mkdir(outDir, { recursive: true });

  await shoot("headline", "headline", {}, outDir);
  await shoot(
    "headline-with-pace",
    "headline",
    { sections: { ...defaultSectionsForMode("headline"), pace: true }, paceVsFieldSeconds: -0.184 },
    outDir
  );
  await shoot("full", "full", {}, outDir);
}

void main();
