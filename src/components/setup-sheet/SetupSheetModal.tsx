"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { setupChangedRowsSincePrevious } from "@/lib/setupCompare/changedSincePrevious";
import { SetupChangedSincePreviousList } from "@/components/runs/SetupChangedSincePreviousList";
import {
  formatRunPickerLine,
  formatRunPickerLineWithDriver,
  type RunPickerRun,
} from "@/lib/runPickerFormat";
import { filterRunsForTeamSetupComparePicker } from "@/lib/setupCompare/teamSetupComparePicker";
import { RunPickerSelect } from "@/components/runs/RunPickerSelect";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import { ReadOnlySheetSurface } from "@/components/setup/ReadOnlySheetSurface";
import { SheetSetupEditorClient } from "@/components/setup/SheetSetupEditorClient";
import { LibrarySetupEditorClient } from "@/components/setup/LibrarySetupEditorClient";
import type {
  HostedSetupSave,
  SetupEditorSavedResult,
} from "@/components/setup/useSetupEditorSave";
import { ExitPromptSheet } from "@/components/ui/ExitPromptSheet";
import { SheetCompareSurface } from "@/components/setup/SheetCompareSurface";
import { Eyebrow } from "@/components/ui/panel";
import { SessionSetupSaveButton } from "@/components/setup/SessionSetupSaveButton";
import type { SetupSaveContext } from "@/lib/setup/setupSaveContext";
import { A800RR_SETUP_SHEET_V1 } from "@/lib/a800rrSetupTemplate";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import { getGenericSetupSheetTemplate } from "@/lib/setupSheetModels/genericSetupSheetTemplate";
import { isA800RRCar } from "@/lib/setupSheetTemplateId";
import type { RunCompareListSource } from "@/lib/runCompareCatalog";

export type SetupSheetModalRun = {
  id: string;
  userId?: string | null;
  carId?: string | null;
  createdAt: Date | string;
  sessionLabel?: string | null;
  sessionType: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  eventId?: string | null;
  carNameSnapshot?: string | null;
  trackNameSnapshot?: string | null;
  tireRunNumber: number;
  car?: {
    id: string;
    name: string;
    setupSheetTemplate?: string | null;
    setupSheetModelId?: string | null;
  } | null;
  track?: { id: string; name: string } | null;
  tireType?: { id: string; displayName: string } | null;
  tireStintId?: string | null;
  tireAgeKnown?: boolean | null;
  event?: { name: string; track?: { name: string } | null } | null;
  setupSnapshot?: { id: string; data?: unknown } | null;
  lapTimes?: unknown;
  /** Per-lap inclusion flags (rows from history/analysis loaders). */
  lapSession?: unknown;
  /** Exclusion-aware best lap (rows from the picker APIs). */
  bestLapSeconds?: number | null;
};

/** A standalone library setup sheet (upload or PetitRC download) pickable as a compare baseline. */
export type SetupCompareDoc = {
  id: string;
  originalFilename: string;
  sourceType?: string | null;
  sourceSite?: string | null;
  sourceUrl?: string | null;
  createdAt: string | Date;
  setupSheetTemplate?: string | null;
  parsedDataJson: unknown;
};

/** Which pool the compare baseline is drawn from. */
type CompareSource = "mine" | "teammates" | "setups";

const COMPARE_SOURCE_META: Record<CompareSource, SegmentedOption<CompareSource>> = {
  mine: { value: "mine", label: "Mine" },
  teammates: { value: "teammates", label: "Teammates" },
  setups: { value: "setups", label: "Setups" },
};

