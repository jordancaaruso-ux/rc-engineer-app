import { formatRunSessionDisplay } from "@/lib/runSession";
import { chassisChangedKeys } from "@/lib/setup/runContextSetupKeys";

/**
 * One car's setup history: the runs where the chassis actually changed, plus the sheets uploaded
 * for it. Saved baselines are deliberately absent — they get their own section on the car page.
 *
 * Two rules make this list readable (founder call 2026-07-22):
 *  - a run earns a row only when something outside `RUN_CONTEXT_SETUP_KEYS` changed, so picking
 *    tires or bumping additive time never reads as a setup change;
 *  - an uploaded sheet that produced a setup is *one* row — the setup, with the PDF hung off it.
 *
 * Pure on purpose: the DB reads live in `getCarSetupHistory.ts`.
 */

export type CarSetupHistoryKind = "run" | "sheet";

export type CarSetupHistoryEntry = {
  /** Stable React key — snapshot id for setups, document id for sheets that made none. */
  id: string;
  kind: CarSetupHistoryKind;
  at: string;
  dateLabel: string;
  title: string;
  meta: string;
  /** Human labels for what changed. Empty for sheets. */
  changedLabels: string[];
  href: string;
};

export type SetupHistoryRunInput = {
  id: string;
  createdAt: Date;
  sessionType: string;
  meetingSessionType: string | null;
  meetingSessionCode: string | null;
  sessionLabel: string | null;
  setupSnapshotId: string;
  track: { name: string } | null;
  event: { name: string } | null;
  setupSnapshot: { setupDeltaJson: unknown; baseSetupSnapshotId: string | null } | null;
};

export type SetupHistoryDocumentInput = {
  id: string;
  originalFilename: string;
  createdAt: Date;
  parseStatus: string;
  createdSetupId: string | null;
};

function sheetTitle(filename: string): string {
  const withoutExt = filename.replace(/\.[a-z0-9]+$/i, "");
  return withoutExt.trim() || filename;
}

function sheetMeta(doc: SetupHistoryDocumentInput): string {
  if (doc.createdSetupId) return "Uploaded sheet";
  const status = doc.parseStatus.toLowerCase();
  if (status === "failed") return "Uploaded sheet · couldn’t be read";
  if (status === "parsed") return "Uploaded sheet · no setup created";
  return `Uploaded sheet · ${status} read, needs review`;
}

export function buildCarSetupHistory(input: {
  carId: string;
  runs: SetupHistoryRunInput[];
  documents: SetupHistoryDocumentInput[];
  labelForKey: (key: string) => string;
  formatDate: (at: Date) => string;
}): CarSetupHistoryEntry[] {
  const entries: CarSetupHistoryEntry[] = [];

  for (const run of input.runs) {
    const snapshot = run.setupSnapshot;
    const changed = chassisChangedKeys(snapshot?.setupDeltaJson);
    // No baseline at all = the first setup recorded on this car, which is a change by definition.
    const isFirstSetup = !snapshot?.baseSetupSnapshotId;
    if (changed.length === 0 && !isFirstSetup) continue;

    const session = formatRunSessionDisplay(
      {
        sessionType: run.sessionType,
        meetingSessionType: run.meetingSessionType,
        meetingSessionCode: run.meetingSessionCode,
        sessionLabel: run.sessionLabel,
      },
      { fallback: "Testing run" }
    );
    entries.push({
      id: run.setupSnapshotId,
      kind: "run",
      at: run.createdAt.toISOString(),
      dateLabel: input.formatDate(run.createdAt),
      title: run.event?.name ? `${run.event.name} · ${session}` : session,
      meta:
        changed.length === 0 && isFirstSetup
          ? [run.track?.name, "first setup on this car"].filter(Boolean).join(" · ")
          : (run.track?.name ?? "No track"),
      changedLabels: changed.map(input.labelForKey),
      href: `/cars/${input.carId}/setups/${run.setupSnapshotId}`,
    });
  }

  for (const doc of input.documents) {
    entries.push({
      id: doc.createdSetupId ?? doc.id,
      kind: "sheet",
      at: doc.createdAt.toISOString(),
      dateLabel: input.formatDate(doc.createdAt),
      title: sheetTitle(doc.originalFilename),
      meta: sheetMeta(doc),
      changedLabels: [],
      href: doc.createdSetupId
        ? `/cars/${input.carId}/setups/${doc.createdSetupId}`
        : `/setup-documents/${doc.id}`,
    });
  }

  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return entries;
}
