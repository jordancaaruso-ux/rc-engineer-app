/**
 * dev-seed-sheet-run.ts — DEV/TEST ONLY. One account, one car on a sheet-mode chassis, one run
 * with a filled setup snapshot. Exists so a browser test can open the session view's Setup modal
 * on a chassis that draws its own sheet, which is the only place the values race can be seen.
 *
 * Writes `e2e/.auth/sheet-run.json` with the sign-in URL and the run id for the spec to pick up.
 * Refuses to touch production. Cleanup: `npm run onboarding:cleanup` (the alias carries `+ob`).
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-seed-sheet-run.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const BASE_EMAIL = "jordancaaruso@gmail.com";
const THROWAWAY_TAG = "+ob";
const OUT = "e2e/.auth/sheet-run.json";

function freshAlias(): string {
  const [local, domain] = BASE_EMAIL.split("@");
  return `${local}${THROWAWAY_TAG}sheetrun-${randomBytes(3).toString("hex")}@${domain}`;
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

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`\nDatabase: ${dbHost}`);
  if (/ep-hidden-rice/.test(dbHost)) throw new Error("REFUSING TO RUN: that is PRODUCTION.");

  /*
   * Donor values from a real snapshot on a chassis that draws as a sheet. Taken together rather
   * than chassis-first because the keys have to match the boxes: values from some other model
   * would draw nothing, and the test would then pass for the wrong reason.
   */
  const candidates = await prisma.run.findMany({
    where: { car: { setupSheetModel: { derivedFromBlank: { fillSurface: "sheet" } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      setupSnapshot: { select: { data: true } },
      car: {
        select: {
          setupSheetModelId: true,
          setupSheetModel: {
            select: { name: true, derivedFromBlank: { select: { pageCount: true } } },
          },
        },
      },
    },
  });
  /** The fullest sheet wins: a snapshot with two values in it proves nothing when it draws blank. */
  const countFilled = (data: unknown) =>
    data && typeof data === "object"
      ? Object.values(data as Record<string, unknown>).filter(
          (v) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)
        ).length
      : 0;
  const donorRun = candidates
    .slice()
    .sort((a, b) => countFilled(b.setupSnapshot?.data) - countFilled(a.setupSnapshot?.data))[0];

  const donor = (donorRun?.setupSnapshot?.data as Prisma.InputJsonObject | null) ?? null;
  const modelId = donorRun?.car?.setupSheetModelId ?? null;
  if (!donor || !modelId) throw new Error("No run on a sheet-mode chassis to copy setup from.");
  const model = donorRun?.car?.setupSheetModel ?? null;
  const blank = { pageCount: model?.derivedFromBlank?.pageCount ?? 1 };
  const filledKeys = countFilled(donor);

  const email = freshAlias();
  await prisma.authAllowedEmail.upsert({ where: { email }, update: {}, create: { email } });
  const user = await prisma.user.create({ data: { email, name: "Sheet Race" }, select: { id: true } });

  const car = await prisma.car.create({
    data: {
      userId: user.id,
      name: `${model?.name ?? "Test car"}`.slice(0, 40),
      carClass: "touring",
      setupSheetModelId: modelId,
    },
    select: { id: true, name: true },
  });

  /*
   * TWO runs on one car, each stamped so a box can be read back to the run it came from.
   *
   * Every text value becomes the same marker, so the sheet's drawn boxes say which run is on the
   * paper without the test needing to know which of 279 boxes maps to which parameter. Numbers are
   * left alone — they carry no marker but they still draw, and the count is not what is being read.
   */
  const stamped = (marker: string): Prisma.InputJsonObject =>
    Object.fromEntries(
      Object.entries(donor).map(([k, v]) => [k, typeof v === "string" && v !== "" ? marker : v])
    ) as Prisma.InputJsonObject;

  const seedRun = async (marker: string, label: string) => {
    const snapshot = await prisma.setupSnapshot.create({
      data: { userId: user.id, carId: car.id, data: stamped(marker), name: `Seeded ${label}` },
      select: { id: true },
    });
    return prisma.run.create({
      data: {
        userId: user.id,
        carId: car.id,
        setupSnapshotId: snapshot.id,
        carNameSnapshot: car.name,
        sessionLabel: label,
        loggingComplete: true,
      },
      select: { id: true },
    });
  };

  const run = await seedRun("AAA", "Sheet repro A");
  const runB = await seedRun("BBB", "Sheet repro B");

  const signInUrl = await mintSignInUrl(email);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      { signInUrl, runId: run.id, runIdB: runB.id, markerA: "AAA", markerB: "BBB", email, modelId },
      null,
      2
    )
  );

  console.log(`\nChassis:  ${model?.name} (${modelId}), ${blank.pageCount} page(s)`);
  console.log(`Setup:    ${filledKeys} filled values copied from a real run`);
  console.log(`Account:  ${email}`);
  console.log(`Run A:    /runs/${run.id}  (text boxes read AAA)`);
  console.log(`Run B:    /runs/${runB.id}  (text boxes read BBB)`);
  console.log(`Wrote:    ${OUT}\n`);
  console.log(signInUrl + "\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
