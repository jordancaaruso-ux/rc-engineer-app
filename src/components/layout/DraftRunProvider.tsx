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

type DraftRunContextValue = {
  /** The best unfinished run from the last three days. Null when there is none. */
  draftRunId: string | null;
  draftSavedAt: string | null;
  draftEventName: string | null;
  /** Saved today, or its event is running today — see `resumableDraftLogic`. */
  draftIsForToday: boolean;
  /**
   * The draft the PRIMARY action may resume, which is `draftRunId` only while it is for today.
   *
   * The split is deliberate. Even inside the three-day window a draft is not automatically what
   * the driver means right now: one banked for Saturday, or left over from Thursday, is not what
   * the Log-run circle should open. That circle is the app's single unmissable "start a run"
   * affordance, and pointing it at an old draft turns the most used control in the product into
   * a trap. Today's draft still takes it over, as it always has; anything else is found in
   * Sessions under the Drafts filter.
   */
  activeDraftRunId: string | null;
  refreshDraft: () => Promise<void>;
  addRunHref: (fallback: string) => string;
};

const DraftRunContext = createContext<DraftRunContextValue | null>(null);

export function DraftRunProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [draftRunId, setDraftRunId] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [draftEventName, setDraftEventName] = useState<string | null>(null);
  const [draftIsForToday, setDraftIsForToday] = useState(false);

  const refreshDraft = useCallback(async () => {
    try {
      const res = await fetch("/api/runs/draft", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as {
        draftRunId: string | null;
        draftSavedAt?: string | null;
        draftEventName?: string | null;
        draftIsForToday?: boolean;
      };
      setDraftRunId(body.draftRunId ?? null);
      setDraftSavedAt(body.draftSavedAt ?? null);
      setDraftEventName(body.draftEventName ?? null);
      setDraftIsForToday(Boolean(body.draftIsForToday));
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

  const value = useMemo((): DraftRunContextValue => {
    const activeDraftRunId = draftIsForToday ? draftRunId : null;
    return {
      draftRunId,
      draftSavedAt,
      draftEventName,
      draftIsForToday,
      activeDraftRunId,
      refreshDraft,
      addRunHref: (fallback: string) =>
        activeDraftRunId ? `/runs/${encodeURIComponent(activeDraftRunId)}/edit` : fallback,
    };
  }, [draftRunId, draftSavedAt, draftEventName, draftIsForToday, refreshDraft]);

  return <DraftRunContext.Provider value={value}>{children}</DraftRunContext.Provider>;
}

export function useDraftRun(): DraftRunContextValue {
  const ctx = useContext(DraftRunContext);
  if (!ctx) {
    throw new Error("useDraftRun must be used within DraftRunProvider");
  }
  return ctx;
}

export function useDraftRunOptional(): DraftRunContextValue | null {
  return useContext(DraftRunContext);
}
