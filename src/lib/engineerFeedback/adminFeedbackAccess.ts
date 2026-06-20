import { parseAuthAdminEmails, isAuthAdminEmail } from "@/lib/authAdminLogic";

/** Prisma filter: ratings from AUTH_ADMIN_EMAILS users only (founder feedback). */
export function adminFeedbackRatingWhere() {
  const emails = [...parseAuthAdminEmails()];
  if (emails.length === 0) {
    return { userId: "__no_admin_configured__" };
  }
  return {
    user: {
      email: { in: emails, mode: "insensitive" as const },
    },
  };
}

export function canSubmitEngineerFeedback(email: string | null | undefined): boolean {
  return isAuthAdminEmail(email);
}
