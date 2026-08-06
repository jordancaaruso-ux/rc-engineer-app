import "server-only";
import type { User } from "@prisma/client";
import { getEntitlement } from "@/lib/entitlement";
import { isBillingEnforced } from "@/lib/entitlementLogic";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { isDemoIdentity } from "@/lib/demo/demoAccess";
import {
  PRO_ENGINEER_MONTHLY_QUESTIONS,
  STANDARD_ENGINEER_DAILY_QUESTIONS,
  engineerQuestionCount,
} from "@/lib/aiUsage/budgets";
import { TIER_LABELS } from "@/lib/brand/brandNames";
import { engineerQuotaSnapshot } from "@/lib/aiUsage/ledger";

/**
 * The "remaining this month" meter (MONETISATION_NORTH_STAR.md Phase 2), rendered as the
 * Engineer page's subtitle so a racer can plan their questions without hunting for a number.
 * Null = no meter: billing dark, admin, or grandfathered/comped — those keep the plain subtitle.
 * Notebook's line doubles as the standing upsell; the tier's whole pitch is the contrast.
 */
export async function engineerQuotaNote(user: User): Promise<string | null> {
  if (!isBillingEnforced()) return null;
  if (isAuthAdminEmail(user.email)) return null;
  // No meter for the demo. The demo account carries a seeded fake top-tier subscription for
  // entitlement, so this would advertise "100 of 100 Engineer questions left this month" while
  // the chat route actually stops a demo visitor at 2 per day per IP (inside a 15/day, 100/month
  // global ceiling). A number wrong by two orders of magnitude is worse than no number: it reads
  // as generous right up until the third question is refused. The refusal copy already states the
  // limit, and states it as the upsell. Sits before getEntitlement to skip that query too.
  if (isDemoIdentity({ id: user.id, email: user.email })) return null;
  const entitlement = await getEntitlement(user);
  if (entitlement.grandfathered) return null;
  const snapshot = await engineerQuotaSnapshot(user.id);
  if (entitlement.tier === "pro") {
    const remaining = Math.max(0, PRO_ENGINEER_MONTHLY_QUESTIONS - snapshot.month);
    return `${remaining} of ${engineerQuestionCount(PRO_ENGINEER_MONTHLY_QUESTIONS)} left this month.`;
  }
  if (entitlement.tier === "standard") {
    const remaining = Math.max(0, STANDARD_ENGINEER_DAILY_QUESTIONS - snapshot.today);
    return `${remaining} of ${engineerQuestionCount(STANDARD_ENGINEER_DAILY_QUESTIONS)} left today — ${TIER_LABELS.pro} includes ${PRO_ENGINEER_MONTHLY_QUESTIONS} a month.`;
  }
  return null;
}
