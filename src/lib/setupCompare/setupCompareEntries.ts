/**
 * The pool of setups a comparison can be made against — your runs, your teammates' runs, and the
 * setups you have kept — read once and turned into one flat list of pickable rows.
 *
 * ============================== WHY THIS IS NOT IN A COMPONENT ==============================
 *
 * Three surfaces now offer "compare this setup to another one": the standalone comparison page
 * (`SetupComparisonClient`), a saved setup read from the garage, and a published baseline
 * (`SetupSheetCompareView`). They all draw the answer on one sheet through `SheetCompareSurface`,
 * and they must all be offering the SAME setups under the SAME names — a row that exists on one
 * screen and not another reads as data loss, not as a different feature.
 *
 * The entry `id` vocabulary (`run-<runId>` / `team-<runId>` / `saved-<snapshotId>`) is load-bearing
 * beyond this file: `/setup/comparison?a=…&b=…` carries those strings, so the Tools page can hand
 * over a filled-in pair. Nothing new is stored to make that work, and there must never be a second
 * vocabulary for the same rows.
 *
 * ============================== WHAT IS DELIBERATELY LEFT OUT ==============================
 *
 * A setup with no sheet behind it, and a sheet with no values in it. The comparison is answered by
 * putting both setups in the same boxes on one page picture; a row with no `setupSheetModelId` has
 * no paper, and an empty one would flip to a blank sheet and read as "they run nothing there".
 */

import { normalizeSetupData } from "@/lib/runSetup";
import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";
import {
  formatRunCreatedRelativeWhen,
  formatRunPickerParts,
  type RunPickerRun,
} from "@/lib/runPickerFormat";

/** Which list a row belongs to. One tab each; a row never appears in two. */
export type SetupComparePickerSource = "mine" | "teammates" | "setups";

/**
 * One pickable setup. `title` answers "which session", `detail` answers "which car, where, how
 * fast" — two lines, because one line at 390px clips exactly the half that tells two rows apart.
 */
export type SetupCompareEntry = {
  id: string;
  kind: "run" | "team" | "saved";
  source: SetupComparePickerSource;
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

export const SETUP_COMPARE_SOURCE_LABEL: Record<SetupComparePickerSource, string> = {
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

export type SetupCompareEntriesResult = {
  /** Null only when every read failed — callers keep whatever list they already had. */
  entries: SetupCompareEntry[] | null;
  error: string | null;
};

/**
 * Read the three pools in parallel and flatten them.
 *
 * A single failed pool is survivable and silent: teammates you don't have, a library that 500s.
 * Only a total failure returns an error, because that is the one case where an empty list would
 * lie about how many setups you own.
 */
export async function fetchSetupCompareEntries(): Promise<SetupCompareEntriesResult> {
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
    return { entries: null, error: "Couldn't load your setups — check you're signed in." };
  }

  const out: SetupCompareEntry[] = [];
  const pushRun = (
    run: RunPickerRun,
    source: SetupComparePickerSource,
    kind: SetupCompareEntry["kind"],
    displayByUserId?: Record<string, string>
  ) => {
    const data = run.setupSnapshot?.data;
    const modelId = run.car?.setupSheetModelId?.trim();
    // No sheet, no paper to draw on — and a comparison is the sheet.
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

  return { entries: out, error: null };
}

/**
 * Which of a chassis's sheets a pair of setups draws on.
 *
 * A setup imported through a rebuilt EDITION speaks that edition's keys, and drawing it on the
 * primary blank shows empty boxes. Both sides' keys go into the pick, so the sheet that can draw
 * the PAIR wins — the two are flipped in the same boxes or the comparison means nothing.
 *
 * Returns `null` for the primary blank, and `null` on any failure: the primary always draws, and a
 * failed pick must not cost the comparison.
 */
export async function pickEditionBlankForPair(
  setupSheetModelId: string,
  a: Record<string, unknown>,
  b: Record<string, unknown>
): Promise<string | null> {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].slice(0, 200);
  if (keys.length === 0) return null;
  try {
    const res = await fetch(
      `/api/setup-sheet-models/${setupSheetModelId}/sheet-blank-pick?keys=${encodeURIComponent(keys.join(","))}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { editionBlankId?: string | null } | null;
    return data?.editionBlankId ?? null;
  } catch {
    return null;
  }
}
