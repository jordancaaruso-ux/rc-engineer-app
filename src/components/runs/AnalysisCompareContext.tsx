"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";

export type AnalysisCompareContextValue = {
  targetRunId: string | null;
  compareRunId: string | null;
  runLabel: (id: string) => string;
  setRunAsTarget: (id: string) => void;
  setRunAsCompare: (id: string) => void;
  clearTarget: () => void;
  clearCompare: () => void;
  engineerCompareHref: string | null;
};

const AnalysisCompareContext = createContext<AnalysisCompareContextValue | null>(null);

export function useAnalysisCompare(): AnalysisCompareContextValue | null {
  return useContext(AnalysisCompareContext);
}

const pairBtnClass =
  "rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium text-foreground hover:bg-muted/80 transition text-left";

export function AnalysisCompareProvider({
  children,
  runLabels,
  initialTargetId,
  initialCompareId,
}: {
  children: ReactNode;
  runLabels: Record<string, string>;
  initialTargetId: string | null;
  initialCompareId: string | null;
}) {
  const [targetRunId, setTargetRunId] = useState<string | null>(initialTargetId);
  const [compareRunId, setCompareRunId] = useState<string | null>(initialCompareId);

  const runLabel = useCallback(
    (id: string) => runLabels[id] ?? `${id.slice(0, 8)}…`,
    [runLabels]
  );

  const setRunAsTarget = useCallback((id: string) => {
    setTargetRunId(id);
    setCompareRunId((c) => (c === id ? null : c));
  }, []);

  const setRunAsCompare = useCallback(
    (id: string) => {
      if (!targetRunId || id === targetRunId) return;
      setCompareRunId(id);
    },
    [targetRunId]
  );

  const clearTarget = useCallback(() => {
    setTargetRunId(null);
    setCompareRunId(null);
  }, []);

  const clearCompare = useCallback(() => setCompareRunId(null), []);

  const engineerCompareHref = useMemo(() => {
    if (!targetRunId || !compareRunId) return null;
    return `/engineer?runId=${encodeURIComponent(targetRunId)}&compareRunId=${encodeURIComponent(compareRunId)}`;
  }, [targetRunId, compareRunId]);

  const value = useMemo<AnalysisCompareContextValue>(
    () => ({
      targetRunId,
      compareRunId,
      runLabel,
      setRunAsTarget,
      setRunAsCompare,
      clearTarget,
      clearCompare,
      engineerCompareHref,
    }),
    [
      targetRunId,
      compareRunId,
      runLabel,
      setRunAsTarget,
      setRunAsCompare,
      clearTarget,
      clearCompare,
      engineerCompareHref,
    ]
  );

  return (
    <AnalysisCompareContext.Provider value={value}>{children}</AnalysisCompareContext.Provider>
  );
}

export function AnalysisCompareBar() {
  const v = useAnalysisCompare();
  if (!v) return null;

  const { targetRunId, compareRunId, runLabel, clearTarget, clearCompare, engineerCompareHref } =
    v;

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-2 text-[11px] mb-3">
      <div className="font-medium text-foreground text-xs">Compare pair</div>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Defaults to your two most recent runs. Use <span className="font-medium text-foreground/90">Set target</span>{" "}
        then <span className="font-medium text-foreground/90">Set comparison</span> on any rows below to change the
        pair.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground shrink-0 font-medium">Target</span>
            {targetRunId ? (
              <>
                <span
                  className="text-foreground truncate max-w-[min(100%,22rem)]"
                  title={runLabel(targetRunId)}
                >
                  {runLabel(targetRunId)}
                </span>
                <button
                  type="button"
                  className="text-accent underline underline-offset-2 text-[10px] shrink-0"
                  onClick={clearTarget}
                >
                  Clear
                </button>
              </>
            ) : (
              <span className="text-muted-foreground italic">—</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground shrink-0 font-medium">Comparison</span>
            {compareRunId ? (
              <>
                <span
                  className="text-foreground truncate max-w-[min(100%,22rem)]"
                  title={runLabel(compareRunId)}
                >
                  {runLabel(compareRunId)}
                </span>
                <button
                  type="button"
                  className="text-accent underline underline-offset-2 text-[10px] shrink-0"
                  onClick={clearCompare}
                >
                  Clear
                </button>
              </>
            ) : (
              <span className="text-muted-foreground italic">
                {targetRunId ? "—" : "Choose a target first"}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex flex-col gap-1">
          {engineerCompareHref ? (
            <Link
              href={engineerCompareHref}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-glow-sm hover:brightness-105 transition"
            >
              Compare with Engineer
            </Link>
          ) : (
            <span className="text-muted-foreground text-[10px] max-w-[14rem] leading-snug">
              Select target and comparison runs to open the Engineer with both in context.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function RunComparePairCell({ runId }: { runId: string }) {
  const ctx = useAnalysisCompare();
  if (!ctx) {
    return <td className="hidden md:table-cell px-2 py-2 w-[7.5rem]" />;
  }

  const { targetRunId, compareRunId, setRunAsTarget, setRunAsCompare } = ctx;
  const isTarget = targetRunId === runId;
  const isCompare = compareRunId === runId;

  return (
    <td
      className="hidden md:table-cell px-2 py-2 align-top w-[7.5rem]"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col gap-1">
        {isTarget ? (
          <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground w-fit">
            Target
          </span>
        ) : (
          <button type="button" className={pairBtnClass} onClick={() => setRunAsTarget(runId)}>
            Set target
          </button>
        )}

        {targetRunId && !isTarget ? (
          isCompare ? (
            <span className="rounded border border-border bg-muted/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground w-fit">
              Comparison
            </span>
          ) : (
            <button type="button" className={pairBtnClass} onClick={() => setRunAsCompare(runId)}>
              Set comparison
            </button>
          )
        ) : null}
      </div>
    </td>
  );
}
