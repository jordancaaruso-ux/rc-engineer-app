/**
 * dev-seed-walkthrough.ts — DEV/TEST ONLY. Builds the account the marketing walkthrough is
 * recorded against (e2e/walkthrough.spec.ts).
 *
 * The demo account has the good data but is hard read-only (middleware blocks all mutating
 * routes), so it cannot log a run. This seeds a throwaway account with the *gear* a racer would
 * already own — cars, tires, a saved setup, a meeting on today's calendar — but deliberately
 * NO PRIOR RUNS (founder 2026-08-05). With no history there is no prefill offer, so the recording
 * shows every field being chosen from scratch: the point is that it looks easy while still
 * filling the whole sheet.
 *
 * What it seeds:
 *   - Timing identity (LiveRC driver name + transponder) so lap auto-import matches a real
 *     session on tftr.liverc.com instead of returning an empty field.
 *   - Two cars, so choosing one is a real choice rather than a foregone conclusion.
 *   - Matrix EP Touring D36 tires, and a saved setup in the car's library — picking that setup is
 *     what fills all ~70 parameters in one tap.
 *   - A race meeting at TFTR dated today, with the LiveRC practice index attached so lap
 *     discovery still finds the driver's session under a race-meeting day type.
 *
 * The alias uses the same `+ob` tag as dev-fresh-onboarding.ts, so `npm run onboarding:cleanup`
 * deletes it along with the other throwaways. Refuses to touch production.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-seed-walkthrough.ts
 */
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { setLiveRcDriverNameSetting, setSpeedhiveTransponderNumbersSetting } from "@/lib/appSettings";

const BASE_EMAIL = "jordancaaruso@gmail.com";
const THROWAWAY_TAG = "+ob";

/** The founder's real LiveRC identity — auto-import only matches on the name the site prints. */
const LIVERC_DRIVER_NAME = "Jordan Caruso";
const TRANSPONDER = "2799719";

/** The shared TFTR row with the run history (not the demo account's copy). */
const TFTR_TRACK_ID = "cmnh0wehc0000kw04ppzcob2s";
/** The real Awesomatix sheet model, so the Setup step renders a structured sheet. */
const SETUP_SHEET_MODEL_ID = "cmpg8ad3x0001l804rbnhng5f";
/** Where the driver's practice sessions are indexed, attached to the meeting for discovery. */
const TFTR_PRACTICE_INDEX = "https://tftr.liverc.com/practice/";

function freshAlias(): string {
  const [local, domain] = BASE_EMAIL.split("@");
  const now = new Date();
  const stamp = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `${local}${THROWAWAY_TAG}${stamp}wt-${randomBytes(2).toString("hex")}@${domain}`;
}

async function mintSignInUrl(email: string): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  const baseUrl = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000")
    .trim()
    .replace(/\/$/, "");
  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: createHash("sha256").update(`${token}${secret}`).digest("hex"),
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const params = new URLSearchParams({ callbackUrl: `${baseUrl}/`, token, email });
  return `${baseUrl}/api/auth/callback/nodemailer?${params}`;
}

/**
 * A realistic, fully-populated A800R sheet. Cloned from an existing anonymised snapshot so every
 * one of the ~70 parameters carries a plausible value — the saved setup has to look like a real
 * sheet, because filling it in one tap is the thing being demonstrated.
 */
