/**
 * The app's palette, as literals a picture renderer can use.
 *
 * Satori has no CSS engine: it cannot read `var(--color-foreground)`, so every colour on a shared
 * card has to arrive as a resolved value. The first version of these cards was hand-picked from a
 * mockup and came out COOL — slate greys against the app's warm charcoal — which read, correctly,
 * as a different product sitting next to the real one. Nothing here is invented: each value is
 * copied from `src/app/globals.css` with its token name attached.
 *
 * **If globals.css moves, this file has to move with it.** There is no import that would fail and
 * no type that would complain; the only symptom is a shared picture that looks slightly wrong,
 * which is exactly the failure that produced this file.
 *
 * Cards are ALWAYS DARK, whatever the sender's theme (founder call, 2026-08-13): the picture is a
 * file handed to other people, so the sender's setting must not decide what a recipient sees, and
 * one artifact with two faces is a weaker mark than one with a single face.
 */

/** Dark — the app's default, and the ground for every card the app draws. */
export const SHARE_DARK = {
  /** `--color-background` */
  bg: "#121110",
  /** `--page-bg-rgb` — the top stop of the Hero card's ground gradient. */
  pageTop: "#1B1A17",
  /** `--color-card` — wells and raised blocks. */
  surface: "#181716",
  /** `--color-secondary` — the recessed well the lap chips sit in. */
  recessed: "#151413",
  /** `--color-surface-runna-deep` — the deepest ground; the preview frame and the felt panel. */
  deep: "#0F0F0E",
  /** `--color-muted` */
  muted: "#1E1D1C",
  /** `--color-foreground` */
  ink: "#ECE9E4",
  /** `--color-muted-foreground` */
  mut: "#A09D96",
  /** `--color-faint` — labels, and the superseded half of a setup change. */
  faint: "#64625E",
  /** `--color-border` */
  line: "#282726",
  /** `--color-border / 0.5` — the interior seam of a diff table, softer than its frame. */
  lineSoft: "rgba(40, 39, 38, 0.5)",
  /** `--color-background / 0.45` — the instrument-well fill, matching `StatWellGrid`. */
  wellFill: "rgba(18, 17, 16, 0.45)",
  /** `--color-muted / 0.7` — the setup-diff table's ground, matching `SetupChangedSincePreviousList`. */
  diffFill: "rgba(30, 29, 28, 0.7)",
  /** `--color-secondary / 0.95` — that table's header band. */
  diffHead: "rgba(21, 20, 19, 0.95)",
  /** A hairline of white over a raised surface — the specular top rim on the lap well. */
  rim: "rgba(255, 255, 255, 0.04)",
  /**
   * `--color-primary` / `--color-primary-ink`. Yellow is ACTIONS ONLY in the app, and a picture has
   * no actions — so on a card it appears exactly twice: the brand mark, and the section ticks and
   * the JRC cut, which are brand marks too. Never as a data value.
   */
  primary: "#FFD60A",
  /** `--color-gain` — a lap got faster. Data, not decoration. */
  gain: "#4FD089",
  /** `--color-destructive` */
  loss: "#E5644E",
  /** `--color-destructive / 0.6` and `/ 0.1` — a flagged notable's border and fill. */
  lossBorder: "rgba(229, 100, 78, 0.6)",
  lossFill: "rgba(229, 100, 78, 0.1)",
  /** `.lap-flag-best` */
  flagBest: "rgba(147, 51, 234, 0.55)",
  /** The ring around a best-lap chip. */
  flagBestRing: "rgba(168, 85, 247, 0.45)",
  /** `.lap-flag-mistake` */
  flagMistake: "rgba(220, 38, 38, 0.55)",
  flagMistakeRing: "rgba(239, 68, 68, 0.45)",
  /** `--color-best-lap` — the best-lap dot on the trace. */
  bestLap: "#A78BFA",
  /** Ink on a flag chip, where the flag fill is dark enough to carry white. */
  white: "#FFFFFF",
  whiteDim: "rgba(255, 255, 255, 0.8)",
  /**
   * `--color-rating-*`, keyed by the band caption so it cannot drift from `CAR_RATING_BANDS`.
   * The band ramp is the one place a colour on this card means "quality" — same as the picker.
   */
  rating: {
    Bad: "#E5644E",
    Workable: "#D99A7C",
    Good: "#6FBC90",
    Dialled: "#4FD089",
  } as Record<string, string>,
  /**
   * `--color-foreground` at 0.22 / 0.40 / 0.62 — the MONOCHROME read-back ramp for the corner
   * balance staircase. The capture control fills in accent; a stored record must never be
   * mistakable for a live one, so read-back drops to ink (`tileFill(level, true)`).
   */
  inkRamp: ["rgba(236, 233, 228, 0.22)", "rgba(236, 233, 228, 0.4)", "rgba(236, 233, 228, 0.62)"],
} as const;

/*
 * There is no light palette here. There was one, for a brand strip stamped under a rendered setup
 * sheet; the founder took that footer off the setup (2026-08-13), so a shared sheet is now the
 * driver's own page untouched and nothing the app draws is ever light. If a light surface is ever
 * needed again, take the values from `[data-theme="light"]` in globals.css — not from a mockup.
 */
