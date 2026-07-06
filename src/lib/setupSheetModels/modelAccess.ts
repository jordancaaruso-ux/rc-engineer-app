import { isAuthAdminEmail } from "@/lib/authAdmin";

/**
 * Setup sheet models are global. Only an admin — or the creator while the model is still
 * unauthorized — may edit a shared model's name/schema or delete it. Authorizing is admin-only.
 * Single source of truth for the API route and the schema editor page.
 */
export function canEditSetupSheetModel(
  user: { id: string; email: string | null },
  model: { userId: string | null; isAuthorized: boolean }
): boolean {
  if (isAuthAdminEmail(user.email)) return true;
  return model.userId === user.id && !model.isAuthorized;
}