async function buildSetupData(): Promise<Prisma.InputJsonObject> {
  const donor = await prisma.setupSnapshot.findFirst({
    where: { isLibrary: false },
    orderBy: { createdAt: "desc" },
    select: { data: true },
  });
  const base = (donor?.data as Prisma.InputJsonObject | null) ?? {};
  return {
    ...base,
    name: LIVERC_DRIVER_NAME,
    race: "TFTR Club Round 5",
    track: "TFTR",
    class: "13.5T",
    additive: "Mighty Gripper - Yellow",
    additive_time: "20",
  };
}

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`\nDatabase: ${dbHost}`);
  if (/ep-hidden-rice/.test(dbHost)) {
    throw new Error("REFUSING TO RUN: that is PRODUCTION.");
  }

  const email = freshAlias();
  await prisma.authAllowedEmail.upsert({ where: { email }, update: {}, create: { email } });

  const user = await prisma.user.create({
    data: { email, name: LIVERC_DRIVER_NAME },
    select: { id: true },
  });
  const userId = user.id;

  // Timing identity — without this the lap-ingest gate blocks auto-import.
  await setLiveRcDriverNameSetting(userId, LIVERC_DRIVER_NAME);
  await setSpeedhiveTransponderNumbersSetting(userId, TRANSPONDER);

  // Two cars so the Car field is a real choice on camera. The picker sorts by name, so A800R is
  // the default — the walkthrough picks A800RR, which makes the selection visibly change something
  // instead of confirming what was already there. The saved setup hangs off A800RR for that reason.
  await prisma.car.create({
    data: {
      userId,
      name: "A800R",
      carClass: "touring",
      setupSheetModelId: SETUP_SHEET_MODEL_ID,
      setupSheetTemplate: "awesomatix_a800rr",
    },
  });
  const car = await prisma.car.create({
    data: {
      userId,
      name: "A800RR",
      carClass: "touring",
      setupSheetModelId: SETUP_SHEET_MODEL_ID,
      setupSheetTemplate: "awesomatix_a800rr",
    },
    select: { id: true },
  });

  const tireType = await prisma.tireType.findFirst({
    where: { brand: "Matrix", model: "EP Touring", compound: "D36" },
    select: { id: true, displayName: true },
  });
  if (!tireType) throw new Error("Matrix EP Touring D36 not found in the tire catalog.");
  await prisma.tireSet.create({
    data: { userId, tireTypeId: tireType.id, label: "Matrix D36", setNumber: 1, mark: "1" },
  });

  const track = await prisma.track.findUnique({
    where: { id: TFTR_TRACK_ID },
    select: { id: true, name: true, location: true },
  });
  if (!track) throw new Error("TFTR track row not found.");
  await prisma.favouriteTrack.create({ data: { userId, trackId: track.id } });

  // The saved setup: one tap on this fills the whole sheet.
  const savedSetup = await prisma.setupSnapshot.create({
    data: {
      userId,
      carId: car.id,
      data: await buildSetupData(),
      name: "TFTR — medium grip",
      isLibrary: true,
    },
    select: { id: true, name: true },
  });

  // Today's meeting. Events are global rows keyed to a track, so reuse one if it already exists
  // for today rather than stacking duplicates into the shared calendar.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  const existing = await prisma.event.findFirst({
    where: { trackId: track.id, startDate: { gte: dayStart, lte: dayEnd } },
    select: { id: true, name: true },
  });
  const event =
    existing ??
    (await prisma.event.create({
      data: {
        userId,
        name: "TFTR Club Round 5",
        startDate: dayStart,
        endDate: dayEnd,
        trackId: track.id,
        trackNameSnapshot: track.name,
        trackLocationSnapshot: track.location,
        // Attached so discovery still reaches the practice index on a race-meeting day.
        practiceSourceUrl: TFTR_PRACTICE_INDEX,
        raceClass: "13.5T",
      },
      select: { id: true, name: true },
    }));

  // The event picker scopes by EventParticipation (or by runs already in the event) — NOT by the
  // Event's own userId, which is attribution only. Without this row the meeting exists but the
  // run form reports "No events yet".
  await prisma.eventParticipation.upsert({
    where: { userId_eventId: { userId, eventId: event.id } },
    update: {},
    // No controlled tire on purpose: a spec-tire meeting auto-fills the Tires step, and choosing
    // the tire is one of the steps being demonstrated.
    create: { userId, eventId: event.id },
  });

  const url = await mintSignInUrl(email);

  console.log(`\nAccount:     ${email}`);
  console.log(`Driver name: ${LIVERC_DRIVER_NAME} (transponder ${TRANSPONDER})`);
  console.log(`Cars:        A800R (default), A800RR (picked, holds the saved setup)`);
  console.log(`Tires:       ${tireType.displayName}`);
  console.log(`Saved setup: "${savedSetup.name}"   ·   Home track: ${track.name}`);
  console.log(`Meeting:     "${event.name}" today${existing ? " (reused existing)" : " (created)"}`);
  console.log("Runs:        none — no prefill, everything chosen on camera");
  console.log("\nSign-in URL (single use, 24h):\n");
  console.log(url);
  console.log("\nCleanup when done:  npm run onboarding:cleanup\n");
}

main()
  .catch((e) => {
    console.error("ERR: " + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
