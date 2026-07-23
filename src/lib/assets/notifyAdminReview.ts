import "server-only";

import { prisma } from "@/lib/prisma";
import { parseAuthAdminEmails, isAuthAdminEmail } from "@/lib/authAdmin";
import { sendPushToUser } from "@/lib/webPush/server";

/**
 * Best-effort push to every admin when a user creates an unverified global-catalog row, so the
 * founder's review queue (/admin/review) doesn't rot silently at open signup. One shared `tag`
 * so a busy race day collapses into a single lock-screen notification instead of a stack.
 * Skips admin-created rows (deliberate, no point self-pinging). Never throws — the create
 * response must not depend on the ping landing. See docs/ASSET_ACCESS_NORTH_STAR.md.
 */
export async function notifyAdminsOfUnverifiedAsset(input: {
  kind: string;
  label: string;
  createdByEmail?: string | null;
}): Promise<void> {
  if (input.createdByEmail && isAuthAdminEmail(input.createdByEmail)) return;
  const adminEmails = [...parseAuthAdminEmails()];
  if (adminEmails.length === 0) return;

  try {
    const admins = await prisma.user.findMany({
      where: { email: { in: adminEmails } },
      select: { id: true },
    });
    await Promise.all(
      admins.map((admin) =>
        sendPushToUser(admin.id, {
          title: "New catalog entry to review",
          body: `${input.kind}: "${input.label}"`,
          url: "/admin/review",
          tag: "catalog-review",
        }).catch((error) => {
          console.error("[catalog-review] push failed", error);
        })
      )
    );
  } catch (error) {
    console.error("[catalog-review] admin notify failed", error);
  }
}
