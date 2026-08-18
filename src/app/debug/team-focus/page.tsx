"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { TeamDayCard } from "@/components/runs/TeamDayCard";
import { buildTeamDayModel, type TeamDayRunSource } from "@/lib/runs/teamDayModel";

/** Scratch preview for chart→driver-row focus on the team day. Delete after review. */

const DAY = "2026-07-26T";

function run(
  id: string,
  userId: string,
  clock: string,
  best: number,
  label: string
): TeamDayRunSource {
  return {
    id,
    userId,
    carId: "car_1",
    carNameSnapshot: "A800R",
    createdAt: new Date(`${DAY}${clock}:00Z`),
    sortAt: new Date(`${DAY}${clock}:00Z`),
    localTimeZone: "UTC",
    lapTimes: null,
    bestLapSeconds: best,
    avgTop5LapSeconds: best + 0.3,
    sessionLabel: label,
  };
}

const FIELD = [
  run("g1", "usr_glenn", "13:25", 17.31, "Q1"),
  run("g2", "usr_glenn", "13:35", 17.68, "Q2"),
  run("g3", "usr_glenn", "14:30", 17.31, "Q3"),
  run("g4", "usr_glenn", "14:55", 17.25, "Q4"),
  run("g5", "usr_glenn", "15:50", 17.41, "A1"),
  run("g6", "usr_glenn", "19:00", 17.17, "A2"),
  run("m1", "usr_mara", "13:40", 17.02, "Q1"),
  run("m2", "usr_mara", "14:50", 16.95, "Q2"),
  run("m3", "usr_mara", "16:10", 17.12, "A1"),
  run("d1", "usr_dayne", "13:50", 17.55, "Q1"),
  run("d2", "usr_dayne", "15:05", 17.44, "Q2"),
  run("d3", "usr_dayne", "18:30", 17.38, "A1"),
];

const OPTS = {
  memberDisplayByUserId: {
    usr_glenn: "Glenn Harding",
    usr_mara: "Mara Ellis",
    usr_dayne: "Dayne Warren",
  },
  zones: {},
};

export default function TeamFocusPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const field = buildTeamDayModel(FIELD, OPTS)!;
  /*
   * The fixture's run ids aren't real rows, so "open" can only be reported, not
   * performed. It has to be reported LOUDLY though: `onSelectRun` was a no-op, and
   * a no-op is indistinguishable from the tap-to-open rule being broken — the whole
   * question this page is now used to answer.
   */
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <main className="page-body mx-auto max-w-5xl space-y-6 p-4">
      <h1 className="page-title">Pace overview — focus follows the chart</h1>
      <p
        className={
          opened
            ? "rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-[13px] font-semibold text-foreground"
            : "px-3 py-2 text-[13px] text-muted-foreground"
        }
      >
        {opened ? `Opened run ${opened}` : "No run opened yet — one tap should read, two should open."}
      </p>
      <section>
        <TeamDayCard
          day={field}
          title="26 Jul 2026 · TFTR"
          viewerUserId="usr_mara"
          onSelectDriver={() => {}}
          onSelectRun={setOpened}
        />
      </section>
    </main>
  );
}
