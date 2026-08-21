"use client";

/**
 * Setup comparison — two setups, one sheet, flipped between.
 *
 * Rebuilt 2026-08-14. What this page used to be: four native `<select>`s, two more for a
 * "community spread" bucket, and a single field table tinted red in proportion to how far apart the
 * two values sat within the community's interquartile range. Founder ruling: none of that. No
 * severity, no spread, no ink on the paper. A comparison is answered by putting both setups in the
 * same boxes and flipping — see `SheetCompareSurface`, which both this page and the session modal
 * render, so the two surfaces cannot drift apart again.
 *
 * Two consequences shape everything below.
 *
 * The paper is real, so BOTH SIDES MUST SHARE A SHEET. Values are looked up by key into boxes
 * printed on one chassis' page; a setup from another chassis would leave boxes blank and read as
 * "they run nothing there" rather than "this box does not exist on their car". So the picker only
 * offers setups whose car draws a sheet, and a mismatched pair is refused with a reason.
 *
 * The picker is the Geometry Lab's, deliberately (`RollCenterLabClient`): two slots you fill, source
 * tabs with counts, two-line rows, and a `vs` action that loads the other slot without closing.
 * Same job, same shape — a driver who has used one has used both.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SheetCompareSurface } from "@/components/setup/SheetCompareSurface";
import { normalizeSetupData } from "@/lib/runSetup";
import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";
import {
  formatRunCreatedRelativeWhen,
  formatRunPickerParts,
  type RunPickerRun,
} from "@/lib/runPickerFormat";

/** Which list a row belongs to. One tab each; a row never appears in two. */
type PickerSource = "mine" | "teammates" | "setups";

type SlotId = "a" | "b";

/**
 * One pickable setup. `title` answers "which session", `detail` answers "which car, where, how
 * fast" — two lines, because one line at 390px clips exactly the half that tells two rows apart.
 */
type SetupEntry = {
  id: string;
  kind: "run" | "team" | "saved";
  source: PickerSource;
  title: string;
  detail: string;
  when: string;
  /** The setup as stored. Normalized once here so the compare surface never has to. */
  values: Record<string, unknown>;
  /** The sheet this setup is drawn on. Rows without one are not offered — there is no paper. */
  setupSheetModelId: string;
  /** Chassis-type key, for the geometry strip above the paper. */
  templateKey: string | null;
};

const PICKER_ROWS_PER_SOURCE = 40;

const SOURCE_LABEL: Record<PickerSource, string> = {
  mine: "Mine",
  teammates: "Teammates",
  setups: "Setups",
};

function isJsonObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** A setup with no values in it compares to nothing; keep it off the list rather than in it. */
function hasAnyValue(data: Record<string, unknown>): boolean {
  return Object.values(data).some((v) => v != null && v !== "");
}

function entryLabel(e: SetupEntry): string {
  return e.detail ? `${e.title} · ${e.detail}` : e.title;
}