function formatSetupDocLine(doc: SetupCompareDoc): string {
  const source = doc.sourceSite?.toLowerCase() === "petitrc" ? "PetitRC" : "Upload";
  const name = doc.originalFilename?.replace(/\.(pdf|jpe?g|png|webp)$/i, "").trim() || "Setup sheet";
  let when = "";
  try {
    when = new Date(doc.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    when = "";
  }
  return when ? `${source} · ${name} · ${when}` : `${source} · ${name}`;
}

export function SetupSheetModal({
  open,
  onClose,
  run,
  pickerRuns,
  runListSource = "my_runs",
  viewerUserId = null,
  memberDisplayByUserId,
  startEditing = false,
  onRunSetupCorrected,
}: {
  open: boolean;
  onClose: () => void;
  run: SetupSheetModalRun | null;
  /** Fallback list (e.g. team page SSR) before API load; my_runs uses same-car filter. */
  pickerRuns?: SetupSheetModalRun[];
  runListSource?: RunCompareListSource;
  viewerUserId?: string | null;
  memberDisplayByUserId?: Record<string, string>;
  /**
   * Open straight into edit mode — the run page's "Edit setup on the sheet" door, which is a
   * request to correct rather than to read.
   */
  startEditing?: boolean;
  /**
   * ============================== WHAT MAKES THIS MODAL EDITABLE ==============================
   *
   * Present only when the host is the RUN PAGE. Correcting a setup here writes through
   * `PATCH /api/runs/[id]/setup-snapshot`, which mints a new snapshot and repoints that one
   * run — and it answers with the "did your other runs have this wrong too?" questions, which
   * have to land somewhere that can ask them.
   *
   * The other three hosts (`RunHistoryTable`, `SessionTrendCard`, `LapComparisonColumnGrid`)
   * mount this modal over a list with no run page underneath, so there is nowhere for those
   * questions to go. They pass nothing, the Edit toggle never appears, and the setup stays
   * readable exactly as before — a door that silently dropped the cascade would be worse than
   * no door.
   */
  onRunSetupCorrected?: (result: SetupEditorSavedResult) => void;
}) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareSource, setCompareSource] = useState<CompareSource>("mine");
  const [otherRunId, setOtherRunId] = useState("");
  const [selectedDocId, setSelectedDocId] = useState("");
  const [comparePickerRuns, setComparePickerRuns] = useState<SetupSheetModalRun[]>([]);
  const [comparePickerLoading, setComparePickerLoading] = useState(false);
  const [setupDocs, setSetupDocs] = useState<SetupCompareDoc[]>([]);
  const [teammateRuns, setTeammateRuns] = useState<SetupSheetModalRun[]>([]);
  const [teammateDisplay, setTeammateDisplay] = useState<Record<string, string>>({});
  const [hasTeammates, setHasTeammates] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [loadedSetupData, setLoadedSetupData] = useState<unknown>(null);
  /** Null until the server has said whether this viewer may save this setup, and how. */
  const [saveContext, setSaveContext] = useState<SetupSaveContext | null>(null);
  const [baselineSetupData, setBaselineSetupData] = useState<unknown | null>(null);
  const [baselineSetupLoading, setBaselineSetupLoading] = useState(false);
  const [modelTemplate, setModelTemplate] = useState<SetupSheetTemplate | null>(null);
  /** Set when this car's chassis draws as a sheet — the setup then shows ON the sheet. */
  const [sheetModelId, setSheetModelId] = useState<string | null>(null);
  /** The EDITION this run's setup keys draw on, when not the primary blank. Rides with the model. */
  const [sheetEditionBlankId, setSheetEditionBlankId] = useState<string | null>(null);
  /**
   * Reading or correcting. Read is the resting state — nothing on a session is touchable until
   * the driver says so, the same rule the run panel's own pencil follows.
   *
   * Reset whenever the modal closes or moves to another run: this component is never unmounted
   * between opens (see the `loadedSetupData` effect below for the other half of that), so
   * without it a driver who edited run A and closed would find run B's sheet already armed.
   */
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!open) setEditing(false);
  }, [open]);
  useEffect(() => {
    setEditing(open && startEditing);
  }, [open, run?.id, startEditing]);

  /*
   * ============================== NOTHING IN HERE THROWS TYPING AWAY ==============================
   *
   * This dialog has three exits the save bar knows nothing about — Cancel, Close and the scrim —
   * and the editor is an ordinary React subtree, so taking one of them just stops rendering it and
   * the driver's numbers go with it. The `beforeunload` prompt armed in `useSetupEditorSave` cannot
   * help here: nothing unloads.
   *
   * So the editor publishes where it stands (`useReportHostedSave`) and every exit asks first. The
   * question is `ExitPromptSheet`, the same Save / Discard / Stay shape the log-run wizard uses,
   * because the useful answer to "you have three changes" is usually to save them — sending the
   * driver back to hunt for a button at the bottom of a scrolled pop-up is a worse ask than the
   * one that lost the changes in the first place.
   */
  const [hostedSave, setHostedSave] = useState<HostedSetupSave | null>(null);
  /**
   * Which exit is waiting, and how many changes it was holding when it asked. The COUNT is frozen
   * here rather than read live: a landed save unmounts the editor under the sheet, and a title
   * recomputed from live state would flash "0 unsaved changes" on its way out.
   */
  const [exitPrompt, setExitPrompt] = useState<{
    target: "edit" | "modal";
    count: number;
  } | null>(null);
  const [exitSaving, setExitSaving] = useState(false);
  // Identity-stable so the editor below is not re-rendered by a prop that only looks new.
  const publishHostedSave = useCallback((state: HostedSetupSave | null) => {
    setHostedSave(state);
  }, []);

  useEffect(() => {
    setPortalReady(true);
  }, []);


  useEffect(() => {
    if (!open) return;
    setCompareOpen(false);
    setCompareSource("mine");
    setOtherRunId("");
    setSelectedDocId("");
    setSetupDocs([]);
    setTeammateRuns([]);
    setTeammateDisplay({});
    setHasTeammates(false);
    setBaselineSetupData(null);
    setBaselineSetupLoading(false);
  }, [open, run?.id]);

  useEffect(() => {
    if (!open || !run?.id) {
      setLoadedSetupData(null);
      setSaveContext(null);
      setModelTemplate(null);
      setSheetModelId(null);
      setSheetEditionBlankId(null);
      return;
    }
    const haveValues = run.setupSnapshot?.data !== undefined;
    // Drop the last run's values before going for this one's. The modal is not unmounted between
    // opens, so without this, opening run B after run A paints A's setup on B's sheet for as long
    // as the fetch takes — wrong numbers, presented as this run's, with nothing to say so.
    setLoadedSetupData(haveValues ? (run.setupSnapshot?.data ?? null) : null);
    setSaveContext(null);
    let alive = true;
    /*
     * This call runs even when the caller already handed us the values, because it answers three
     * questions the row can't. May this viewer save this setup, is it saved already, and — on a
     * teammate's run — which of their cars could hold a copy. And which SURFACE the setup is read
     * on: its own sheet, or the field list.
     *
     * That last one used to be asked of `/api/cars/[carId]/setup-sheet-template`, which is scoped
     * to the car's owner — so on a teammate's run it 404'd and every one of their setups opened as
     * the legacy form. It is asked here now because this is the route that has already decided the
     * viewer may see this run at all. Which also means the sheet no longer waits on a second
     * request: paper and values land together, so neither is ever drawn against the other's run.
     */
    void fetch(`/api/runs/${encodeURIComponent(run.id)}/setup-snapshot?sheet=1`)
      .then((res) => res.json())
      .then(
        (payload: {
          setupSnapshot?: { data?: unknown };
          save?: SetupSaveContext;
          sheet?: {
            sheetMode?: boolean;
            setupSheetModelId?: string | null;
            editionBlankId?: string | null;
            template?: SetupSheetTemplate | null;
          } | null;
        }) => {
          if (!alive) return;
          if (!haveValues) setLoadedSetupData(payload.setupSnapshot?.data ?? {});
          setSaveContext(payload.save ?? null);
          setModelTemplate(payload.sheet?.template ?? null);
          const sheetOn = Boolean(payload.sheet?.sheetMode && payload.sheet?.setupSheetModelId);
          setSheetModelId(sheetOn ? payload.sheet!.setupSheetModelId! : null);
          setSheetEditionBlankId(sheetOn ? (payload.sheet?.editionBlankId ?? null) : null);
        }
      )
      .catch(() => {
        if (!alive) return;
        if (!haveValues) setLoadedSetupData({});
        setModelTemplate(null);
        setSheetModelId(null);
        setSheetEditionBlankId(null);
      });
    return () => {
      alive = false;
    };
  }, [open, run?.id, run?.setupSnapshot?.id, run?.setupSnapshot?.data]);

  const carId = run?.car?.id ?? run?.carId ?? null;

  const fallbackPickerRuns = pickerRuns ?? [];

  useEffect(() => {
    if (!open || !run?.id) {
      setComparePickerRuns([]);
      setComparePickerLoading(false);
      return;
    }

    if (runListSource === "team_runs") {
      let alive = true;
      setComparePickerLoading(true);
      void fetch(`/api/runs/for-setup-compare?runId=${encodeURIComponent(run.id)}`, {
        cache: "no-store",
      })
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as {
            runs?: SetupSheetModalRun[];
            error?: string;
          };
          if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
          return Array.isArray(data.runs) ? data.runs : [];
        })
        .then((runs) => {
          if (!alive) return;
          setComparePickerRuns(runs);
        })
        .catch(() => {
          if (!alive) return;
          if (viewerUserId) {
            setComparePickerRuns(
              filterRunsForTeamSetupComparePicker(run, fallbackPickerRuns, viewerUserId)
            );
          } else {
            setComparePickerRuns(fallbackPickerRuns);
          }
        })
        .finally(() => {
          if (alive) setComparePickerLoading(false);
        });
      return () => {
        alive = false;
      };
    }

    const anchorCarId = run.car?.id ?? run.carId ?? null;
    const sameCar = anchorCarId
      ? fallbackPickerRuns.filter((r) => (r.car?.id ?? r.carId) === anchorCarId)
      : fallbackPickerRuns;
    setComparePickerRuns(sameCar);
    setComparePickerLoading(false);
  }, [open, run?.id, runListSource, viewerUserId, pickerRuns]);

  // Standalone library setups (uploads + PetitRC downloads) on this car's setup
  // sheet — a third compare source alongside my runs / teammate runs. Fetched
  // once the compare panel opens so the picker doesn't pay for it on every view.
  useEffect(() => {
    if (!open || !compareOpen || !run?.id) return;
    let alive = true;
    void fetch(`/api/setup-documents/for-compare?runId=${encodeURIComponent(run.id)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { documents?: SetupCompareDoc[] };
        return Array.isArray(data.documents) ? data.documents : [];
      })
      .then((docs) => {
        if (alive) setSetupDocs(docs);
      })
      .catch(() => {
        if (alive) setSetupDocs([]);
      });
    return () => {
      alive = false;
    };
  }, [open, compareOpen, run?.id]);

  // Teammate-visible runs on this setup sheet — a compare source in EITHER
  // context (open my own setup, compare to a teammate). `hasTeammates` keeps the
  // segment discoverable even before a teammate has logged this car.
  useEffect(() => {
    if (!open || !compareOpen || !run?.id) return;
    let alive = true;
    void fetch(`/api/runs/teammate-for-setup-compare?runId=${encodeURIComponent(run.id)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          runs?: SetupSheetModalRun[];
          memberDisplayByUserId?: Record<string, string>;
          hasTeammates?: boolean;
        };
        return {
          runs: Array.isArray(data.runs) ? data.runs : [],
          display: data.memberDisplayByUserId ?? {},
          hasTeammates: Boolean(data.hasTeammates),
        };
      })
      .then(({ runs, display, hasTeammates: ht }) => {
        if (!alive) return;
        setTeammateRuns(runs);
        setTeammateDisplay(display);
        setHasTeammates(ht);
      })
      .catch(() => {
        if (!alive) return;
        setTeammateRuns([]);
        setTeammateDisplay({});
        setHasTeammates(false);
      });
    return () => {
      alive = false;
    };
  }, [open, compareOpen, run?.id]);

  const formatPickerLine = useMemo((): ((run: SetupSheetModalRun) => string) => {
    if (runListSource !== "team_runs" || !memberDisplayByUserId) {
      return (r) => formatRunPickerLine(r);
    }
    return (r) => formatRunPickerLineWithDriver(r, memberDisplayByUserId);
  }, [runListSource, memberDisplayByUserId]);

  const runs = comparePickerRuns;
  const otherRuns = useMemo(
    () => runs.filter((r) => r.id !== run?.id),
    [runs, run?.id]
  );

  // My runs come from the local pool (in team context the merged list also
  // holds teammate rows, so filter to the viewer when we know who they are).
  // Teammate runs are fetched separately so they're available in EITHER context.
  const myRuns = useMemo(
    () => (viewerUserId ? otherRuns.filter((r) => r.userId === viewerUserId) : otherRuns),
    [otherRuns, viewerUserId]
  );

  // Only offer a source with something to pick — except Teammates, which stays
  // visible whenever the viewer has any teammate (empty state explains the gap).
  const availableSources = useMemo<CompareSource[]>(() => {
    const out: CompareSource[] = [];
    if (myRuns.length > 0) out.push("mine");
    if (hasTeammates) out.push("teammates");
    if (setupDocs.length > 0) out.push("setups");
    return out;
  }, [myRuns.length, hasTeammates, setupDocs.length]);

  // Driver names for teammate rows (fetched map wins; falls back to any passed in).
  const teammateFormatLine = useMemo(
    () =>
      (r: SetupSheetModalRun) =>
        formatRunPickerLineWithDriver(r, { ...(memberDisplayByUserId ?? {}), ...teammateDisplay }),
    [memberDisplayByUserId, teammateDisplay]
  );

  // Keep the active source valid as pools load in / change.
  useEffect(() => {
    if (availableSources.length === 0) return;
    if (!availableSources.includes(compareSource)) {
      setCompareSource(availableSources[0]!);
      setOtherRunId("");
      setSelectedDocId("");
    }
  }, [availableSources, compareSource]);

  const sourceRuns = compareSource === "teammates" ? teammateRuns : myRuns;

  const baselineRun = useMemo(() => {
    if (!compareOpen || compareSource === "setups" || !otherRunId) return null;
    // Teammate rows live in their own fetched pool, not the local run list.
    return sourceRuns.find((r) => r.id === otherRunId) ?? null;
  }, [compareOpen, compareSource, otherRunId, sourceRuns]);

  const selectedDoc = useMemo(() => {
    if (!compareOpen || compareSource !== "setups" || !selectedDocId) return null;
    return setupDocs.find((d) => d.id === selectedDocId) ?? null;
  }, [compareOpen, compareSource, selectedDocId, setupDocs]);

  useEffect(() => {
    // Library setups carry parsed values inline — no snapshot fetch needed.
    if (compareSource === "setups") {
      if (!open || !compareOpen || !selectedDoc) {
        setBaselineSetupData(null);
      } else {
        setBaselineSetupData(selectedDoc.parsedDataJson ?? {});
      }
      setBaselineSetupLoading(false);
      return;
    }
    if (!open || !compareOpen || !otherRunId || !baselineRun) {
      setBaselineSetupData(null);
      setBaselineSetupLoading(false);
      return;
    }
    setBaselineSetupData(null);
    if (baselineRun.setupSnapshot?.data !== undefined) {
      setBaselineSetupData(baselineRun.setupSnapshot.data);
      setBaselineSetupLoading(false);
      return;
    }
    let alive = true;
    setBaselineSetupLoading(true);
    void fetch(`/api/runs/${encodeURIComponent(baselineRun.id)}/setup-snapshot`)
      .then((res) => res.json())
      .then((payload: { setupSnapshot?: { data?: unknown } }) => {
        if (!alive) return;
        setBaselineSetupData(payload.setupSnapshot?.data ?? {});
      })
      .catch(() => {
        if (alive) setBaselineSetupData({});
      })
      .finally(() => {
        if (alive) setBaselineSetupLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, compareOpen, compareSource, otherRunId, baselineRun, selectedDoc]);

  const runSetup = useMemo<SetupSnapshotData>(
    () => normalizeSetupData(loadedSetupData ?? run?.setupSnapshot?.data ?? {}),
    [loadedSetupData, run?.setupSnapshot?.data]
  );

  /**
   * This run has a setup, and it has not arrived yet.
   *
   * The sheet is shown anyway — its picture is the one thing already cached, so the driver gets
   * their paper immediately and the values drop into the boxes a moment later. What this flag buys
   * is the difference between "still coming" and "this run was logged with nothing in it", which an
   * empty sheet cannot tell you on its own.
   */
  const setupValuesPending = run?.setupSnapshot?.id != null && loadedSetupData == null;

  const hasBaselineSelection = compareSource === "setups" ? Boolean(selectedDocId) : Boolean(otherRunId);

  const baselineValue = useMemo<SetupSnapshotData | null>(() => {
    if (!compareOpen || !hasBaselineSelection || baselineSetupLoading || baselineSetupData === null) {
      return null;
    }
    return normalizeSetupData(baselineSetupData);
  }, [compareOpen, hasBaselineSelection, baselineSetupLoading, baselineSetupData]);

  const compareActive = baselineValue != null;

  // Label for the "showing vs …" line, whichever source is active.
  const baselineLabel = useMemo(() => {
    if (compareSource === "setups") return selectedDoc ? formatSetupDocLine(selectedDoc) : null;
    return baselineRun ? formatPickerLine(baselineRun) : null;
  }, [compareSource, selectedDoc, baselineRun, formatPickerLine]);

  // "What changed this session" — diff vs the previous run on the same car,
  // mirroring the Sessions expanded-row preview. Same-car neighbours come from
  // the compare picker list (sorted newest → oldest, anchor run included).
  const previousRunOnCar = useMemo(() => {
    if (!run || !carId) return null;
    const sameCar = runs.filter((r) => (r.car?.id ?? r.carId) === carId);
    const idx = sameCar.findIndex((r) => r.id === run.id);
    if (idx < 0) return null;
    return sameCar[idx + 1] ?? null;
  }, [runs, run, carId]);

  const [previousSetupData, setPreviousSetupData] = useState<unknown | null>(null);
  useEffect(() => {
    if (!open || !previousRunOnCar?.setupSnapshot?.id) {
      setPreviousSetupData(null);
      return;
    }
    if (previousRunOnCar.setupSnapshot.data !== undefined) {
      setPreviousSetupData(previousRunOnCar.setupSnapshot.data);
      return;
    }
    let alive = true;
    void fetch(`/api/runs/${encodeURIComponent(previousRunOnCar.id)}/setup-snapshot`)
      .then((res) => res.json())
      .then((payload: { setupSnapshot?: { data?: unknown } }) => {
        if (alive) setPreviousSetupData(payload.setupSnapshot?.data ?? {});
      })
      .catch(() => {
        if (alive) setPreviousSetupData(null);
      });
    return () => {
      alive = false;
    };
  }, [open, previousRunOnCar?.id, previousRunOnCar?.setupSnapshot?.id, previousRunOnCar?.setupSnapshot?.data]);

  const changedSincePrevious = useMemo(() => {
    if (!previousRunOnCar?.setupSnapshot?.id || previousSetupData == null) return null;
    return setupChangedRowsSincePrevious(runSetup, previousSetupData);
  }, [previousRunOnCar, previousSetupData, runSetup]);

  const template = useMemo(() => {
    if (modelTemplate) return modelTemplate;
    if (isA800RRCar(run?.car?.setupSheetTemplate)) return A800RR_SETUP_SHEET_V1;
    return getGenericSetupSheetTemplate();
  }, [modelTemplate, run?.car?.setupSheetTemplate]);

  /**
   * May this viewer correct this run's setup from in here?
   *
   * Three conditions, and each rules out a real case:
   *  - `saveContext?.action === "mark"` — the server's owner test. A teammate reads and copies.
   *  - `onRunSetupCorrected` — the host can receive the cascade questions. See the prop.
   *  - a snapshot and a car to write against.
   *
   * `setupValuesPending` is deliberately NOT one of them: it gates the SURFACE below, and a
   * toggle that appears late reads as the app changing its mind.
   */
  const canCorrect = Boolean(
    run?.setupSnapshot?.id && carId && saveContext?.action === "mark" && onRunSetupCorrected
  );

  /*
   * Correcting and comparing are mutually exclusive: the compare surface paints a SECOND
   * setup into the same boxes, so a fillable box would be showing one value and writing to
   * another. Picking a baseline therefore drops out of edit mode rather than fighting it.
   */
  const editingNow = canCorrect && editing && !compareActive;

  /**
   * A correction landed. Drop back to reading, and hand the cascade questions up.
   *
   * Back to READING and not straight out of the pop-up: the driver came here to look at the
   * sheet, and closing it on save would answer a question they did not ask. The run's own
   * "Setup vs previous run" list re-reads behind the scrim, and the questions open on top.
   *
   * The stale-values problem is the host's: the run this modal was handed still carries the
   * OLD snapshot id, so `onRunSetupCorrected` is also what triggers the page refresh that
   * brings the new one back.
   */
  function handleCorrected(result: SetupEditorSavedResult) {
    setEditing(false);
    onRunSetupCorrected?.(result);
  }

  /**
   * How much typing an exit would cost right now. Zero unless the editor is actually on screen:
   * picking a compare baseline drops out of edit mode without unmounting the editor, and asking
   * about changes the driver can no longer see would be a question with no context.
   */
  const unsavedCount = editingNow && hostedSave?.dirty ? hostedSave.changedCount : 0;

  /** Back to reading — the Cancel button, and nothing else. */
  function requestStopEditing() {
    if (unsavedCount > 0) {
      setExitPrompt({ target: "edit", count: unsavedCount });
      return;
    }
    setEditing(false);
  }

  /** Close, and the scrim. */
  function requestClose() {
    if (unsavedCount > 0) {
      setExitPrompt({ target: "modal", count: unsavedCount });
      return;
    }
    onClose();
  }

  function discardAndExit() {
    const target = exitPrompt?.target;
    setExitPrompt(null);
    setEditing(false);
    // The editor publishes null as it unmounts, but not until the commit lands — and `onClose`
    // below runs first. Clearing it here keeps a re-open from inheriting a dead change count.
    setHostedSave(null);
    if (target === "modal") onClose();
  }

  /*
   * Save from the prompt: the mode's primary door, which in here is always "Correct this run".
   * A failure LEAVES THE SHEET UP carrying the message — the whole point of asking was not to
   * lose the numbers, and closing on a 500 would lose them with a tick beside it.
   *
   * `hostedSave` is read once up front: a landed save unmounts the editor (`handleCorrected`
   * drops edit mode), which publishes null underneath us.
   */
  async function saveAndExit() {
    const editor = hostedSave;
    if (!editor) return;
    const target = exitPrompt?.target;
    setExitSaving(true);
    let ok = false;
    try {
      ok = await editor.save();
    } finally {
      setExitSaving(false);
    }
    if (!ok) return;
    setExitPrompt(null);
    if (target === "modal") onClose();
  }

  /*
   * Escape closes, and it is an exit like any other — so it runs the same guard. It lives down
   * here, below the change count it reads, rather than up with the other listeners: a dependency
   * array is evaluated during render, and referencing `unsavedCount` before its `const` is a
   * temporal-dead-zone throw rather than a stale read.
   *
   * The prompt has an Escape of its own (it closes on Stay). Both handlers fire on one press, so
   * without the `exitPrompt` line the prompt would close and this would immediately re-open it.
   */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (exitPrompt) return;
      if (unsavedCount > 0) {
        setExitPrompt({ target: "modal", count: unsavedCount });
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, exitPrompt, unsavedCount]);

  if (!open || !portalReady) return null;

  return createPortal(
    <>
    <div
      data-setup-sheet-modal
      className="setup-sheet-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && requestClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Setup"
    >
      <div
        className="setup-sheet-modal-panel bg-background border border-border rounded-lg shadow-xl max-h-[90vh] overflow-auto w-full max-w-4xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/*
          The Save control hangs its panel off this bar rather than portalling it. No `relative` is
          needed and none is wanted — `position: sticky` already makes this the containing block for
          absolute children, and adding `relative` would set `position` twice on one element.

          The z HAS to clear everything inside the modal body, because this bar's own z-index seals
          its children into one layer: the Save panel's `z-20` only sorts it against the bar's
          click-away backdrop, never against the sheet below. At `z-10` this bar tied with the
          changed-fields table's sticky header row (also `z-10`, and later in the document), so the
          car list opened UNDER that table — the bug of 2026-08-16. Everything the body draws over
          its own paper tops out at `z-40` (SheetFillSurface's box tooltip), so 50 clears the lot.
        */}
        <div className="setup-sheet-modal-close sticky top-0 z-50 flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-background/95">
          <div className="ui-title text-sm text-muted-foreground truncate min-w-0 normal-case">
            {run ? formatPickerLine(run) : "Setup"}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/*
              ============================== CORRECTING HAPPENS HERE ==============================

              This was a Link out to `/cars/[carId]/setups/[setupId]/edit` until 2026-08-21 —
              a whole page away to change one number, which the founder called clunky and was
              right to: the pop-up was ALREADY drawing the editor. `ReadOnlySheetSurface` is
              `SheetFillSurface` with `readOnly` on, and the editor page is the same component
              with it off. One boolean, one page trip.

              So it is a toggle now, and the page survives only for the garage, where there is
              no run to correct. What a save MEANS still comes from `saveMode` — `correctRun`,
              which is the ONLY safe write for a run: `Run.setupSnapshotId` has no unique
              constraint and "mark, not copy" can leave a named library setup on the same row,
              so `PATCH /api/setup-snapshots/[id]` hard-refuses a snapshot with runs on it.

              Owner only: `action === "mark"` is the server's answer to "is this viewer the one
              who logged it" — a teammate may read the setup and copy it, never correct it.
              `onRunSetupCorrected` adds the second condition: a host that can receive the
              cascade questions.
            */}
            {canCorrect ? (
              <button
                type="button"
                onClick={() => (editing ? requestStopEditing() : setEditing(true))}
                aria-pressed={editing}
                /*
                 * ============================== WHY THIS IS NOT YELLOW, AND NOT "DONE" ==============================
                 *
                 * It was both until 2026-08-24, and the pair was a lie the founder walked into: it
                 * flipped edit mode off and wrote nothing, while wearing the primary face that means
                 * "this is the action" everywhere else in the app — at the TOP of the pop-up, where the
                 * thumb lands first. The real door is `SetupEditorSaveBar` at the bottom, and while
                 * editing there were two filled yellow buttons on one screen with the fake one on top.
                 *
                 * So: one loud button in this dialog, ever, and it is the one that saves. This is the
                 * way BACK, it is outlined, and "Cancel" cannot be read as "I have finished".
                 */
                className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted/90"
              >
                {editing ? "Cancel" : "Edit setup"}
              </button>
            ) : null}
            {/*
              Keyed by snapshot: opening a second session reuses this component (the modal is never
              unmounted), and without a fresh key the new setup would inherit the last one's
              "Saved" state.
            */}
            {run?.setupSnapshot?.id && saveContext ? (
              <SessionSetupSaveButton
                key={run.setupSnapshot.id}
                setupId={run.setupSnapshot.id}
                save={saveContext}
              />
            ) : null}
            <button
              type="button"
              onClick={requestClose}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/90 transition shrink-0"
            >
              Close
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4 print:p-0">
          {!run ? (
            <p className="text-sm text-muted-foreground">No run data.</p>
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Eyebrow>Setup vs previous run</Eyebrow>
                  {/*
                    Unavailable while correcting, and that is not a new rule — `editingNow` has
                    always dropped out of edit mode the moment a baseline lands, because the compare
                    surface paints a SECOND setup into the same boxes. What was new on 2026-08-24 is
                    saying so: it enforced the rule by UNMOUNTING the editor, which threw away
                    whatever had been typed, with no more warning than the Done button used to give.
                    Cancel first and the control comes back.
                  */}
                  <button
                    type="button"
                    disabled={editingNow}
                    onClick={() => {
                      setCompareOpen((wasOpen) => {
                        if (wasOpen) {
                          setOtherRunId("");
                          setSelectedDocId("");
                        }
                        return !wasOpen;
                      });
                    }}
                    aria-pressed={compareOpen}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40",
                      compareOpen
                        ? "border-primary-ink bg-accent/15 text-foreground"
                        : "border-border bg-card hover:bg-muted/90"
                    )}
                    title={
                      editingNow
                        ? "Finish or cancel your corrections first — a comparison paints another setup into these boxes"
                        : "Compare this run's setup to another run"
                    }
                  >
                    <GitCompare className="h-3.5 w-3.5" aria-hidden />
                    Compare to another run
                  </button>
                </div>
                {comparePickerLoading ||
                (run.setupSnapshot?.id != null && loadedSetupData == null) ||
                (previousRunOnCar?.setupSnapshot?.id != null && previousSetupData == null) ? (
                  <p className="text-muted-foreground text-xs">Loading changes…</p>
                ) : (
                  <SetupChangedSincePreviousList rows={changedSincePrevious} runId={run?.id ?? null} />
                )}
                {compareOpen && !editingNow ? (
                  <div className="space-y-2 pt-1">
                    {comparePickerLoading ? (
                      <span className="text-[11px] text-muted-foreground">Loading runs…</span>
                    ) : availableSources.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No runs or saved setups on this setup sheet yet. Log a run on your car with the same
                        sheet model, upload a setup sheet, or ask a teammate to share more sessions.
                      </p>
                    ) : (
                      <>
                        {availableSources.length > 1 ? (
                          <SegmentedControl<CompareSource>
                            size="sm"
                            ariaLabel="Compare against"
                            className="max-w-md"
                            value={compareSource}
                            onChange={(next) => {
                              setCompareSource(next);
                              setOtherRunId("");
                              setSelectedDocId("");
                            }}
                            options={availableSources.map((s) => COMPARE_SOURCE_META[s])}
                          />
                        ) : null}
                        <div className="min-w-0 w-full max-w-md">
                          {compareSource === "setups" ? (
                            <SearchableSelect
                              aria-label="Select a saved setup"
                              placeholder="Select saved setup…"
                              triggerMono
                              clearable
                              clearLabel="Select saved setup…"
                              value={selectedDocId}
                              onChange={setSelectedDocId}
                              options={setupDocs.map((d) => ({
                                value: d.id,
                                label: formatSetupDocLine(d),
                              }))}
                            />
                          ) : compareSource === "teammates" && sourceRuns.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              No teammate runs on this setup sheet yet. Ask a teammate to log or share a run
                              on this car.
                            </p>
                          ) : (
                            <RunPickerSelect
                              label=""
                              runs={sourceRuns as RunPickerRun[]}
                              value={otherRunId}
                              onChange={setOtherRunId}
                              placeholder={compareSource === "teammates" ? "Select teammate run…" : "Select run…"}
                              formatLine={
                                (compareSource === "teammates"
                                  ? teammateFormatLine
                                  : formatPickerLine) as (run: RunPickerRun) => string
                              }
                            />
                          )}
                        </div>
                      </>
                    )}
                    {hasBaselineSelection && baselineSetupLoading ? (
                      <p className="text-xs text-muted-foreground">Loading comparison setup…</p>
                    ) : null}
                    {compareActive && baselineLabel ? (
                      <p className="text-[11px] text-muted-foreground">
                        Hold the sheet to see {baselineLabel} in the same boxes. Only the values that
                        differ will move.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/*
                The setup, on the driver's own sheet (founder ruling 2026-08-11: on a chassis that
                draws one, the sheet IS the setup view). The changed-since-previous list above stays
                — that is the session view's question and its carve-out.
              */}
              {compareActive && baselineValue ? (
                /*
                 * Comparing used to drop to the field list, because the red highlights and the
                 * community-spread colouring lived there. Founder ruling 2026-08-14: no highlights
                 * and no spread — a comparison is answered by FLIPPING between the two setups on
                 * one sheet, so compare stays on the paper like everything else.
                 */
                sheetModelId ? (
                  <SheetCompareSurface
                    setupSheetModelId={sheetModelId}
                    editionBlankId={sheetEditionBlankId}
                    a={{ label: "This run", values: runSetup }}
                    b={{ label: baselineLabel ?? "Comparison", values: baselineValue }}
                    templateKey={template.templateKey}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This car has no setup sheet yet, so there is no sheet to compare on. Add its
                    sheet from the car page and this comparison works.
                  </p>
                )
              ) : editingNow && run.setupSnapshot?.id && carId ? (
                /*
                 * The same paper, fillable — `SheetSetupEditorClient` and `ReadOnlySheetSurface`
                 * are both thin wrappers over one `SheetFillSurface`, so a box does not move a
                 * pixel between reading and correcting.
                 *
                 * Keyed by snapshot: this modal is never unmounted, and the editor seeds its
                 * working values ONCE from `initialValues`. Without a fresh key, opening a
                 * second session would edit run B's setup starting from run A's numbers.
                 *
                 * `setupValuesPending` holds it back until the real values land, for the same
                 * reason — an editor seeded from `{}` would read as a blank sheet, and saving it
                 * would write one.
                 */
                setupValuesPending ? (
                  <p className="text-[11px] text-muted-foreground">Loading this run’s setup…</p>
                ) : sheetModelId ? (
                  <SheetSetupEditorClient
                    key={`edit:${run.setupSnapshot.id}`}
                    carId={carId}
                    setupId={run.setupSnapshot.id}
                    saveMode={{ kind: "correctRun", runId: run.id }}
                    setupSheetModelId={sheetModelId}
                    editionBlankId={sheetEditionBlankId}
                    initialValues={runSetup}
                    templateKey={template.templateKey}
                    hosted
                    onSaved={handleCorrected}
                    onSaveStateChange={publishHostedSave}
                  />
                ) : (
                  <LibrarySetupEditorClient
                    key={`edit:${run.setupSnapshot.id}`}
                    carId={carId}
                    setupId={run.setupSnapshot.id}
                    saveMode={{ kind: "correctRun", runId: run.id }}
                    initialValues={runSetup}
                    template={template}
                    hosted
                    onSaved={handleCorrected}
                    onSaveStateChange={publishHostedSave}
                  />
                )
              ) : sheetModelId ? (
                <div className="space-y-1">
                  {setupValuesPending ? (
                    <p className="text-[11px] text-muted-foreground">Loading this run’s setup…</p>
                  ) : null}
                  <ReadOnlySheetSurface
                    setupSheetModelId={sheetModelId}
                    editionBlankId={sheetEditionBlankId}
                    values={runSetup}
                    templateKey={template.templateKey}
                    labLabels={{ s: "This run" }}
                    labSource={{ kind: "run", id: run.id }}
                  />
                </div>
              ) : (
                <SetupSheetView
                  key={template.id}
                  value={runSetup}
                  onChange={() => {}}
                  readOnly
                  template={template}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
    {/*
      Portalled to `<body>` by itself, so it clears this dialog rather than scrolling inside it.
      Rendered as a sibling of the overlay and not a child: a portal still bubbles its events
      through the REACT tree, and every tap in here would otherwise reach the scrim handler above.
    */}
    <ExitPromptSheet
      open={exitPrompt !== null}
      title={
        exitPrompt?.count === 1 ? "1 unsaved change" : `${exitPrompt?.count ?? 0} unsaved changes`
      }
      detail={
        exitPrompt?.target === "modal"
          ? "Closing now leaves this run saying what it said before."
          : "Leaving the sheet now puts every box back the way you found it."
      }
      saveLabel={hostedSave?.saveLabel ?? "Correct this run"}
      discardLabel="Discard changes"
      stayLabel="Keep editing"
      error={hostedSave?.error ?? null}
      busy={exitSaving || Boolean(hostedSave?.busy)}
      onSave={() => void saveAndExit()}
      onDiscard={discardAndExit}
      onStay={() => setExitPrompt(null)}
    />
    </>,
    document.body
  );
}
