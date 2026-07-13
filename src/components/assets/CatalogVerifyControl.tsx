"use client";

import { cn } from "@/lib/utils";

/**
 * Subtle "unverified" flag for global catalog rows + an admin-only verify toggle
 * (the minimal Phase-1 review surface). Everyone sees the badge; only admins see the
 * toggle. See docs/ASSET_ACCESS_NORTH_STAR.md.
 */
export function UnverifiedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-muted/40 px-1.5 py-0.5",
        "font-mono text-[10px] uppercase tracking-wide text-muted-foreground",
        className
      )}
      title="Unverified — user-created and not yet confirmed by an admin. Usable now; excluded from community data until verified."
    >
      Unverified
    </span>
  );
}

export function CatalogVerifyControl({
  verified,
  isAdmin,
  pending = false,
  onToggle,
  className,
}: {
  verified: boolean;
  isAdmin: boolean;
  pending?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      {!verified ? <UnverifiedBadge /> : null}
      {isAdmin && onToggle ? (
        <button
          type="button"
          disabled={pending}
          onClick={onToggle}
          className={cn(
            "text-xs px-3 py-1.5 rounded-md border hover:bg-muted/50 disabled:opacity-60",
            verified
              ? "border-border text-muted-foreground"
              : "border-primary/50 text-primary"
          )}
        >
          {pending ? "…" : verified ? "Unverify" : "Verify"}
        </button>
      ) : null}
    </span>
  );
}
