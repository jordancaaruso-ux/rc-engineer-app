/**
 * Reporting what another driver wrote or added: the pure rules, Prisma-free so the tests run
 * offline. App Store guideline 1.2 (2026-09-26) asks every app with user-generated content for a
 * way to report it, a way to block, a filter, and a response within 24 hours.
 *
 * What can be reported is everything one driver's words reach another with: a team comment, a
 * teammate (their runs' notes, their name), and the shared catalog entries drivers add — a
 * track, a tire, a chassis made from an uploaded sheet.
 */

export const REPORT_KINDS = ["comment", "driver", "track", "tire", "chassis"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_REASONS = ["abusive", "spam", "wrong", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** What the reporter taps. "Wrong or duplicate" only makes sense for a catalog entry. */
export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  abusive: "Offensive or abusive",
  spam: "Spam",
  wrong: "Wrong or duplicate",
  other: "Something else",
};

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  comment: "Comment",
  driver: "Driver",
  track: "Track",
  tire: "Tire",
  chassis: "Chassis",
};

/** The reasons offered for a kind, in the order the sheet shows them. */
export function reasonsForKind(kind: ReportKind): ReportReason[] {
  return kind === "comment" || kind === "driver"
    ? ["abusive", "spam", "other"]
    : ["abusive", "wrong", "other"];
}

/** Enough of what it said to judge it by, not a copy of a 2,000-character comment. */
export const REPORT_EXCERPT_MAX = 500;

export function reportExcerpt(text: string | null | undefined): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "(empty)";
  return flat.length > REPORT_EXCERPT_MAX ? `${flat.slice(0, REPORT_EXCERPT_MAX - 1)}…` : flat;
}

export function isReportKind(raw: unknown): raw is ReportKind {
  return typeof raw === "string" && (REPORT_KINDS as readonly string[]).includes(raw);
}

export function isReportReason(raw: unknown): raw is ReportReason {
  return typeof raw === "string" && (REPORT_REASONS as readonly string[]).includes(raw);
}

export type ReportInput = {
  kind: ReportKind;
  targetId: string;
  reason: ReportReason;
  teamId: string | null;
};

/** Check a report body from the client. Nothing in it is trusted beyond its shape. */
export function parseReportInput(
  raw: unknown
): { ok: true; input: ReportInput } | { ok: false; error: string } {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!isReportKind(body.kind)) return { ok: false, error: "Unknown report type" };
  const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
  if (!targetId || targetId.length > 64) return { ok: false, error: "Missing what to report" };
  const reason = body.reason;
  if (typeof reason !== "string" || !reasonsForKind(body.kind).includes(reason as ReportReason)) {
    return { ok: false, error: "Pick a reason" };
  }
  const teamId =
    typeof body.teamId === "string" && body.teamId.trim() && body.teamId.length <= 64
      ? body.teamId.trim()
      : null;
  return {
    ok: true,
    input: { kind: body.kind, targetId, reason: reason as ReportReason, teamId },
  };
}

/** What the founder can do from the review queue, per kind. */
export type ReportAction = "remove" | "dismiss";

/**
 * "Remove" deletes a comment or takes a driver out of the team they were reported from. A
 * catalog entry has its own delete and merge on its page, which also weigh the runs using it,
 * so the queue only closes those.
 */
export function reportCanRemove(kind: ReportKind, teamId: string | null): boolean {
  if (kind === "comment") return true;
  if (kind === "driver") return teamId != null;
  return false;
}

export function parseReportAction(raw: unknown): ReportAction | null {
  return raw === "remove" || raw === "dismiss" ? raw : null;
}
