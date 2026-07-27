import "server-only";

import { sendPushToUser } from "@/lib/webPush/server";

/**
 * Best-effort pushes for the team invite handshake.
 *
 * An invite nobody notices is the same privacy problem as no invite at all — the whole point of the
 * consent gate is that the invited driver gets to answer — so this fires on send. `sendPushToUser`
 * already fans out to web push *and* APNs, so one call reaches browsers, installed PWAs and the iOS
 * shell. The in-app cards on `/teams` and the dashboard are the fallback for anyone with no push
 * permission granted.
 *
 * Never throws: the invite is already committed by the time we get here, and a failed ping must not
 * turn a successful invite into a 500. Same shape as `notifyAdminsOfUnverifiedAsset`.
 */
export async function notifyUserOfTeamInvite(input: {
  invitedUserId: string;
  teamName: string;
  invitedByLabel: string | null;
}): Promise<void> {
  const who = input.invitedByLabel?.trim();
  try {
    await sendPushToUser(input.invitedUserId, {
      title: "Team invite",
      body: who
        ? `${who} invited you to ${input.teamName}`
        : `You have been invited to ${input.teamName}`,
      url: "/teams",
      tag: "team-invite",
    });
  } catch (error) {
    console.error("[team-invite] invite push failed", error);
  }
}

/**
 * Tell the admin their invite was answered — they need to know whether to expect the data, and a
 * decline should not be silent or it reads as "still pending" forever.
 */
export async function notifyAdminOfTeamInviteReply(input: {
  adminUserId: string;
  teamName: string;
  responderLabel: string | null;
  accepted: boolean;
}): Promise<void> {
  const who = input.responderLabel?.trim() || "Someone";
  try {
    await sendPushToUser(input.adminUserId, {
      title: input.accepted ? "Team invite accepted" : "Team invite declined",
      body: `${who} ${input.accepted ? "joined" : "declined"} ${input.teamName}`,
      url: "/teams",
      tag: "team-invite-reply",
    });
  } catch (error) {
    console.error("[team-invite] reply push failed", error);
  }
}
