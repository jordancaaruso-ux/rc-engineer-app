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
      className="bottom-nav fixed inset-x-0 bottom-0 z-50 border-t border-border bg-secondary/95 backdrop-blur-md md:hidden"
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-lg items-end justify-between gap-0 px-1 pt-1">
        {MOBILE_NAV.map((item) => {
          const active = activeId === item.id;
          const href =
            item.smartDraft && item.id === "add-run" ? addRunHref(draftRunId, item.href) : item.href;
          const Icon = item.icon;
          const isCenter = Boolean(item.center);

          return (
            <li key={item.id} className={cn("flex flex-1 justify-center", isCenter && "-mt-3")}>
              <Link
                href={href}
                onClick={() => {
                  if (item.smartDraft) void refreshDraft();
                }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-medium transition-colors",
                  isCenter
                    ? cn(
                        "min-w-[3.25rem] rounded-full border border-primary/30 bg-primary px-3 py-2 text-primary-foreground shadow-glow-sm",
                        active && "ring-2 ring-primary/40"
                      )
                    : cn(
                        "text-muted-foreground hover:text-foreground",
                        active && "text-foreground"
                      )
                )}
              >
                <Icon className={cn("shrink-0", isCenter ? "h-6 w-6" : "h-5 w-5")} aria-hidden />
                <span className={cn("ui-title truncate leading-none", isCenter ? "text-[9px]" : "text-[10px]")}>
                  {item.label}
                </span>
                {item.smartDraft && draftRunId ? (
                  <span
                    className="absolute right-2 top-1 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-secondary"
                    aria-label="Draft run in progress"
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
