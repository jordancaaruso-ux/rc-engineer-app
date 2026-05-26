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
  refreshDraft: () => Promise<void>;
  addRunHref: (fallback: string) => string;
};

const TodayDraftRunContext = createContext<TodayDraftContextValue | null>(null);

export function TodayDraftRunProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [draftRunId, setDraftRunId] = useState<string | null>(null);

  const refreshDraft = useCallback(async () => {
    try {
      const res = await fetch("/api/runs/today-draft", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { draftRunId: string | null };
      setDraftRunId(body.draftRunId ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshDraft();
  }, [refreshDraft, pathname]);

  useEffect(() => {
    router.prefetch("/");
  }, [router]);

  const value = useMemo(
    (): TodayDraftContextValue => ({
      draftRunId,
      refreshDraft,
      addRunHref: (fallback: string) =>
        draftRunId ? `/runs/${encodeURIComponent(draftRunId)}/edit` : fallback,
    }),
    [draftRunId, refreshDraft]
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
