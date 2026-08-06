/**
 * dev-billing-states.ts — DEV/TEST ONLY. One command to see every paywall state without paying:
 * creates three throwaway subscriber accounts directly in the dev DB and prints a sign-in link
 * for each. They authenticate via the Subscription-row branch of `isEmailAuthAllowed` — no
 * allowlist rows, exactly like real payers (docs/MONETISATION_NORTH_STAR.md).
 *
 *   npm run dev:enforced          # dev server with BILLING_ENFORCED=1
 *   npm run billing:states        # prints three links + what each should show
 *   npm run billing:states:cleanup
 *
 * States: LAPSED (canceled sub → every page bounces to /billing) · STANDARD (active, today's 2
 * Engineer questions already spent → locked video/roll-center, "0 of 2 left" meter, next ask
 * refused with the Pro upsell) · PRO (active → everything open, "300 of 300 left this month").
 * With enforcement OFF all three behave like any full-access account — run dev:enforced.
 *
 * The `+ob` aliases are the same family dev-fresh-onboarding reaps, so `npm run
 * onboarding:cleanup` also removes them. Subscription rows use fake `sub_devstate_*` ids —
 * nothing here touches Stripe.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  aiUsageTimeZone,
  PRO_ENGINEER_MONTHLY_QUESTIONS,
  STANDARD_ENGINEER_DAILY_QUESTIONS,
} from "@/lib/aiUsage/budgets";
import { todayYmdInTimeZone } from "@/lib/eventActive";

const BASE = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000")
  .trim()
  .replace(/\/$/, "");

const STATES = [
  {
    key: "lapsed",
    email: "jordancaaruso+ob-billing-lapsed@gmail.com",
    tier: "standard",
    status: "canceled",
    periodEnd: () => new Date(Date.now() - 40 * 86400000),
    expect: "every page → /billing (renew wall)",
  },
  {
    key: "standard",
    email: "jordancaaruso+ob-billing-std@gmail.com",
    tier: "standard",
    status: "active",
    periodEnd: () => new Date(Date.now() + 30 * 86400000),
    // Interpolated, not spelled out: these expectations are printed to whoever runs the script, and
    // a hardcoded number here quietly becomes a lie the next time the allowances move (it already
    // did once — this line said "0 of 2 left today" after the 2026-08-06 reprice to 1/day).
    expect: `/videos + /analysis/roll-center locked · /engineer '${STANDARD_ENGINEER_DAILY_QUESTIONS} of ${STANDARD_ENGINEER_DAILY_QUESTIONS} ... left today' · next ask refused`,
  },
  {
    key: "pro",
    email: "jordancaaruso+ob-billing-pro@gmail.com",
    tier: "pro",
    status: "active",
    periodEnd: () => new Date(Date.now() + 30 * 86400000),
    expect: `everything open · /engineer '${PRO_ENGINEER_MONTHLY_QUESTIONS} of ${PRO_ENGINEER_MONTHLY_QUESTIONS} ... left this month'`,
  },
] as const;

async function mintSignInUrl(email: string): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — run via npm so .env.local loads.");
  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: createHash("sha256").update(`${token}${secret}`).digest("hex"),
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const params = new URLSearchParams({ callbackUrl: `${BASE}/`, token, email });
  return `${BASE}/api/auth/callback/nodemailer?${params}`;
}

async function cleanup(): Promise<void> {
  for (const s of STATES) {
    const user = await prisma.user.findFirst({ where: { email: s.email }, select: { id: true } });
    if (user) {
      await prisma.user.delete({ where: { id: user.id } });
      console.log(`deleted ${s.email}`);
    }
    await prisma.verificationToken.deleteMany({ where: { identifier: s.email } });
  }
  console.log("Done — only the +ob-billing-* aliases were touched.");
}

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`\nDatabase: ${dbHost}\n`);

  if (process.argv.includes("--cleanup")) {
    await cleanup();
    return;
  }

  for (const s of STATES) {
    const user = await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: { email: s.email, stripeCustomerId: `cus_devstate_${s.key}` },
    });
    await prisma.subscription.upsert({
      where: { userId: user.id },
      update: { status: s.status, tier: s.tier, currentPeriodEnd: s.periodEnd() },
      create: {
        userId: user.id,
        stripeSubscriptionId: `sub_devstate_${s.key}`,
        stripeCustomerId: `cus_devstate_${s.key}`,
        status: s.status,
        tier: s.tier,
        currentPeriodEnd: s.periodEnd(),
        cancelAtPeriodEnd: s.status === "canceled",
      },
    });
    if (s.key === "standard") {
      // Burn today's 2 questions so the refusal + "0 of 2" meter show without real AI spend.
      const day = new Date(`${todayYmdInTimeZone(aiUsageTimeZone())}T00:00:00.000Z`);
      await prisma.aiUsageDaily.upsert({
        where: { userId_day_feature: { userId: user.id, day, feature: "engineer-chat" } },
        update: { calls: 2 },
        create: { userId: user.id, day, feature: "engineer-chat", calls: 2, costUsd: 0.11 },
      });
    }
    const url = await mintSignInUrl(s.email);
    console.log(`${s.key.toUpperCase()} — expect: ${s.expect}`);
    console.log(`${url}\n`);
  }
  console.log("Links are single-use — rerun this to mint fresh ones (accounts are reused).");
  console.log("Use separate browsers/profiles per link, or sign out between them.");
  console.log("Remember: enforcement only shows with `npm run dev:enforced`.\n");
}

main()
  .catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : err}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
