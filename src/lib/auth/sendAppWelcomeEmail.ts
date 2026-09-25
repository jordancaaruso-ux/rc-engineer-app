import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BRAND_DOMAIN, TIER_LABELS } from "@/lib/brand/brandNames";
import { getPricePlansWithAmounts } from "@/lib/stripe";
import {
  DEFAULT_PRICE_CURRENCY,
  formatPlanAmount,
  type PriceCurrency,
} from "@/lib/billing/priceCurrencyLogic";
import { PRO_ENGINEER_MONTHLY_QUESTIONS } from "@/lib/aiUsage/budgets";
import { STARTER_RUN_WINDOW, type PaidTier } from "@/lib/entitlementLogic";
import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail";
import { renderAppWelcomeEmail, type AppWelcomePlan } from "@/lib/auth/appWelcomeEmail";

/** `AppSetting` key marking the app welcome email as sent: one per account, ever. */
const SENT_KEY = "appWelcomeEmailSentAt";

const TIERS: PaidTier[] = ["starter", "standard", "pro"];

const HOOKS: Record<PaidTier, string> = {
  starter: `Your last ${STARTER_RUN_WINDOW} runs`,
  standard: "Every run kept",
  pro: `The Engineer, ${PRO_ENGINEER_MONTHLY_QUESTIONS} questions a month`,
};

/** Links open the site that sent the email — same rule as the evening summary. */
function appOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  return raw && /^https?:\/\//.test(raw) ? raw : `https://www.${BRAND_DOMAIN}`;
}

async function welcomePlans(currency: PriceCurrency): Promise<AppWelcomePlan[]> {
  const listed = await getPricePlansWithAmounts(currency).catch(() => []);
  // Only tiers that are on sale — Starter appears once its price is configured, as on /join.
  const tiers = listed.length ? TIERS.filter((t) => listed.some((p) => p.tier === t)) : TIERS;
  return tiers.map((tier) => {
    const month = listed.find((p) => p.tier === tier && p.interval === "month");
    const monthly = month ? formatPlanAmount(month.unitAmount, month.currency) : null;
    return { label: TIER_LABELS[tier], hook: HOOKS[tier], monthly };
  });
}

/**
 * Send the welcome email to an account made by the app's sign-up, the first time it reaches the
 * "You're signed up" screen — so only an address whose owner has typed its code gets one.
 *
 * The marker row is written BEFORE sending, and its unique (userId, key) is the lock: two renders
 * racing each other send once. A failed send removes the marker, so the next visit tries again
 * instead of the screen promising an email that never left.
 */
export async function sendAppWelcomeEmailOnce(
  user: { id: string; email: string },
  /** Where they signed up, read by the caller while it still has the request: /join prices them in it. */
  currency: PriceCurrency = DEFAULT_PRICE_CURRENCY
): Promise<void> {
  // The screen refreshes itself while it waits for a plan, so the usual answer is "already sent";
  // read before claiming rather than failing an insert on every refresh.
  const marker = await prisma.appSetting.findUnique({
    where: { userId_key: { userId: user.id, key: SENT_KEY } },
    select: { id: true },
  });
  if (marker) return;

  try {
    await prisma.appSetting.create({
      data: { userId: user.id, key: SENT_KEY, value: new Date().toISOString() },
      select: { id: true },
    });
  } catch (err) {
    const alreadySent = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (alreadySent) return;
    throw err;
  }

  try {
    const plansUrl = `${appOrigin()}/join?${new URLSearchParams({ email: user.email, from: "app" })}`;
    const rendered = renderAppWelcomeEmail({
      recipientEmail: user.email,
      plans: await welcomePlans(currency),
      plansUrl,
    });
    await sendTransactionalEmail(
      { to: user.email, subject: rendered.subject, text: rendered.text, html: rendered.html },
      { label: "app-welcome" }
    );
  } catch (err) {
    await prisma.appSetting
      .delete({ where: { userId_key: { userId: user.id, key: SENT_KEY } } })
      .catch(() => {});
    throw err;
  }
}