/** One slot chip: tap to make this the slot the picker loads into. */
function SlotChip({
  id,
  entry,
  selected,
  onSelect,
  onClear,
}: {
  id: SlotId;
  entry: SetupEntry | null;
  selected: boolean;
  onSelect: () => void;
  onClear?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2 py-1.5 transition",
        selected ? "border-primary-ink/60 bg-secondary" : "border-dashed border-border text-muted-foreground"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        title={entry ? entryLabel(entry) : "Empty — search below to fill it"}
      >
        <span
          className={cn(
"shrink-0 rounded border px-1 micro-caps",
            selected ? "border-primary-ink/60 text-foreground" : "border-border text-faint"
          )}
        >
          {id}
        </span>
        <span className="truncate text-xs font-semibold">{entry ? entry.title : "Pick a setup"}</span>
      </button>
      {entry && onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear setup ${id.toUpperCase()}`}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:text-foreground"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

export function SetupComparisonClient({ dbReady }: { dbReady: boolean }) {
  // Safe here: the page already wraps this component in `<Suspense>`, which `useSearchParams`
  // requires — without it the whole route opts into client rendering at build time.
  const searchParams = useSearchParams();
  const [slots, setSlots] = useState<{ a: SetupEntry | null; b: SetupEntry | null }>({ a: null, b: null });
  const [sel, setSel] = useState<SlotId>("a");

  const [entries, setEntries] = useState<SetupEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PickerSource>("mine");
  const [pickerOpen, setPickerOpen] = useState(false);

  /** In-flight guard, as a ref so two taps in one render can't both fire the fetch. */
  const fetching = useRef(false);
  const openedRef = useRef(false);

  const otherId: SlotId = sel === "a" ? "b" : "a";

  const loadSources = useCallback(async () => {
    if (!dbReady || fetching.current) return;
    fetching.current = true;
    setLoading(true);
    setLoadError(null);
    const safeJson = (url: string) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

    const [runsRes, teamRes, libRes] = await Promise.all([
      safeJson("/api/runs/for-picker") as Promise<{ runs?: RunPickerRun[] } | null>,
      safeJson("/api/runs/teammate-for-picker") as Promise<{
        runs?: (RunPickerRun & { userId?: string | null })[];
        memberDisplayByUserId?: Record<string, string>;
      } | null>,
      safeJson("/api/setups/library-for-picker") as Promise<{
        setups?: {
          id: string;
          name?: string | null;
          createdAt?: string;
          carName?: string | null;
          setupSheetModelId?: string | null;
          setupSheetTemplate?: string | null;
          setupData?: unknown;
        }[];
      } | null>,
    ]);

    if (!runsRes && !teamRes && !libRes) {
      // Keep whatever is already on screen — a failed refetch must not blank a usable list.
      setLoadError("Couldn't load your setups — check you're signed in.");
      setLoading(false);
      fetching.current = false;
      return;
    }

    const out: SetupEntry[] = [];
    const pushRun = (
      run: RunPickerRun,
      source: PickerSource,
      kind: SetupEntry["kind"],
      displayByUserId?: Record<string, string>
    ) => {
      const data = run.setupSnapshot?.data;
      const modelId = run.car?.setupSheetModelId?.trim();
      // No sheet, no paper to draw on — and this page is the sheet.
      if (!modelId || !isJsonObject(data)) return;
      const values = normalizeSetupData(data) as Record<string, unknown>;
      if (!hasAnyValue(values)) return;
      const parts = formatRunPickerParts(run, displayByUserId);
      out.push({
        id: `${kind}-${run.id}`,
        kind,
        source,
        title: parts.title,
        detail: parts.detail,
        when: parts.when,
        values,
        setupSheetModelId: modelId,
        templateKey: canonicalSetupSheetTemplateId(run.car?.setupSheetTemplate ?? null),
      });
    };

    for (const run of runsRes?.runs ?? []) pushRun(run, "mine", "run");
    for (const run of teamRes?.runs ?? []) {
      pushRun(run, "teammates", "team", teamRes?.memberDisplayByUserId);
    }
    for (const saved of libRes?.setups ?? []) {
      const modelId = saved.setupSheetModelId?.trim();
      if (!modelId || !isJsonObject(saved.setupData)) continue;
      const values = normalizeSetupData(saved.setupData) as Record<string, unknown>;
      if (!hasAnyValue(values)) continue;
      out.push({
        id: `saved-${saved.id}`,
        kind: "saved",
        source: "setups",
        title: saved.name?.trim() || "Untitled setup",
        detail: saved.carName?.trim() || "",
        when: saved.createdAt ? formatRunCreatedRelativeWhen(saved.createdAt) : "",
        values,
        setupSheetModelId: modelId,
        templateKey: canonicalSetupSheetTemplateId(saved.setupSheetTemplate ?? null),
      });
    }

    setEntries(out);
    setLoading(false);
    fetching.current = false;
  }, [dbReady]);

  const openPicker = () => {
    if (!openedRef.current) {
      openedRef.current = true;
      // Refetch on each fresh open: a run logged since this page loaded should be here.
      void loadSources();
    }
    setPickerOpen(true);
  };

  const closePicker = () => {
    openedRef.current = false;
    setPickerOpen(false);
    setQuery("");
  };

  // The list is the whole point of the page, so it loads before anyone asks for it.
  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  /*
   * `?a=…&b=…` — arrive with both slots already filled.
   *
   * The Tools page sends these (2026-08-19). The bench's cost was never the comparison, it was
   * the picking: two taps into the modal, two searches, two rows chosen out of forty, and for
   * the common case — your last two setups on the car you just ran — every one of those choices
   * has one obvious answer.
   *
   * The params carry ENTRY ids (`run-<id>` / `saved-<id>`), the same strings `loadSources`
   * mints above, so no second id vocabulary exists and nothing new is stored. An id that
   * doesn't match — a deleted run, a teammate who stopped sharing — simply leaves that slot
   * empty, which is the page's normal starting state and needs no error.
   *
   * Applied ONCE, guarded by a ref. Without it, clearing a slot would refill it on the next
   * render and the picker would look broken.
   */
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || !entries?.length) return;
    const wanted = { a: searchParams.get("a"), b: searchParams.get("b") };
    if (!wanted.a && !wanted.b) return;
    prefilledRef.current = true;
    setSlots({
      a: entries.find((e) => e.id === wanted.a) ?? null,
      b: entries.find((e) => e.id === wanted.b) ?? null,
    });
  }, [entries, searchParams]);

  /** How many rows each source holds before the search box narrows anything. */
  const poolCounts = useMemo(() => {
    const counts: Record<PickerSource, number> = { mine: 0, teammates: 0, setups: 0 };
    for (const e of entries ?? []) counts[e.source] += 1;
    return counts;
  }, [entries]);

  /** Filtered rows per source, each capped on its own, with the pre-cap total. */
  const buckets = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const out: Record<PickerSource, { rows: SetupEntry[]; total: number }> = {
      mine: { rows: [], total: 0 },
      teammates: { rows: [], total: 0 },
      setups: { rows: [], total: 0 },
    };
    for (const e of entries ?? []) {
      if (tokens.length) {
        const hay = `${e.title} ${e.detail} ${e.when} ${e.kind}`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) continue;
      }
      const bucket = out[e.source];
      bucket.total += 1;
      if (bucket.rows.length < PICKER_ROWS_PER_SOURCE) bucket.rows.push(e);
    }
    return out;
  }, [entries, query]);

  /**
   * A source with nothing in it hides — except Teammates, which keeps an empty state, because
   * "I have no teammates" and "this app has no teams" must not look the same. Availability reads
   * the unfiltered pool so the tabs don't flicker as you type.
   */
  const tabs: PickerSource[] = (["mine", "teammates", "setups"] as PickerSource[]).filter(
    (s) => s === "teammates" || poolCounts[s] > 0
  );
  /*
   * Falling back to `tabs[0]` opened the picker on an EMPTY tab: with no runs of your own, "mine"
   * drops out, and Teammates — the one tab kept even when it has nothing — becomes first. You met
   * "No teammates are sharing runs yet" with your saved setups sitting one tab over. So the
   * fallback is the first tab that actually holds something; an explicit choice still wins.
   */
  const activeTab: PickerSource = tabs.includes(tab)
    ? tab
    : tabs.find((s) => poolCounts[s] > 0) ?? tabs[0] ?? "mine";
  const activeBucket = buckets[activeTab];

  const setSlot = (slotId: SlotId, entry: SetupEntry | null) => {
    setSlots((s) => ({ ...s, [slotId]: entry }));
  };

  const both = slots.a && slots.b ? { a: slots.a, b: slots.b } : null;
  const sameSheet = both ? both.a.setupSheetModelId === both.b.setupSheetModelId : false;

  /*
   * Which of the chassis's sheets this pair draws on — undefined while the server is asked, then
   * null for the primary blank or an EDITION's id. Both sides' keys go into the pick, so the
   * sheet that can draw the pair wins; the surface waits for the answer (it seeds its plan once).
   */
  const [compareEditionBlankId, setCompareEditionBlankId] = useState<string | null | undefined>(
    undefined
  );
  const compareKey = both && sameSheet ? `${both.a.id}|${both.b.id}` : null;
  const compareModelId = both && sameSheet ? both.a.setupSheetModelId : null;
  const bothRef = useRef(both);
  bothRef.current = both;
  useEffect(() => {
    if (!compareKey || !compareModelId) {
      setCompareEditionBlankId(undefined);
      return;
    }
    const pair = bothRef.current;
    const keys = [
      ...new Set([
        ...Object.keys(pair?.a.values ?? {}),
        ...Object.keys(pair?.b.values ?? {}),
      ]),
    ].slice(0, 200);
    if (keys.length === 0) {
      setCompareEditionBlankId(null);
      return;
    }
    let cancelled = false;
    setCompareEditionBlankId(undefined);
    fetch(
      `/api/setup-sheet-models/${compareModelId}/sheet-blank-pick?keys=${encodeURIComponent(keys.join(","))}`,
      { cache: "no-store" }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { editionBlankId?: string | null } | null) => {
        if (!cancelled) setCompareEditionBlankId(d?.editionBlankId ?? null);
      })
      .catch(() => {
        // The primary always draws; a failed pick must not cost the comparison.
        if (!cancelled) setCompareEditionBlankId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [compareKey, compareModelId]);

  return (
    <div className="space-y-4">
      {!dbReady ? (
        <CardPanel contentClassName="text-sm text-muted-foreground">
          Database not configured — there are no setups to compare.
        </CardPanel>
      ) : null}

      <CardPanel contentClassName="space-y-2">
        <Eyebrow>Setups</Eyebrow>
        <div className="flex items-center gap-2">
          <SlotChip
            id="a"
            entry={slots.a}
            selected={sel === "a"}
            onSelect={() => setSel("a")}
            onClear={() => setSlot("a", null)}
          />
          <SlotChip
            id="b"
            entry={slots.b}
            selected={sel === "b"}
            onSelect={() => setSel("b")}
            onClear={() => setSlot("b", null)}
          />
        </div>

        <input
          type="search"
          value={query}
          placeholder={`Search setups → load into ${sel.toUpperCase()}…`}
          onFocus={openPicker}
          onClick={openPicker}
          onChange={(e) => {
            setQuery(e.target.value);
            openPicker();
          }}
          aria-label="Search your runs, teammate runs, and saved setups"
          className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        {pickerOpen ? (
          <div className="space-y-1.5">
            {tabs.length > 1 ? (
              <SegmentedControl
                size="sm"
                ariaLabel="Setup source"
                value={activeTab}
                onChange={setTab}
                segmentClassName="px-2 py-1 text-[11px]"
                options={tabs.map((s) => ({
                  value: s,
                  ariaLabel: SOURCE_LABEL[s],
                  label: (
                    <span className="flex items-baseline gap-1">
                      {SOURCE_LABEL[s]}
                      {buckets[s].total > 0 ? (
                        <span className="text-[9px] tabular-nums opacity-60">
                          {buckets[s].total}
                        </span>
                      ) : null}
                    </span>
                  ),
                }))}
              />
            ) : null}

            {loading && !entries ? (
              <p className="text-xs text-muted-foreground">Loading your setups…</p>
            ) : null}
            {loadError && !entries ? <p className="text-xs text-muted-foreground">{loadError}</p> : null}

            {entries && activeBucket.rows.length === 0 ? (
              <p className="px-1 py-2 text-xs leading-relaxed text-muted-foreground">
                {activeTab === "teammates" &&
                poolCounts.teammates === 0 &&
                poolCounts.mine + poolCounts.setups > 0 ? (
                  <>
                    No teammates are sharing runs yet. Set up a team and their setups show up here —{" "}
                    <Link href="/teams" className="text-primary-ink underline underline-offset-2">
                      Teams
                    </Link>
                    .
                  </>
                ) : (
                  "No matching setups on a car that draws its own sheet."
                )}
              </p>
            ) : null}

            <ul className="max-h-[420px] space-y-0.5 overflow-y-auto">
              {activeBucket.rows.map((entry) => (
                <li key={entry.id} className="flex items-stretch gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSlot(sel, entry);
                      closePicker();
                    }}
                    title={`Load into setup ${sel.toUpperCase()}`}
                    className="grid min-w-0 flex-1 grid-cols-[2.1rem_minmax(0,1fr)_auto] items-start gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-muted"
                  >
                  <span className="pt-0.5 micro-caps text-faint">
                      {entry.kind}
                    </span>
                    {/* break-words, not truncate: a filename-shaped setup name is one unbreakable
                        token and would otherwise paint over the date column. */}
                    <span className="min-w-0">
                      <span className="block break-words text-xs leading-snug">{entry.title}</span>
                      {entry.detail ? (
                        <span className="block break-words tabular-nums text-[10px] leading-snug text-muted-foreground">
                          {entry.detail}
                        </span>
                      ) : null}
                    </span>
                    <span className="whitespace-nowrap pt-0.5 text-[10px] tabular-nums text-faint">
                      {entry.when}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSlot(otherId, entry)}
                    title={`Load into setup ${otherId.toUpperCase()} as the comparison`}
                    className="shrink-0 self-center rounded-md border border-border px-1.5 py-1 micro-caps text-muted-foreground transition hover:text-foreground"
                  >
                    vs
                  </button>
                </li>
              ))}
            </ul>

            {activeBucket.rows.length < activeBucket.total ? (
              <p className="px-2 tabular-nums text-[10px] text-faint">
                Showing {activeBucket.rows.length} of {activeBucket.total} — search to narrow
              </p>
            ) : null}

            <button
              type="button"
              className="text-xs font-medium text-muted-foreground transition hover:text-foreground"
              onClick={closePicker}
            >
              Close
            </button>
          </div>
        ) : null}
      </CardPanel>

      {both && sameSheet ? (
        <CardPanel contentClassName="space-y-2">
          <Eyebrow>On the sheet</Eyebrow>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Hold the sheet to swap between the two setups. Both draw into the same boxes, so the only
            values that move are the ones that differ.
          </p>
          {compareEditionBlankId !== undefined ? (
            <SheetCompareSurface
              // Slot changes rebuild the surface: a different setup is a different comparison, and
              // starting it at page 1, fit to the stage, is the right place to start reading.
              key={`${both.a.id}|${both.b.id}|${compareEditionBlankId ?? "primary"}`}
              setupSheetModelId={both.a.setupSheetModelId}
              editionBlankId={compareEditionBlankId}
              a={{ label: entryLabel(both.a), values: both.a.values }}
              b={{ label: entryLabel(both.b), values: both.b.values }}
              templateKey={both.a.templateKey ?? both.b.templateKey}
            />
          ) : null}
        </CardPanel>
      ) : both && !sameSheet ? (
        <CardPanel contentClassName="space-y-1.5">
          <Eyebrow>Different sheets</Eyebrow>
          <p className="text-sm text-muted-foreground">
            These two setups are on different chassis, so they don&apos;t share a sheet to compare on.
            A box printed on one car&apos;s sheet often isn&apos;t on the other&apos;s at all — showing
            them together would read as &ldquo;they run nothing there&rdquo; rather than &ldquo;there
            is no such setting&rdquo;.
          </p>
          <p className="text-sm text-muted-foreground">Pick two setups on the same chassis.</p>
        </CardPanel>
      ) : (
        <CardPanel contentClassName="space-y-1.5">
          <Eyebrow>Nothing to compare yet</Eyebrow>
          <p className="text-sm text-muted-foreground">
            Fill both slots with setups from the same chassis. They go on one sheet, and holding it
            swaps between them.
          </p>
        </CardPanel>
      )}
    </div>
  );
}
