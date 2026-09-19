"use client";

import { InlinePickEdit, type InlinePickOption } from "@/components/runs/InlinePickEdit";
import { InlineValueEdit } from "@/components/runs/InlineValueEdit";
import { formatTireFitmentEnd, normalizeTireFitment } from "@/lib/tires/tireFitment";

/**
 * The tires of a front/rear run on the run's own page — two lines, front first, each with its
 * tire, its run count, and what it is glued to underneath.
 *
 * Only mounted for a run that HAS front data (`isSplitTireRun`); a single-tire run keeps the one
 * "Tire set" control it has always had. Both ends correct in place exactly like that control
 * does: the tire is picked, the run number is typed, and a corrected number shifts the later runs
 * on THAT end's set only — the two ends are separate lives of rubber.
 *
 * The insert / wheel / modifications line reads only. It is three free-text values from the
 * driver's own list, and the place that list lives is the log-run form; the run's Edit opens it.
 */

type RunTireEnds = {
  tireType?: { id: string; displayName: string } | null;
  tireRunNumber: number;
  tireAgeKnown?: boolean | null;
  frontTireType?: { id: string; displayName: string } | null;
  frontTireRunNumber?: number | null;
  frontTireAgeKnown?: boolean | null;
  tireFitment?: unknown;
};

function validateRunNumber(next: string): string | null {
  const n = Number(next.trim());
  return Number.isFinite(n) && n >= 1 ? null : "1 or more";
}

export function RunTireEndsBlock({
  run,
  canEdit,
  loadTireOptions,
  saveFields,
}: {
  run: RunTireEnds;
  canEdit: boolean;
  loadTireOptions: () => Promise<InlinePickOption[]>;
  saveFields: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const fitment = normalizeTireFitment(run.tireFitment);
  const ends = [
    {
      key: "front" as const,
      label: "Front",
      tire: run.frontTireType ?? null,
      runNumber: run.frontTireRunNumber ?? null,
      ageKnown: run.frontTireAgeKnown,
      fitment: formatTireFitmentEnd(fitment?.front),
      tireField: "frontTireTypeId",
      numberField: "frontTireRunNumber",
    },
    {
      key: "rear" as const,
      label: "Rear",
      tire: run.tireType ?? null,
      runNumber: run.tireRunNumber,
      ageKnown: run.tireAgeKnown,
      fitment: formatTireFitmentEnd(fitment?.rear),
      tireField: "tireTypeId",
      numberField: "tireRunNumber",
    },
  ];

  return (
    <div className="space-y-1.5">
      {ends.map((end) => (
        <div key={end.key} className="flex min-w-0 items-baseline gap-2 text-sm">
          <span className="w-12 shrink-0 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {end.label}
          </span>
          <span className="min-w-0 flex-1">
            <span className="tabular-nums">
              {canEdit ? (
                <InlinePickEdit
                  ariaLabel={`${end.label} tire`}
                  value={end.tire?.displayName ?? "—"}
                  valueId={end.tire?.id ?? null}
                  loadOptions={loadTireOptions}
                  allowEmpty
                  onSave={(next) => saveFields({ [end.tireField]: next })}
                  align="left"
                />
              ) : (
                <span className="font-semibold text-foreground">{end.tire?.displayName ?? "—"}</span>
              )}
              {end.tire && end.runNumber != null ? (
                <>
                  {" · run "}
                  {canEdit ? (
                    <InlineValueEdit
                      label={`${end.label} tire run number`}
                      value={String(end.runNumber)}
                      numeric
                      validate={validateRunNumber}
                      onSave={(next) => saveFields({ [end.numberField]: Number(next) })}
                    />
                  ) : (
                    end.runNumber
                  )}
                  {end.ageKnown === false ? " (age unknown)" : ""}
                </>
              ) : null}
            </span>
            {end.fitment ? (
              <span className="block text-[12px] text-muted-foreground">{end.fitment}</span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}
