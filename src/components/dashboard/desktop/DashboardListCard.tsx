import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

/**
 * Card chrome for the desktop column's two lists (design handoff 2026-08-08): an eyebrow
 * header with a zero-padded count, hairline rows, and an optional footer link.
 *
 * The rows themselves stay `ActionItemListPanel` in its "ledger" variant — same add,
 * archive and drag-to-reorder, just restyled. This is only the frame around it.
 */
export function DashboardListCard({
  title,
  subtitle,
  count,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  count: number;
  footer?: { label: string; href: string; sparkle?: boolean };
  children: ReactNode;
}) {
  return (
    <SurfaceCard contentClassName="p-0" className="rounded-xl">
      <div className="flex items-baseline gap-3 border-b border-border px-[18px] py-3.5">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-faint">
          {title}
        </span>
        {subtitle ? (
          <span className="truncate text-[11.5px] text-faint">{subtitle}</span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-faint">
          {String(count).padStart(2, "0")}
        </span>
      </div>

      <div className="px-[18px] py-1">{children}</div>

      {footer ? (
        <Link
          href={footer.href}
          prefetch={false}
          className="tap-active flex items-center gap-2 border-t border-border px-[18px] py-3 text-[12.5px] font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          {footer.sparkle ? (
            <span aria-hidden className="text-primary-ink">
              ✦
            </span>
          ) : null}
          {footer.label}
          <ArrowUpRight className="ml-auto size-3.5 text-faint" aria-hidden />
        </Link>
      ) : null}
    </SurfaceCard>
  );
}
