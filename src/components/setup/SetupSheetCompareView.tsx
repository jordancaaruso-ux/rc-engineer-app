"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { outlineButtonClassName } from "@/components/ui/ButtonLink";
import { ReadOnlySheetSurface } from "@/components/setup/ReadOnlySheetSurface";
import { SheetCompareSurface } from "@/components/setup/SheetCompareSurface";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  SETUP_COMPARE_SOURCE_LABEL,
  fetchSetupCompareEntries,
  pickEditionBlankForPair,
  type SetupCompareEntry,
  type SetupComparePickerSource,
} from "@/lib/setupCompare/setupCompareEntries";
import type { LabSource } from "@/lib/rollCenter/labState";

/**
 * A setup read from the garage, with the compare the session view has always had.
 *
 * Founder call 2026-08-31: a setup opened from Paddock → Cars → Setups — and a published baseline —
 * could be read but not compared, while the same setup opened from its run could. The gap was
 * plumbing, not intent: the session's compare loads every candidate list BY RUN ID
 * (`/api/runs/for-setup-compare?runId=…`), and a saved setup or an uploaded sheet has no run to key
 * off. So this one draws its candidates from the run-free picker pools instead — see
 * `setupCompareEntries`, which the standalone `/setup/comparison` page now shares, so the two offer
 * the same rows under the same names.
 *
 * WHAT IT IS NOT: a second comparison. The answer is still `SheetCompareSurface` — both setups in
 * the same boxes on one page picture, held to flip between them. Nothing is drawn on the paper.
 *
 * THE SETUP BEING READ IS ALWAYS SIDE A, and its values arrive as a prop from the server page. That
 * is the whole reason this is inline rather than a link to `/setup/comparison?a=…`: those params
 * carry an ENTRY id, which exists only for a setup sitting in one of the three pools, and a sheet
 * you uploaded but never kept is in none of them. Seeding it would leave the slot silently empty.
 *
 * Only offered on a chassis whose sheet the app can draw. Where a page falls back to the field list
 * there is no paper to flip and no control appears — the caller decides that by choosing which
 * surface to render, exactly as it did before this component existed.
 */
