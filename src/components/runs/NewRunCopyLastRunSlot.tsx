"use client";

import { CopyLastRunCard } from "@/components/runs/CopyLastRunCard";
import { useCopyLastRunForm } from "@/components/runs/CopyLastRunFormContext";
import type { RunPickerRun } from "@/lib/runPickerFormat";

function toPickerRun(run: NonNullable<ReturnType<typeof useCopyLastRunForm>["previewRun"]>): RunPickerRun {
  return {
    id: run.id,
    createdAt: run.createdAt,
    sessionLabel: run.sessionLabel,
    sessionType: run.sessionType ?? "TESTING",
    meetingSessionType: run.meetingSessionType,
    meetingSessionCode: run.meetingSessionCode,
    eventId: run.eventId,
    event: run.event,
    carId: run.carId,
    car: run.car,
    carNameSnapshot: run.carNameSnapshot,
    trackId: run.trackId,
    track: run.track,
    trackNameSnapshot: run.trackNameSnapshot,
    lapTimes: run.lapTimes,
  };
}

/** Renders above the dynamic NewRunForm so the card is in the first client paint. */
export function NewRunCopyLastRunSlot({ displayTimeZone }: { displayTimeZone?: string | null }) {
  const { previewRun, bridge } = useCopyLastRunForm();

  if (!previewRun) return null;

  const applied = bridge?.applied ?? false;
  const canApply = Boolean(bridge?.apply) && !applied;

  return (
    <CopyLastRunCard
      run={toPickerRun(previewRun)}
      applied={applied}
      onApply={() => bridge?.apply?.()}
      disabled={!canApply}
      timeZone={displayTimeZone}
    />
  );
}
