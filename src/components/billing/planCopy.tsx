import type { ReactNode } from "react";
import { TIER_LABELS } from "@/lib/brand/brandNames";
import { STARTER_RUN_WINDOW, type PaidTier } from "@/lib/entitlementLogic";
import {
  PRO_ENGINEER_MONTHLY_QUESTIONS,
  STANDARD_ENGINEER_DAILY_QUESTIONS,
} from "@/lib/aiUsage/budgets";

/**
 * What each plan says, in ONE place. The /join cards (signed out, the dark door) and the in-app
 * Subscription page (signed in, paper) both render from here, so the two can never sell
 * different products. The landing page (`public/landing/index.html`) is static HTML and still
 * carries its own copy by hand: change it alongside.
 *
 * Feature truth mirrors entitlementLogic.ts, and the Engineer numbers read from `budgets.ts`
 * rather than repeating them: this is the promise, `applyEngineerTierBudget` is the enforcement,
 * and the two drifting apart is how a member gets sold one number and refused at another. The
 * Starter window reads `STARTER_RUN_WINDOW` for the same reason.
 *
 * Founder rulings baked in (2026-09-15): video is on no surface, not as a feature and not as
 * "soon"; the Engineer is Race Engineer's feature, so Notebook's one question a day is worded as a
 * taste and sits last; the Starter window is written in runs. Later the same day: lap time
 * analysis is a Tools bench, not the notebook, so the compare table gives it a row of its own.
 * It was Notebook's until 2026-09-24 and is Race Engineer's since (founder call), so both
 * cheaper cards list it crossed out and Race Engineer's lists it. Teams, same day: none on
 * Starter, one on Notebook, any number on Race Engineer (`teamLimitFor` enforces it).
 */

/** The window as a word, so the card reads as a sentence; digits if it ever moves off one. */
const WINDOW_WORDS: Record<number, string> = { 10: "ten", 15: "fifteen", 20: "twenty" };
export const WINDOW_WORD = WINDOW_WORDS[STARTER_RUN_WINDOW] ?? String(STARTER_RUN_WINDOW);

/** Cheapest first: the order every plan surface lists them in. */
export const PLAN_TIERS: readonly PaidTier[] = ["starter", "standard", "pro"];

export const PLAN_TAGLINE: Record<PaidTier, string> = {
  starter: `Your last ${WINDOW_WORD} runs.`,
  standard: "The smart race notebook.",
  pro: "The full race engineer.",
};

/** The one figure boxed on each card: runs kept for the two notebooks, questions for the Engineer. */
export const PLAN_STAT: Record<PaidTier, { label: string; value: string }> = {
  starter: { label: "Runs kept", value: `Last ${STARTER_RUN_WINDOW}` },
  standard: { label: "Runs kept", value: "All" },
  pro: { label: "Engineer questions", value: `${PRO_ENGINEER_MONTHLY_QUESTIONS} a month` },
};

export type PlanBullet = { text: string; off?: boolean };

export const PLAN_BULLETS: Record<PaidTier, PlanBullet[]> = {
  starter: [
    { text: `Your last ${WINDOW_WORD} runs` },
    { text: "Session review: pace, consistency, mistakes" },
    { text: "Compare runs and setups" },
    { text: "Laps from LiveRC and Speedhive" },
    { text: "Teams", off: true },
    { text: "Laptime Analysis", off: true },
    { text: "The Engineer", off: true },
    { text: "Roll-centre and geometry", off: true },
  ],
  // Notebook is the notebook with every run kept. Its one Engineer question a day is a taste,
  // not a feature, so it sits last and is worded as a taste.
  standard: [
    { text: "Unlimited run logging" },
    { text: "Session review: pace, consistency, mistakes" },
    { text: "Compare runs and setups" },
    { text: "Laps from LiveRC and Speedhive" },
    { text: "One team" },
    {
      text: `A taste of the Engineer: ${
        STANDARD_ENGINEER_DAILY_QUESTIONS === 1
          ? "one question"
          : `${STANDARD_ENGINEER_DAILY_QUESTIONS} questions`
      } a day`,
    },
    { text: "Laptime Analysis", off: true },
    { text: "Roll-centre and geometry", off: true },
  ],
  pro: [
    { text: "The Engineer" },
    { text: `Everything in ${TIER_LABELS.standard}` },
    { text: "A whole race weekend's questions in one day" },
    { text: "Laptime Analysis: any race, any driver" },
    { text: "Roll-centre and geometry tools" },
    { text: "Any number of teams" },
    { text: "Remaining-this-month meter" },
  ],
};

/** The same truth as a table, for the phone's "line by line" fold. Change both together. */
export const COMPARE_ROWS: Array<{ label: string } & Record<PaidTier, string>> = [
  { label: "Runs kept", starter: `Last ${STARTER_RUN_WINDOW}`, standard: "All", pro: "All" },
  { label: "Run logging (LiveRC · Speedhive)", starter: "✓", standard: "✓", pro: "✓" },
  { label: "Session review", starter: "✓", standard: "✓", pro: "✓" },
  { label: "Compare runs & setups", starter: "✓", standard: "✓", pro: "✓" },
  { label: "Teams", starter: "—", standard: "One", pro: "Any number" },
  { label: "Laptime Analysis · any race", starter: "—", standard: "—", pro: "✓" },
  {
    label: "The Engineer",
    starter: "—",
    standard: `Taste · ${STANDARD_ENGINEER_DAILY_QUESTIONS} a day`,
    pro: `${PRO_ENGINEER_MONTHLY_QUESTIONS} a month`,
  },
  { label: "Ask a weekend's worth in one day", starter: "—", standard: "—", pro: "✓" },
  { label: "Roll-centre tools", starter: "—", standard: "—", pro: "✓" },
];

export const INTERVAL_SUFFIX = { month: "AUD / month", year: "AUD / year" } as const;

const STANDARD_DAILY_WORDS =
  STANDARD_ENGINEER_DAILY_QUESTIONS === 1
    ? "once a day"
    : `${STANDARD_ENGINEER_DAILY_QUESTIONS} times a day`;

/** The one-line pitch on a phone row, where there is no room for the bullets. */
export function PlanHook({ tier }: { tier: PaidTier }): ReactNode {
  if (tier === "starter") {
    return (
      <>
        Your last{" "}
        <span className="font-semibold text-primary-ink">{WINDOW_WORD} runs</span> · no Engineer
      </>
    );
  }
  if (tier === "standard") {
    return (
      <>
        <span className="font-semibold text-primary-ink">Every run kept</span> · a taste of the
        Engineer, {STANDARD_DAILY_WORDS}
      </>
    );
  }
  return (
    <>
      <span className="font-semibold text-primary-ink">The Engineer</span>,{" "}
      {PRO_ENGINEER_MONTHLY_QUESTIONS} questions a month · roll centre, geometry, the lot
    </>
  );
}
