"use client";

import { useEffect, useMemo, useState } from "react";
import { RunTireSelectionPanel } from "@/components/runs/RunTireSelectionPanel";
import { TireFitmentRow } from "@/components/runs/TireFitmentRow";
import type { TireBucket } from "@/lib/cars/tireProfile";
import {
  EMPTY_TIRE_FITMENT_END,
  withTireFitmentEnd,
  type TireEndBox,
  type TireFitment,
  type TireFitmentEndKey,
} from "@/lib/tires/tireFitment";
import type { LastRunTires, TireStintValue } from "@/lib/tires/tireStintValue";

/**
 * The Tires step for a car that logs its front and rear apart — off-road (founder rulings
 * 2026-09-19), and since 2026-09-25 the pan cars, formula and 1/8 on-road too, each end with the
 * boxes its class's setup sheets ask for (`TireProfile.boxes`). Front block, then rear block, on
 * one screen: a driver sees the whole car at once and cannot forget the end that is out of sight,
 * which is what a Front | Rear switch would cost.
 *
 * Each end is the ordinary tire panel in its compact form, so every rule about how a tire's age
 * answers itself is the same one a touring car gets — run once per end, over that end's own last
 * run. Fronts and rears wear at different rates and are replaced at different times, so neither
 * count is ever inferred from the other.
 *
 * The boxes row (insert, wheel, diameter, modifications) rides between the tire and its count. It
 * belongs to the END, not to the tire: swapping the tread leaves it alone, because a driver who
 * changes tire nearly always mounts it on the wheel and insert they always use.
 *
 * No event spec-tire lock here yet — a controlled tire is one compound, and an off-road control
 * tire is a front AND a rear. Logged in docs/NOT_YET_BUILT.md.
 */

export type TireEndSelection = {
  tireTypeId: string;
  value: TireStintValue;
  /** That end's tires on the car's last run. `undefined` while the fetch is in flight. */
  lastRunTires: LastRunTires | null | undefined;
  onTireTypeChange: (tireTypeId: string, displayName: string | null) => void;
  onChange: (next: TireStintValue) => void;
};

export function RunSplitTireSelectionPanel({
  front,
  rear,
  fitment,
  onFitmentChange,
  boxes,
  carId,
  bucket,
  resetSignal,
  onPrefillClear,
  copyTireWarning,
  prefillFieldClass,
}: {
  front: TireEndSelection;
  rear: TireEndSelection;
  fitment: TireFitment;
  onFitmentChange: (next: TireFitment) => void;
  /** The boxes each end carries beside its tire (`tireEndBoxesToShow`). Empty = the tire alone. */
  boxes: readonly TireEndBox[];
  carId?: string | null;
  bucket?: TireBucket | null;
  resetSignal?: string | number | null;
  onPrefillClear?: () => void;
  copyTireWarning?: string | null;
  prefillFieldClass?: string;
}) {
  const [recents, setRecents] = useState<{ inserts: string[]; wheels: string[] }>({
    inserts: [],
    wheels: [],
  });
  // The own-list pickers need the driver's recent inserts and wheels; a class that shows neither
  // box (a pan car's diameter + modifications) never asks for them.
  const needsOwnLists = boxes.includes("insert") || boxes.includes("wheel");

  useEffect(() => {
    if (!needsOwnLists) return;
    let cancelled = false;
    fetch("/api/tire-fitment/recent", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { inserts?: string[]; wheels?: string[] } | null) => {
        if (cancelled || !d) return;
        setRecents({ inserts: d.inserts ?? [], wheels: d.wheels ?? [] });
      })
      .catch(() => {
        /* The pickers still take typed names; an empty list is not an error worth a message. */
      });
    return () => {
      cancelled = true;
    };
  }, [needsOwnLists]);

  // What is on the form right now leads the saved list, so a name typed for one end is a tap for
  // the other straight away — before anything has been saved.
  const inserts = useMemo(
    () => [fitment.rear?.insert, fitment.front?.insert, ...recents.inserts].filter(
      (v): v is string => Boolean(v)
    ),
    [fitment, recents.inserts]
  );
  const wheels = useMemo(
    () => [fitment.rear?.wheel, fitment.front?.wheel, ...recents.wheels].filter(
      (v): v is string => Boolean(v)
    ),
    [fitment, recents.wheels]
  );

  const renderEnd = (key: TireFitmentEndKey, selection: TireEndSelection) => (
    <RunTireSelectionPanel
      variant="compact"
      end={key}
      tireTypeId={selection.tireTypeId}
      onTireTypeChange={selection.onTireTypeChange}
      value={selection.value}
      onChange={selection.onChange}
      lastRunTires={selection.lastRunTires}
      carId={carId}
      bucket={bucket}
      resetSignal={resetSignal}
      onPrefillClear={onPrefillClear}
      prefillFieldClass={prefillFieldClass}
    >
      {boxes.length > 0 ? (
        <TireFitmentRow
          endName={key === "front" ? "Front" : "Rear"}
          boxes={boxes}
          value={fitment[key] ?? EMPTY_TIRE_FITMENT_END}
          onChange={(next) => {
            onPrefillClear?.();
            // Kept raw while typing — trimming a box mid-word eats the space the driver just
            // typed. `normalizeTireFitment` tidies it on save.
            onFitmentChange(withTireFitmentEnd(fitment, key, next));
          }}
          inserts={inserts}
          wheels={wheels}
        />
      ) : null}
    </RunTireSelectionPanel>
  );

  return (
    <div className="space-y-5">
      {renderEnd("front", front)}
      {renderEnd("rear", rear)}
      {copyTireWarning ? (
        <div className="text-[11px] text-muted-foreground">{copyTireWarning}</div>
      ) : null}
    </div>
  );
}
