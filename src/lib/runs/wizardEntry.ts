/**
 * Payload handed from the Log-run entry screen (page 1) to the wizard-hosted
 * NewRunForm. Entry v2 (founder interview 2026-07-16) resolves the full run
 * identity up front: session context (testing vs race meeting + event), track,
 * car, copy-vs-fresh, and the "what changed" chips.
 */
import type { WizardChangeChip } from "@/lib/runs/wizardWalk";

export type NewRunWizardEntry = {
  carId: string;
  /** Copy the picked car's most recent run (explicit Copy button). */
  continuing: boolean;
  /** Declared-changed chips from the entry (tires/battery/setup/prep). */
  changed: WizardChangeChip[];
  sessionType: "TESTING" | "RACE_MEETING";
  meetingSessionType: "PRACTICE" | "QUALIFYING" | "RACE" | null;
  /** "Main" when the session is a main; null otherwise. */
  sessionLabel: string | null;
  /** Race meeting: the event this run attaches to (track derives from it). */
  eventId: string | null;
  /** Test day: the picked/auto-detected track (null when the event carries it). */
  trackId: string | null;
  /** Test day: named layout + direction picked with the track (optional). */
  trackLayoutId: string | null;
  trackDirection: "CW" | "CCW" | null;
};