export function SetupSheetCompareView({
  setupSheetModelId,
  editionBlankId = null,
  values,
  label,
  templateKey,
  labLabels,
  labSource,
  excludeEntryIds,
  leadingActions,
  trailingActions,
}: {
  setupSheetModelId: string;
  /** Which of the chassis's sheets THIS setup is written on, as the server resolved it. */
  editionBlankId?: string | null;
  /** Side A, as stored. */
  values: Record<string, unknown>;
  /** Side A in the driver's words — the page's own title. */
  label: string;
  templateKey?: string | null;
  labLabels?: { s?: string; g?: string };
  labSource?: LabSource | null;
  /**
   * Entry ids this setup answers to, so it is never offered as its own comparison. A kept run's
   * snapshot answers to two — `run-<runId>` among your runs and `saved-<snapshotId>` in your library.
   */
  excludeEntryIds?: string[];
  /**
   * The page's own actions, rendered in ONE row with Compare (founder feedback 2026-09-01: a lone
   * right-aligned Compare above the paper sat "in a weird spot", and a second row of buttons
   * "isn't premium"). Server pages pass these as ReactNodes — Edit, the save bookmark, Share
   * before Compare; a "..." sheet of quiet doors after it.
   */
  leadingActions?: ReactNode;
  trailingActions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<SetupCompareEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<SetupComparePickerSource>("mine");
  const [otherId, setOtherId] = useState("");

  /*
   * The pools are fat — up to 200 runs carrying their setup JSON — so they are read on the FIRST
   * press of Compare and not before. Reading a setup is the common act on this page; it must not
   * pay for a comparison nobody asked for.
   */
  const loadedRef = useRef(false);
  const load = useCallback(async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    const { entries: rows, error } = await fetchSetupCompareEntries();
    if (rows) setEntries(rows);
    setLoadError(error);
    // A total failure has to be retryable, so it does not count as loaded.
    if (error) loadedRef.current = false;
    setLoading(false);
  }, []);

  /**
   * Only setups drawn on THIS sheet. Both sides share one page picture, so a setup off another
   * chassis would leave boxes empty and read as "they run nothing there" rather than "that box does
   * not exist on their car". Same sheet, not same car — a teammate's identical chassis belongs here.
   */
  const candidates = useMemo(() => {
    const skip = new Set(excludeEntryIds ?? []);
    return (entries ?? []).filter(
      (e) => e.setupSheetModelId === setupSheetModelId && !skip.has(e.id)
    );
  }, [entries, excludeEntryIds, setupSheetModelId]);

  const counts = useMemo(() => {
    const out: Record<SetupComparePickerSource, number> = { mine: 0, teammates: 0, setups: 0 };
    for (const e of candidates) out[e.source] += 1;
    return out;
  }, [candidates]);

  /** A source with nothing in it is not a tab — an empty rail reads as a broken list. */
  const sources = useMemo(
    () =>
      (["mine", "teammates", "setups"] as SetupComparePickerSource[]).filter((s) => counts[s] > 0),
    [counts]
  );

  // Land on a tab that holds something; an explicit choice still wins while it stays populated.
  useEffect(() => {
    if (sources.length > 0 && !sources.includes(source)) setSource(sources[0]!);
  }, [source, sources]);

  const shown = useMemo(() => candidates.filter((e) => e.source === source), [candidates, source]);

  const other = useMemo(
    () => (otherId ? (candidates.find((e) => e.id === otherId) ?? null) : null),
    [candidates, otherId]
  );

  /*
   * Which of the chassis's sheets the PAIR draws on — undefined while the server is asked. Side A's
   * own blank is the starting answer, but a comparison is only honest if both sides land in the
   * same boxes, so the pick is re-run across both key sets.
   */
  const [pairBlankId, setPairBlankId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!other) {
      setPairBlankId(undefined);
      return;
    }
    let cancelled = false;
    setPairBlankId(undefined);
    void pickEditionBlankForPair(setupSheetModelId, values, other.values).then((blankId) => {
      if (!cancelled) setPairBlankId(blankId);
    });
    return () => {
      cancelled = true;
    };
  }, [other, setupSheetModelId, values]);

  /*
   * The read-only sheet stays up until the pair's sheet is known. Swapping to a spinner would blank
   * the paper the driver came here to look at, for a request that usually answers in one hop.
   */
  const comparing = other != null && pairBlankId !== undefined;

  /** Nothing to pick from: the pools are still in flight, or came back with no company for us. */
  const pickerMessage =
    loading && entries == null
      ? "Loading setups…"
      : loadError
        ? loadError
        : candidates.length === 0
          ? "No other setups on this sheet yet."
          : null;

  return (
    <div className="space-y-2">
      {/*
        ONE action row for the whole page — the server page's own actions and Compare side by side,
        every button the same `outlineButtonClassName` height. Compare's earlier homes both failed
        on a real phone (founder, 2026-09-01): alone right-aligned it sat "in a weird spot", and
        joining a six-button wrap made three ragged rows. The quiet doors live behind the "..." in
        `trailingActions` now, so this row stays one line at 390px.
      */}
      <div className="flex flex-wrap items-center gap-1.5">
        {leadingActions}
        <button
          type="button"
          onClick={() => {
            setOpen((wasOpen) => {
              if (wasOpen) setOtherId("");
              else void load();
              return !wasOpen;
            });
          }}
          aria-pressed={open}
          title="Put another setup in these boxes and hold the sheet to flip between them"
          className={outlineButtonClassName(
            cn("gap-1.5", open && "border-primary-ink bg-accent/15 text-foreground")
          )}
        >
          <ArrowLeftRight className="size-3.5" strokeWidth={2} aria-hidden />
          Compare
        </button>
        {trailingActions}
      </div>

      {/* The picker, under the row it belongs to — same shape as the session view's. */}
      {open ? (
        <div className="space-y-1.5">
          {pickerMessage ? (
            <p className="text-xs text-muted-foreground">{pickerMessage}</p>
          ) : (
            <>
              {sources.length > 1 ? (
                <SegmentedControl<SetupComparePickerSource>
                  size="sm"
                  ariaLabel="Compare against"
                  className="max-w-md"
                  value={source}
                  onChange={(next) => {
                    setSource(next);
                    setOtherId("");
                  }}
                  options={sources.map((s) => ({
                    value: s,
                    ariaLabel: SETUP_COMPARE_SOURCE_LABEL[s],
                    label: (
                      <span className="flex items-baseline gap-1">
                        {SETUP_COMPARE_SOURCE_LABEL[s]}
                        <span className="text-[9px] tabular-nums opacity-60">{counts[s]}</span>
                      </span>
                    ),
                  }))}
                />
              ) : null}
              <div className="min-w-0 w-full max-w-md">
                <SearchableSelect
                  aria-label="Select a setup to compare against"
                  placeholder="Select setup…"
                  triggerMono
                  clearable
                  clearLabel="Select setup…"
                  value={otherId}
                  onChange={setOtherId}
                  options={shown.map((e) => ({ value: e.id, label: entryLine(e), keywords: e.kind }))}
                />
              </div>
            </>
          )}
        </div>
      ) : null}

      {comparing ? (
        <SheetCompareSurface
          setupSheetModelId={setupSheetModelId}
          editionBlankId={pairBlankId}
          a={{ label, values }}
          b={{ label: entryTitle(other), values: other.values }}
          templateKey={templateKey}
        />
      ) : (
        <ReadOnlySheetSurface
          setupSheetModelId={setupSheetModelId}
          editionBlankId={editionBlankId}
          values={values}
          templateKey={templateKey}
          labLabels={labLabels}
          labSource={labSource}
        />
      )}
    </div>
  );
}

/** One row in the picker: when it happened, then which session, then which car and how fast. */
function entryLine(e: SetupCompareEntry): string {
  return [e.when, e.title, e.detail].filter((p) => p.trim()).join(" · ");
}

/** The name that goes on the compare switch, where the rail truncates anything long. */
function entryTitle(e: SetupCompareEntry): string {
  return e.when ? `${e.title} · ${e.when}` : e.title;
}
