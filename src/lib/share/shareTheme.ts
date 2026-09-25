/**
 * The app's palette, as literals a picture renderer can use.
 *
 * Satori has no CSS engine: it cannot read `var(--color-foreground)`, so every colour on a shared
 * picture has to arrive as a resolved value. The first version of these cards was hand-picked from
 * a mockup and came out COOL — slate greys against the app's warm charcoal — which read, correctly,
 * as a different product sitting next to the real one. Nothing here is invented: each value is
 * copied from `src/app/globals.css` with its token name attached.
 *
 * **If globals.css moves, this file has to move with it.** There is no import that would fail and
 * no type that would complain; the only symptom is a shared picture that looks slightly wrong,
 * which is exactly the failure that produced this file.
 *
 * Pictures are PAPER, whatever else changes. They were always dark until 2026-09-25, a founder call
 * made when dark was the app's own look; the app has been paper only since 2026-08-18, and the dark
 * pictures read as "the old styling of the app" (founder, 2026-09-25). One face still holds: the
 * sender's device never decides what a recipient sees.
 */

/**
 * Paper — each value copied from `:root[data-theme="light"]` in globals.css, token name attached.
 */
export const SHARE_PAPER = {
  /** `--page-bg-rgb` — the page ground. */
  ground: "#F4F4F3",
  /** `--color-card` */
  card: "#FFFFFF",
  /** `bg-background/45` over a card — the instrument wells' fill. */
  well: "#FDFDFD",
  /** `--band-fill` (ink at 2.2%) over a card — a card's header band. */
  band: "#FAFAFA",
  /** `--color-foreground` — warm ink, never black. */
  ink: "#191815",
  /** `--color-muted-foreground` */
  mut: "#6B675F",
  /** `--color-faint` — decorative only. */
  faint: "#959493",
  /** `--color-border` */
  line: "#E5E5E3",
  /** `--color-skeleton` — an unlit tile on a card. */
  unlit: "#E9E9E8",
  /** `.glass-card`'s edge on paper: ink at 9%. */
  cardEdge: "rgba(25, 24, 21, 0.09)",
  /** `--color-primary`. Marks and fills only; never text on paper (1.4:1). */
  primary: "#FFD60A",
  /** `--color-primary-lit` / `--color-primary-deep` — the lit yellow face's two ends. */
  primaryLit: "#FFDE24",
  primaryDeep: "#FCCB00",
  /** `--color-gain` */
  gain: "#07794D",
  /** `--color-destructive` */
  loss: "#BE3F27",
  /** `--color-destructive` at 0.35 / 0.06 — a flagged notable's edge and fill. */
  lossEdge: "rgba(190, 63, 39, 0.35)",
  lossFill: "rgba(190, 63, 39, 0.06)",
  /** `--color-best-lap` — the best-lap dot on the trace. */
  bestLap: "#6D28D9",
  /** `.lap-flag-best` / `.lap-flag-mistake` on paper — near-opaque, so white numerals hold. */
  flagBest: "rgba(107, 33, 168, 0.94)",
  flagMistake: "rgba(185, 28, 28, 0.94)",
  white: "#FFFFFF",
  /** `--color-rating-*`, keyed by band caption so it cannot drift from `CAR_RATING_BANDS`. */
  rating: {
    Bad: "#BE3F27",
    Workable: "#9E6238",
    Good: "#4A7F63",
    Dialled: "#07794D",
  } as Record<string, string>,
  /** `--color-foreground` at 0.22 / 0.40 / 0.62 — the monochrome read-back ramp. */
  inkRamp: ["rgba(25, 24, 21, 0.22)", "rgba(25, 24, 21, 0.4)", "rgba(25, 24, 21, 0.62)"],
} as const;
