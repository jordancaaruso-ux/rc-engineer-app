import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Staggered entrance wrapper — pure CSS (`.rc-reveal` in globals.css), so it
 * stays a server component and needs no JS. Each sibling passes an incrementing
 * `index`; the 60ms-per-step delay makes a page of cards land in sequence.
 * Reduced motion collapses it to the end state instantly (see the media query).
 */
export function Reveal({
  index = 0,
  className,
  children,
}: {
  index?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("rc-reveal", className)}
      style={{ "--rc-delay": `${index * 60}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
