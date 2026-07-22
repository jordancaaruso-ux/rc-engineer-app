import "server-only";

import { prisma } from "@/lib/prisma";
import { parseAuthAdminEmails } from "@/lib/authAdmin";
import { sendPushToUser } from "@/lib/webPush/server";
import { normalizeSetupSheetModelName } from "@/lib/setupSheetModels/normalizeModelName";

/**
 * Chassis types are admin-only to create (they imply a schema + calibration a driver can't
 * finish), so a driver whose car isn't in the catalog used to get a bare 403 and the founder
 * never heard about it. `ASSET_ACCESS_NORTH_STAR.md` calls for the request to ping instead.
 *
 * Recording is best-effort: the caller's response must not depend on the ping landing.
 */

/** Upserts the request (repeat asks bump a counter) and nudges every admin. */
export async function recordChassisTypeRequest(input: {
  userId: string;
  userEmail?: string | null;
  requestedName: string;
}): Promise<void> {
  const requestedName = input.requestedName.trim().slice(0, 120);
  if (!requestedName) return;
  const normalizedName = normalizeSetupSheetModelName(requestedName);

  try {
    const row = await prisma.chassisTypeRequest.upsert({
      where: { userId_normalizedName: { userId: input.userId, normalizedName } },
      create: { userId: input.userId, requestedName, normalizedName },
      update: { requestCount: { increment: 1 }, resolvedAt: null },
      select: { requestCount: true },
    });
    // Only ping on the first ask — a driver retrying shouldn't spam the founder's lock screen.
    if (row.requestCount === 1) {
      await notifyAdminsOfChassisRequest(requestedName, input.userEmail ?? null);
    }
  } catch (error) {
    console.error("[chassis-request] failed to record request", error);
  }
}

async function notifyAdminsOfChassisRequest(
  requestedName: string,
  requesterEmail: string | null
): Promise<void> {
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
          title: "Chassis type requested",
          body: requesterEmail
            ? `${requesterEmail} needs "${requestedName}"`
            : `Someone needs "${requestedName}"`,
          url: "/setup/admin",
          tag: "chassis-request",
        }).catch((error) => {
          console.error("[chassis-request] push failed", error);
        })
      )
    );
  } catch (error) {
    console.error("[chassis-request] admin notify failed", error);
  }
}

export type PendingChassisRequest = {
  id: string;
  requestedName: string;
  requestCount: number;
  createdAt: Date;
  requesterEmail: string | null;
};

/** Open requests, newest first — the minimal review surface until Phase 2's /admin/review lands. */
export async function listPendingChassisTypeRequests(take = 50): Promise<PendingChassisRequest[]> {
  const rows = await prisma.chassisTypeRequest.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      requestedName: true,
      requestCount: true,
      createdAt: true,
      user: { select: { email: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    requestedName: r.requestedName,
    requestCount: r.requestCount,
    createdAt: r.createdAt,
    requesterEmail: r.user.email,
  }));
}
