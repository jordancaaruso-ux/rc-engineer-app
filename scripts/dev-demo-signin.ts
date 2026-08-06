/**
 * dev-demo-signin.ts — DEV/TEST ONLY. Prints a sign-in link for the shared demo account.
 *
 * `/api/auth/demo` needs DEMO_USER_ID + DEMO_USER_EMAIL in the environment and 503s without them,
 * which is the common local case. This mints the same single-use magic-link token the demo route
 * would, so the demo account can be reviewed (or screenshotted) locally without setting those up.
 *
 * The demo account is the only one carrying a full season, which makes it the right account for
 * capturing read-only surfaces — Analysis, Sessions, Engineer, Teams — where a fresh account shows
 * empty states. It is read-only by middleware, so nothing here can write to it.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-demo-signin.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

const DEMO_EMAIL = process.env.DEMO_USER_EMAIL?.trim().toLowerCase() || "demo@jrcdynamics.com";

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`\nDatabase: ${dbHost}`);
  if (/ep-hidden-rice/.test(dbHost)) throw new Error("REFUSING TO RUN: that is PRODUCTION.");

  const user = await prisma.user.findFirst({
    where: { email: DEMO_EMAIL },
    select: { id: true, email: true, _count: { select: { runs: true } } },
  });
  if (!user) throw new Error(`No demo account (${DEMO_EMAIL}) — run \`npm run demo:seed\` first.`);

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  const baseUrl = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000")
    .trim()
    .replace(/\/$/, "");

  // The signIn callback rejects anything not allowlisted; the seed writes this row, but a
  // hand-restored database may not have it.
  await prisma.authAllowedEmail.upsert({
    where: { email: user.email! },
    update: {},
    create: { email: user.email! },
  });

  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: user.email!,
      token: createHash("sha256").update(`${token}${secret}`).digest("hex"),
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const params = new URLSearchParams({ callbackUrl: `${baseUrl}/`, token, email: user.email! });

  // Ids for detail-page captures, so a screenshot run doesn't have to click its way in.
  const [run, car, savedSetup, event, track] = await Promise.all([
    prisma.run.findFirst({
      // `lapTimes` is a non-nullable Json column defaulting to `[]`, so "has laps" is
      // not-the-empty-array. Filtering against `null` matches the JSON null *literal*, which no
      // row ever holds — it would hand back a lapless run for the lap-detail capture.
      where: { userId: user.id, NOT: { lapTimes: { equals: [] } } },
      orderBy: { sortAt: "desc" },
      select: { id: true },
    }),
    prisma.car.findFirst({ where: { userId: user.id }, select: { id: true } }),
    prisma.setupSnapshot.findFirst({
      where: { userId: user.id, isLibrary: true },
      select: { id: true, carId: true },
    }),
    prisma.run.findFirst({
      where: { userId: user.id, NOT: { eventId: null } },
      orderBy: { sortAt: "desc" },
      select: { eventId: true },
    }),
    prisma.run.findFirst({
      where: { userId: user.id, NOT: { trackId: null } },
      orderBy: { sortAt: "desc" },
      select: { trackId: true },
    }),
  ]);

  console.log(`Account:  ${user.email}  (${user._count.runs} runs)`);
  console.log(`RUN_ID=${run?.id ?? ""}`);
  console.log(`CAR_ID=${car?.id ?? ""}`);
  console.log(`SETUP_ID=${savedSetup?.id ?? ""}`);
  console.log(`SETUP_CAR_ID=${savedSetup?.carId ?? ""}`);
  console.log(`EVENT_ID=${event?.eventId ?? ""}`);
  console.log(`TRACK_ID=${track?.trackId ?? ""}`);
  console.log("\nSign-in URL (single use, 24h):\n");
  console.log(`${baseUrl}/api/auth/callback/nodemailer?${params}`);
  console.log("");
}

main()
  .catch((e) => {
    console.error("ERR: " + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
