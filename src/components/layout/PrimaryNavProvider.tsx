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
import { resolveActiveNavId, type PrimaryNavId } from "@/components/layout/navConfig";

type PrimaryNavContextValue = {
  activeId: PrimaryNavId | null;
  beginNav: (id: PrimaryNavId) => void;
};

const PrimaryNavContext = createContext<PrimaryNavContextValue | null>(null);

const PREFETCH_ROUTES = [
  "/",
  "/analysis",
  "/assets",
  "/engineer",
  "/settings",
  "/cars",
  "/tracks",
  "/tires",
  "/runs/history",
] as const;

/** Sets `data-nav-pending` on `<html>` during optimistic tab switches (no React re-render of page). */
function NavPendingMarker() {
  const pathname = usePathname();
  const { activeId } = usePrimaryNav();
  const pathnameId = resolveActiveNavId(pathname ?? "");
  const isPending = activeId !== null && activeId !== pathnameId;

  useEffect(() => {
    document.documentElement.toggleAttribute("data-nav-pending", isPending);
    return () => document.documentElement.removeAttribute("data-nav-pending");
  }, [isPending]);

  return null;
}

export function PrimaryNavProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingNavId, setPendingNavId] = useState<PrimaryNavId | null>(null);
  const pathnameId = resolveActiveNavId(pathname ?? "");

  useEffect(() => {
    setPendingNavId(null);
  }, [pathname]);

  useEffect(() => {
    const prefetchRoutes = () => {
      for (const route of PREFETCH_ROUTES) router.prefetch(route);
      router.prefetch("/runs/new");
      void import("@/components/runs/NewRunForm");
    };

    if (typeof requestIdleCallback === "function") {
      const idleId = requestIdleCallback(prefetchRoutes);
      return () => cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(prefetchRoutes, 0);
    return () => window.clearTimeout(timeoutId);
  }, [router]);

  const beginNav = useCallback((id: PrimaryNavId) => {
    setPendingNavId(id);
  }, []);

  const value = useMemo(
    (): PrimaryNavContextValue => ({
      activeId: pendingNavId ?? pathnameId,
      beginNav,
    }),
    [pendingNavId, pathnameId, beginNav]
  );

  return (
    <PrimaryNavContext.Provider value={value}>
      <NavPendingMarker />
      {children}
    </PrimaryNavContext.Provider>
  );
}

export function usePrimaryNav(): PrimaryNavContextValue {
  const ctx = useContext(PrimaryNavContext);
  if (!ctx) {
    throw new Error("usePrimaryNav must be used within PrimaryNavProvider");
  }
  return ctx;
}
