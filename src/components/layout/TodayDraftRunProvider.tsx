"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
    void (async () => {
      await refreshDraft();
      if (pathname === "/") {
        router.refresh();
      }
    })();
  }, [refreshDraft, pathname, router]);

  useEffect(() => {
    if (!draftRunId) return;
    router.prefetch(`/runs/${encodeURIComponent(draftRunId)}/edit`);
  }, [draftRunId, router]);

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
