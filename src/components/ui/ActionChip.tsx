import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";

/**
 * One action in a page's action row: a glyph and its word, at every width.
 *
 * Icon-only chips were tried on the phone for one afternoon and pulled the same day (founder,
 * 2026-09-01): "don't try to make them just icons, just keep the words on all the buttons all the
 * time". The row wraps at 390px, and that is accepted — a wrapped row of words beats a tidy row of
 * guesses. Do NOT re-propose hiding them; `chips-compact` and `ChipLabel` were the machinery for
 * it and are gone.
 *
 * `title` stays for the desktop hover. No `aria-label`: the visible word IS the accessible name,
 * and an aria-label would override it with a copy that can drift.
 */
export function ActionChip({
  href,
  label,
  icon,
  variant = "outline",
  className,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  variant?: "primary" | "outline";
  className?: string;
}) {
  return (
    <Link
      href={href}
      title={label}
      className={buttonLinkClassName(variant, cn("gap-1.5", className))}
    >
      {icon}
      {label}
    </Link>
  );
}
