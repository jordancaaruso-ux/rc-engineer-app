"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MOBILE_NAV, resolveActiveNavId } from "@/components/layout/navConfig";
import { cn } from "@/lib/utils";

type TodayDraftResponse = { draftRunId: string | null };

function addRunHref(draftRunId: string | null, fallback: string): string {
  return draftRunId ? `/runs/${encodeURIComponent(draftRunId)}/edit` : fallback;
}

export function BottomNav() {
  const pathname = usePathname();
  const activeId = resolveActiveNavId(pathname ?? "");
  const [draftRunId, setDraftRunId] = useState<string | null>(null);

  const refreshDraft = useCallback(async () => {
    try {
      const res = await fetch("/api/runs/today-draft", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as TodayDraftResponse;
      setDraftRunId(body.draftRunId ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshDraft();
  }, [refreshDraft, pathname]);

  return (
    <nav
      className="bottom-nav fixed inset-x-0 bottom-0 z-50 md:hidden"
      aria-label="Primary"
    >
      <div className="overflow-visible border-t border-border bg-card">
        <ul className="mx-auto grid h-[var(--mobile-tab-bar-height)] max-w-lg grid-cols-6 overflow-visible px-1">
          {MOBILE_NAV.map((item) => {
            const active = activeId === item.id;
            const href =
              item.smartDraft && item.id === "add-run" ? addRunHref(draftRunId, item.href) : item.href;
            const Icon = item.icon;
            const isCenter = Boolean(item.center);

            if (isCenter) {
              return (
                <li key={item.id} className="relative flex flex-col items-center justify-end overflow-visible pb-1.5">
                  <Link
                    href={href}
                    onClick={() => {
                      if (item.smartDraft) void refreshDraft();
                    }}
                    aria-current={active ? "page" : undefined}
                    aria-label={item.label}
                    className="absolute -top-[var(--mobile-tab-fab-overhang)] flex flex-col items-center"
                  >
                    <span
                      className={cn(
                        "relative flex h-[var(--mobile-tab-fab-size)] w-[var(--mobile-tab-fab-size)] items-center justify-center rounded-full border-4 border-card bg-foreground text-background shadow-[0_4px_14px_rgb(0_0_0/0.35)] transition-transform active:scale-95",
                        active && "ring-2 ring-accent/50"
                      )}
                    >
                      <Icon className="h-6 w-6" aria-hidden />
                      {item.smartDraft && draftRunId ? (
                        <span
                          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-card"
                          aria-hidden
                        />
                      ) : null}
                    </span>
                  </Link>
                  <span
                    className={cn(
                      "ui-title truncate text-[10px] leading-none",
                      active ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {item.label}
                  </span>
                </li>
              );
            }

            return (
              <li key={item.id} className="flex flex-col items-center justify-end pb-1.5">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-w-0 flex-col items-center gap-1 px-1 transition-colors",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="ui-title truncate text-[10px] leading-none">{item.label}</span>
                  <span
                    className={cn(
                      "h-1 w-1 rounded-full bg-accent transition-opacity",
                      active ? "opacity-100" : "opacity-0"
                    )}
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
