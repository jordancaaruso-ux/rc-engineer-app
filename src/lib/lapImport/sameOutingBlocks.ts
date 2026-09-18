import type { UrlImportBlock } from "@/components/runs/LapTimesIngestPanel";
import { trackClockTime } from "@/lib/lapImport/trackClock";
import { compareOutingSheets, type OutingSession } from "@/lib/runs/groupOutings";
import {
  durationFromDrivers,
  outingKindFor,
  sameTimeOnTrack,
  spanFrom,
  timeAnchorFor,
  type Span,
} from "@/lib/runs/outingSpan";

/**
 * One run per time on track, on the lap step (founder ruling 2026-09-15; carried to the wizard
 * 2026-09-17, "fix it using best judgement").
 *
 * A run holds more than one timing import for two different reasons, and joining them is only
 * right for one:
 *
 *   - A run split by a break comes back from the timing site as two sessions, one after the
 *     other. Both are the run's laps, joined in on-track order (`blockLapRows.ts`).
 *   - A track that posts to two timing sites (Speedhive's practice loop and a MyRCM result, LiveRC
 *     and Speedhive) posts the SAME race twice. Joined, every lap counts twice: a 25-lap heat reads
 *     50 laps, and the top-5 average, consistency and the Engineer all read the doubled list.
 *
 * The window each covers tells them apart (`sameTimeOnTrack`): copies of a race cover nearly the
 * same stretch, the halves of a split run only touch at the break. A copy stays with the run as a
 * LINKED SOURCE — linked on save, so the day never files it as a run of its own, and never part of
 * the laps. The official record leads (`compareOutingSheets`), as it does in the evening pass.
 *
 * Windows are read on the TRACK's clock, which every timing site posts (`trackClock.ts`), so a
 * driver who flew home from the meeting before logging it gets the same answer as one still in
 * the pits. `fallbackTimeZone` (the device's) only reads a Speedhive practice import from before
 * the track's offset was kept.
 */

/** Another timing site's copy of an attached import: saved with the run, never part of its laps. */
export type LinkedOutingSource = {
  importedSessionId: string;
  sourceUrl: string;
  parserId: string;
  /** The attached import it is a copy of. It comes off the run when that import does. */
  leadBlockId: string;
};

/**
 * The window an import's session covered, on the track's clock; null when it carries no session
 * time.
 */
export function blockOutingSpan(block: UrlImportBlock, fallbackTimeZone: string | null): Span | null {
  // The stored time before the parse's, as the evening pass reads it: the sweep corrects a stored
  // time from the site's list when a results page printed only the meeting's date.
  const onTrack = trackClockTime({
    iso: block.sessionCompletedAtDbIso?.trim() || block.sessionCompletedAtIso?.trim() || "",
    parserId: block.parserId,
    sourceUrl: block.sourceUrl,
    utcOffsetMinutes: block.sessionUtcOffsetMinutes,
    fallbackTimeZone,
  });
  if (!onTrack) return null;
  return spanFrom(
    onTrack,
    durationFromDrivers(block.sessionDrivers ?? []),
    timeAnchorFor(block.parserId, block.sourceUrl),
  );
}

function blockOutingSession(block: UrlImportBlock, fallbackTimeZone: string | null): OutingSession | null {
  const span = blockOutingSpan(block, fallbackTimeZone);
  if (!span) return null;
  const withLaps = (block.sessionDrivers ?? []).filter((d) => d.laps.length > 0);
  return {
    id: block.blockId,
    kind: outingKindFor(block.parserId, block.sourceUrl),
    start: span.start,
    end: span.end,
    driverCount: withLaps.length,
    lapCount: withLaps.reduce((max, d) => Math.max(max, d.laps.length), 0),
  };
}

export type SameOutingAttach =
  /** Covers no attached import's time on track: a first import, or the next half of a split run. */
  | { kind: "separate" }
  /** A copy of an attached import that does not outrank it: the attached one stays the laps. */
  | { kind: "linked"; leadBlockId: string }
  /** Outranks the attached copies it matches, or was brought on purpose: it becomes the laps. */
  | { kind: "replaces"; replacedBlockIds: string[] };

/**
 * What a newly attached import is to the ones already on the run.
 *
 * `incomingLeads` is for an import the driver went out of their way to bring for this race — a
 * MyRCM PDF, downloaded and handed over. It takes the laps even from an equal record, so the card
 * that received the file can go on to ask whose row is theirs.
 */
export function sameOutingAttach(
  attached: readonly UrlImportBlock[],
  incoming: UrlImportBlock,
  fallbackTimeZone: string | null,
  opts: { incomingLeads?: boolean } = {},
): SameOutingAttach {
  const mine = blockOutingSession(incoming, fallbackTimeZone);
  if (!mine) return { kind: "separate" };
  const matches: OutingSession[] = [];
  for (const block of attached) {
    if (block.blockId === incoming.blockId) continue;
    const theirs = blockOutingSession(block, fallbackTimeZone);
    if (theirs && sameTimeOnTrack(theirs, mine)) matches.push(theirs);
  }
  if (matches.length === 0) return { kind: "separate" };
  // Stable sort: on a tie the import attached first stays in front.
  const best = [...matches].sort(compareOutingSheets)[0]!;
  if (opts.incomingLeads || compareOutingSheets(mine, best) < 0) {
    return { kind: "replaces", replacedBlockIds: matches.map((m) => m.id) };
  }
  return { kind: "linked", leadBlockId: best.id };
}

