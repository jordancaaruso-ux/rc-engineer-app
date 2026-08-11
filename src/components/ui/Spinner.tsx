import { cn } from "@/lib/utils";

/**
 * The one activity ring — faint accent track, solid accent head.
 *
 * `md` is the same markup the lap-import panel builds inline
 * (`runs/LapTimesIngestPanel.tsx`, the "Searching for new runs…" block); fold that call
 * site into this on its next touch rather than adding a fifth hand-rolled spinner.
 *
 * Reduced motion: `motion-safe:` means the ring simply doesn't spin — the end state,
 * immediately, not a shortened animation. That's the house rule in `ui/motion.tsx`.
 */
const SPINNER_SIZE = {
  sm: "h-4 w-4 border-2",
  md: "h-[22px] w-[22px] border-2",
  lg: "h-8 w-8 border-2",
} as const;

export function Spinner({
  size = "md",
  className,
}: {
  size?: keyof typeof SPINNER_SIZE;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block shrink-0 rounded-full border-primary-ink/20 border-t-accent motion-safe:animate-spin",
        SPINNER_SIZE[size],
        className
      )}
    />
  );
}
