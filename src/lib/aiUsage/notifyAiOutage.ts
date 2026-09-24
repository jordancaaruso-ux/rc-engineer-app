import "server-only";

import { prisma } from "@/lib/prisma";
import { parseAuthAdminEmails } from "@/lib/authAdmin";
import { sendPushToUser } from "@/lib/webPush/server";

/** Once per half hour per server instance: an outage should ping, not flood. */
const MIN_GAP_MS = 30 * 60 * 1000;
let lastSentAt = 0;

/**
 * Push every admin when OpenAI refuses the Engineer for billing — credit gone, card declined
 * (2026-09-24 launch audit). The driver only reads "Engineer is unavailable right now", which is
 * right for them and useless for the founder: without this he would hear about it from a support
 * email, hours in. A push that reaches no device falls back to email (`sendPushToUser`).
 * Never throws — the answer path must not depend on the ping landing.
 */
export async function notifyAdminsOfAiOutage(): Promise<void> {
  const now = Date.now();
  if (now - lastSentAt < MIN_GAP_MS) return;
  lastSentAt = now;
  console.error("[ai-outage] OpenAI refused the Engineer for billing");

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
          title: "The Engineer is down: OpenAI billing",
          body: "OpenAI refused a question over billing. Check the credit balance and the card on the OpenAI account.",
          url: "/engineer",
          tag: "ai-outage",
        }).catch((error) => {
          console.error("[ai-outage] push failed", error);
        })
      )
    );
  } catch (error) {
    console.error("[ai-outage] admin notify failed", error);
  }
}
