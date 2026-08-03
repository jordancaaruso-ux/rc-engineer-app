import { cn } from "@/lib/utils";

/**
 * Canonical flat "chip toggle" treatment shared by every segmented / single- or
 * multi-select toggle in the app (session type, layout direction, handling
 * traits/speed/severity, tire compounds, race-field tabs). One shape + one set of
 * active/inactive colors so they all read as the same component family; each call
 * site keeps its own padding / text size (size may vary, style is identical).
 *
 * - Neutral active = raised neutral surface (`bg-muted`) — yellow stays reserved
 *   for actions, never selected-state (VISUAL_NORTH_STAR). The corner-balance
 *   instrument is the one signed-off exception to the yellow rule and deliberately
 *   does **not** go through this helper: it fills a magnitude, not a selection.
 * - `tone: "problem"` = destructive tint, only for chips whose *selected* state
 *   means "this was a problem" (red = negative data, a semantic, not decoration).
 */
export type ChipToggleTone = "neutral" | "problem";

export function chipToggleClass(
  active: boolean,
  opts?: { tone?: ChipToggleTone }
): string {
  const tone = opts?.tone ?? "neutral";
  return cn(
    "rounded-md border font-sans font-medium tracking-tight transition-colors duration-150 touch-manipulation disabled:opacity-60",
    active
      ? tone === "problem"
        ? "border-destructive/70 bg-destructive/15 text-foreground"
        : "border-foreground/50 bg-muted text-foreground"
      : "border-border bg-secondary text-muted-foreground hover:text-foreground"
  );
}
