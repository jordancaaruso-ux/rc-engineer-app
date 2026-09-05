"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { TeamDayCard } from "@/components/runs/TeamDayCard";
import { buildTeamDayModel, type TeamDayRunSource } from "@/lib/runs/teamDayModel";

/**
 * Scratch preview: the Pace overview with ONE driver (as reported on 3 Sep) and
 * with FIVE, so the two pictures can be compared at the same width. Delete after
 * review.
 */

const DAY = "2026-08-30T";

/** Laps around a best, so the scrub readout has a real lap count to show. */
function laps(best: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => +(best + (i % 5) * 0.09 + (i % 3) * 0.04).toFixed(3));
}

function run(
  id: string,
  userId: string,
  clock: string,
  best: number,
  label: string,
  car = "A800R"
): TeamDayRunSource {
  return {
    id,
    userId,
    carId: `car_${userId}`,
    carNameSnapshot: car,
    createdAt: new Date(`${DAY}${clock}:00Z`),
    sortAt: new Date(`${DAY}${clock}:00Z`),
    localTimeZone: "UTC",
    lapTimes: laps(best, 17),
    bestLapSeconds: best,
    avgTop5LapSeconds: +(best + 0.28).toFixed(3),
    sessionLabel: label,
  };
}

/** The reported day, read off the screenshot: 9 runs, 17.105 fastest. */
const SOLO: TeamDayRunSource[] = [
  run("s1", "usr_glenn", "12:40", 17.255, "R1"),
  run("s2", "usr_glenn", "13:00", 17.27, "R2"),
  run("s3", "usr_glenn", "13:55", 17.225, "R3"),
  run("s4", "usr_glenn", "14:05", 17.145, "R4"),
  run("s5", "usr_glenn", "14:35", 17.29, "R5"),
  run("s6", "usr_glenn", "15:00", 17.19, "R6"),
  run("s7", "usr_glenn", "15:35", 17.35, "R7"),
  run("s8", "usr_glenn", "16:50", 17.215, "R8"),
  run("s9", "usr_glenn", "17:00", 17.105, "R9"),
];

/**
 * Five drivers on one club test day. Same clock, same class, staggered heats —
 * nobody's runs land on top of anybody else's, which is the whole point of the
 * time-of-day axis.
 */
const FIVE: TeamDayRunSource[] = [
  ...SOLO,
  run("m1", "usr_mara", "12:35", 17.02, "R1", "A800RR"),
  run("m2", "usr_mara", "13:10", 16.98, "R2", "A800RR"),
  run("m3", "usr_mara", "14:00", 17.11, "R3", "A800RR"),
  run("m4", "usr_mara", "14:45", 16.94, "R4", "A800RR"),
  run("m5", "usr_mara", "15:40", 16.9, "R5", "A800RR"),
  run("m6", "usr_mara", "16:45", 16.96, "R6", "A800RR"),
  run("d1", "usr_dayne", "12:50", 17.62, "R1", "TC8"),
  run("d2", "usr_dayne", "13:30", 17.48, "R2", "TC8"),
  run("d3", "usr_dayne", "14:20", 17.55, "R3", "TC8"),
  run("d4", "usr_dayne", "15:15", 17.4, "R4", "TC8"),
  run("d5", "usr_dayne", "16:05", 17.33, "R5", "TC8"),
  run("d6", "usr_dayne", "16:55", 17.29, "R6", "TC8"),
  run("c1", "usr_chris", "13:05", 17.86, "R1", "Xray X4"),
  run("c2", "usr_chris", "13:45", 17.74, "R2", "Xray X4"),
  run("c3", "usr_chris", "14:40", 17.79, "R3", "Xray X4"),
  run("c4", "usr_chris", "15:25", 17.58, "R4", "Xray X4"),
  run("c5", "usr_chris", "16:20", 17.51, "R5", "Xray X4"),
  run("k1", "usr_kade", "12:45", 17.44, "R1", "Awesomatix A800X"),
  run("k2", "usr_kade", "13:20", 17.39, "R2", "Awesomatix A800X"),
  run("k3", "usr_kade", "14:15", 17.21, "R3", "Awesomatix A800X"),
  run("k4", "usr_kade", "15:05", 17.28, "R4", "Awesomatix A800X"),
  run("k5", "usr_kade", "15:55", 17.16, "R5", "Awesomatix A800X"),
  run("k6", "usr_kade", "16:40", 17.24, "R6", "Awesomatix A800X"),
  run("k7", "usr_kade", "17:10", 17.19, "R7", "Awesomatix A800X"),
];

const OPTS = {
  memberDisplayByUserId: {
    usr_glenn: "Glenn Harding",
    usr_mara: "Mara Ellis",
    usr_dayne: "Dayne Warren",
    usr_chris: "Christopher Vandenberg",
    usr_kade: "Kade Nguyen",
  },
  zones: {},
};

export default function TeamFivePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <main className="page-body mx-auto max-w-5xl space-y-6 p-4">
      <h1 className="page-title">One driver — the day as reported</h1>
      <section data-shot="solo">
        <TeamDayCard
          day={buildTeamDayModel(SOLO, OPTS)!}
          title="30 Aug 2026 · TFTR"
          viewerUserId={null}
          onSelectDriver={() => {}}
          onSelectRun={setOpened}
        />
      </section>
      <h1 className="page-title">Five drivers — same day, same widths</h1>
      <section data-shot="five">
        <TeamDayCard
          day={buildTeamDayModel(FIVE, OPTS)!}
          title="30 Aug 2026 · TFTR"
          viewerUserId="usr_glenn"
          onSelectDriver={() => {}}
          onSelectRun={setOpened}
        />
      </section>
      <p className="px-3 py-2 text-[13px] text-muted-foreground">
        {opened ? `Opened run ${opened}` : "No run opened yet."}
      </p>
    </main>
  );
}
