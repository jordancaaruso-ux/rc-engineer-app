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
  /** `--color-card` — wells and raised blocks. */
  surface: "#181716",
  /** `--color-secondary` — the recessed well the lap chips sit in. */
  recessed: "#151413",
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
  /**
   * `--color-primary` / `--color-primary-ink`. Yellow is ACTIONS ONLY in the app, and a picture has
   * no actions — so on a card it appears exactly twice: the brand mark, and the rating/trait
   * instruments, which mirror the app's own controls. Never as a section rule or a data value.
   */
  primary: "#FFD60A",
  /** `--color-gain` — a lap got faster. Data, not decoration. */
  gain: "#4FD089",
  /** `--color-destructive` */
  loss: "#E5644E",
  /** `.lap-flag-best` */
  flagBest: "rgba(147, 51, 234, 0.55)",
  /** `.lap-flag-mistake` */
  flagMistake: "rgba(220, 38, 38, 0.55)",
  /** A plain lap in the trace: a lifted neutral, so the two flag colours stay the only signal. */
  bar: "#3A3836",
} as const;

/**
 * Light — used ONLY for the strip stamped along the bottom of a rendered setup sheet.
 *
 * That sheet is a photograph of the driver's own paper and cannot be themed, so the footer has to
 * work on white. Values are `[data-theme="light"]` from globals.css.
 */
export const SHARE_LIGHT = {
  /** `--background` */
  bg: "#F4F1EA",
  /** `--surface` */
  surface: "#FCFBF8",
  /** `--foreground` */
  ink: "#191815",
  /** `--muted-fg` */
  mut: "#6B675F",
  /** `--faint` */
  faint: "#9A958B",
  /** `--border` */
  line: "#DDD8CE",
  /** `--primary` — same yellow on both grounds. */
  primary: "#FFD60A",
} as const;
