import "server-only";
import type { User } from "@prisma/client";
import { getEntitlement } from "@/lib/entitlement";
import { isBillingEnforced } from "@/lib/entitlementLogic";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import {
  PRO_ENGINEER_MONTHLY_QUESTIONS,
  STANDARD_ENGINEER_DAILY_QUESTIONS,
} from "@/lib/aiUsage/budgets";
import { engineerQuotaSnapshot } from "@/lib/aiUsage/ledger";

/**
 * The "remaining this month" meter (MONETISATION_NORTH_STAR.md Phase 2), rendered as the
 * Engineer page's subtitle so a racer can plan their questions without hunting for a number.
 * Null = no meter: billing dark, admin, or grandfathered/comped — those keep the plain subtitle.
 * Standard's line doubles as the standing upsell; the tier's whole pitch is the contrast.
 */
export async function engineerQuotaNote(user: User): Promise<string | null> {
  if (!isBillingEnforced()) return null;
  if (isAuthAdminEmail(user.email)) return null;
  const entitlement = await getEntitlement(user);
  if (entitlement.grandfathered) return null;
  const snapshot = await engineerQuotaSnapshot(user.id);
  if (entitlement.tier === "pro") {
    const remaining = Math.max(0, PRO_ENGINEER_MONTHLY_QUESTIONS - snapshot.month);
    return `${remaining} of ${PRO_ENGINEER_MONTHLY_QUESTIONS} Engineer questions left this month.`;
  }
  if (entitlement.tier === "standard") {
    const remaining = Math.max(0, STANDARD_ENGINEER_DAILY_QUESTIONS - snapshot.today);
    return `${remaining} of ${STANDARD_ENGINEER_DAILY_QUESTIONS} questions left today — Pro includes ${PRO_ENGINEER_MONTHLY_QUESTIONS} a month.`;
  }
  return null;
}
