"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

type TodayDraftContextValue = {
  draftRunId: string | null;
  draftSavedAt: string | null;
  refreshDraft: () => Promise<void>;
  addRunHref: (fallback: string) => string;
};

const TodayDraftRunContext = createContext<TodayDraftContextValue | null>(null);

export function TodayDraftRunProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [draftRunId, setDraftRunId] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);

  const refreshDraft = useCallback(async () => {
    try {
      const res = await fetch("/api/runs/today-draft", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as {
        draftRunId: string | null;
        draftSavedAt?: string | null;
      };
      setDraftRunId(body.draftRunId ?? null);
      setDraftSavedAt(body.draftSavedAt ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshDraft();
  }, [refreshDraft, pathname]);

  // Refresh the dashboard's server data when the driver ARRIVES at "/", but
  // never synchronously during the navigation: calling `router.refresh()` while
  // the client push is still settling aborts it and half-commits, wedging the
  // App Router so every later soft `<Link>` nav no-ops until a hard relaunch
  // (the documented "router.refresh aborting push" PWA/webview failure). We
  // defer past the transition (macrotask) and only fire on an actual arrival,
  // not on every re-render, so the refresh can't race the inbound nav.
  const prevPathnameRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;
    if (pathname !== "/" || prev === "/" || prev === null) return;
    const id = window.setTimeout(() => router.refresh(), 0);
    return () => window.clearTimeout(id);
  }, [pathname, router]);

  // Do not idle-prefetch `/runs/[id]/edit` — that pulls the Log Run route on every
  // shelled page whenever a draft exists. FAB / dashboard CTA warm on intent.

  const value = useMemo(
    (): TodayDraftContextValue => ({
      draftRunId,
      draftSavedAt,
      refreshDraft,
      addRunHref: (fallback: string) =>
        draftRunId ? `/runs/${encodeURIComponent(draftRunId)}/edit` : fallback,
    }),
    [draftRunId, draftSavedAt, refreshDraft]
  );

  return <TodayDraftRunContext.Provider value={value}>{children}</TodayDraftRunContext.Provider>;
}

export function useTodayDraftRun(): TodayDraftContextValue {
  const ctx = useContext(TodayDraftRunContext);
  if (!ctx) {
    throw new Error("useTodayDraftRun must be used within TodayDraftRunProvider");
  }
  return ctx;
}

export function useTodayDraftRunOptional(): TodayDraftContextValue | null {
  return useContext(TodayDraftRunContext);
}