function linkedSourceFor(block: UrlImportBlock, leadBlockId: string): LinkedOutingSource {
  return {
    importedSessionId: block.importedSessionId,
    sourceUrl: block.sourceUrl,
    parserId: block.parserId,
    leadBlockId,
  };
}

/**
 * Attach an import under the rule: the run's laps (`blocks`) and its linked sources after it, and
 * what happened, so the panel can say so.
 */
export function attachUnderSameOutingRule(input: {
  blocks: readonly UrlImportBlock[];
  linkedSources: readonly LinkedOutingSource[] | null | undefined;
  incoming: UrlImportBlock;
  fallbackTimeZone: string | null;
  incomingLeads?: boolean;
}): { blocks: UrlImportBlock[]; linkedSources: LinkedOutingSource[]; outcome: SameOutingAttach } {
  const { incoming } = input;
  // Laps or a copy, never both: a session taken on one way lets go of the other.
  const linked = (input.linkedSources ?? []).filter(
    (s) => s.importedSessionId !== incoming.importedSessionId,
  );
  const outcome = sameOutingAttach(input.blocks, incoming, input.fallbackTimeZone, {
    incomingLeads: input.incomingLeads,
  });

  if (outcome.kind === "separate") {
    return { blocks: [...input.blocks, incoming], linkedSources: linked, outcome };
  }
  if (outcome.kind === "linked") {
    return {
      blocks: [...input.blocks],
      linkedSources: incoming.importedSessionId.trim()
        ? [...linked, linkedSourceFor(incoming, outcome.leadBlockId)]
        : linked,
      outcome,
    };
  }
  const replaced = new Set(outcome.replacedBlockIds);
  return {
    blocks: [...input.blocks.filter((b) => !replaced.has(b.blockId)), incoming],
    linkedSources: [
      // The copies of what was replaced now ride with what replaced it.
      ...linked.map((s) => (replaced.has(s.leadBlockId) ? { ...s, leadBlockId: incoming.blockId } : s)),
      ...input.blocks
        .filter((b) => replaced.has(b.blockId) && b.importedSessionId.trim())
        .map((b) => linkedSourceFor(b, incoming.blockId)),
    ],
    outcome,
  };
}

/** The linked sources that stay when these attached imports come off the run. */
export function linkedSourcesAfterRemoving(
  linkedSources: readonly LinkedOutingSource[] | null | undefined,
  removedBlockIds: ReadonlySet<string>,
): LinkedOutingSource[] {
  return (linkedSources ?? []).filter((s) => !removedBlockIds.has(s.leadBlockId));
}

/**
 * A saved run's imports as the lap step reopens them: which were its laps, which only rode along.
 *
 * Every import a run's laps came from saved its field under its own address (the run's
 * `importedLapSets`), so a linked session with no saved sets there never supplied a lap — the
 * evening pass linked it, a save folded an app-made run in, or the driver brought the same race
 * from a second site. It reopens as a linked source when it covers the same time on track as one
 * that did. Reopened as laps, the next save joined it and every lap counted twice.
 *
 * Imports that did supply laps and still cover the same window — a run saved before this rule,
 * holding the race twice — keep the one that outranks, so the next save puts the laps right.
 *
 * When no saved set carries an address (runs saved before sets did), everything reopens as it
 * always has: there is nothing to tell the halves from the copies by.
 */
export function reopenUnderSameOutingRule(input: {
  blocks: readonly UrlImportBlock[];
  /** Addresses the run's saved lap sets carry. */
  lapSourceUrls: ReadonlySet<string>;
  fallbackTimeZone: string | null;
}): { blocks: UrlImportBlock[]; linkedSources: LinkedOutingSource[] } {
  const suppliedLaps = (b: UrlImportBlock) => input.lapSourceUrls.has(b.sourceUrl.trim());
  if (!input.blocks.some(suppliedLaps)) return { blocks: [...input.blocks], linkedSources: [] };

  const sessions = new Map(
    input.blocks.map((b) => [b.blockId, blockOutingSession(b, input.fallbackTimeZone)]),
  );
  // The laps' own sources first, then the fuller sheet: what is kept for each time on track is
  // what the saved laps came from, even when a linked copy outranks it.
  const byPreference = [...input.blocks].sort((a, b) => {
    const laps = Number(suppliedLaps(b)) - Number(suppliedLaps(a));
    if (laps !== 0) return laps;
    const sa = sessions.get(a.blockId);
    const sb = sessions.get(b.blockId);
    return sa && sb ? compareOutingSheets(sa, sb) : 0;
  });

  const kept: UrlImportBlock[] = [];
  const leadOf = new Map<string, string>();
  for (const block of byPreference) {
    const mine = sessions.get(block.blockId);
    const lead = mine
      ? kept.find((k) => {
          const theirs = sessions.get(k.blockId);
          return theirs ? sameTimeOnTrack(theirs, mine) : false;
        })
      : undefined;
    if (lead) leadOf.set(block.blockId, lead.blockId);
    else kept.push(block);
  }

  const keptIds = new Set(kept.map((b) => b.blockId));
  return {
    // In the order they came, which is on-track order.
    blocks: input.blocks.filter((b) => keptIds.has(b.blockId)),
    linkedSources: input.blocks
      .filter((b) => leadOf.has(b.blockId) && b.importedSessionId.trim())
      .map((b) => linkedSourceFor(b, leadOf.get(b.blockId)!)),
  };
}
