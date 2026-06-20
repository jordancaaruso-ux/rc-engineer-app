import { isAuthAdminEmail } from "@/lib/authAdminLogic";

export type EventAccessUser = {
  id: string;
  email: string | null;
};

/** Creator or app admin may edit shared Event fields (name, dates, URLs, track link). */
export function canEditSharedEventFields(
  user: EventAccessUser,
  event: { userId: string | null }
): boolean {
  if (event.userId == null) return isAuthAdminEmail(user.email);
  return event.userId === user.id || isAuthAdminEmail(user.email);
}
