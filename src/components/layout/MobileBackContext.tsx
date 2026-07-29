"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * Lets a page's `PageBackLink` publish its back destination to the fixed
 * mobile corner chrome, so the top-left JRC pill can morph into a back button
 * when a page has one (instead of the pill covering the header's back arrow).
 *
 * Last-registered-wins with match-guarded clear: on an A→B route change React
 * runs A's cleanup (`unregister`) before B's effect (`register`), and the
 * guard means a stale unregister never wipes the incoming page's href.
 */
type MobileBackValue = {
  backHref: string | null;
  register: (href: string) => void;
  unregister: (href: string) => void;
};

const MobileBackContext = createContext<MobileBackValue | null>(null);

export function MobileBackProvider({ children }: { children: ReactNode }) {
  const [backHref, setBackHref] = useState<string | null>(null);

  const register = useCallback((href: string) => setBackHref(href), []);
  const unregister = useCallback(
    (href: string) => setBackHref((cur) => (cur === href ? null : cur)),
    []
  );

  return (
    <MobileBackContext.Provider value={{ backHref, register, unregister }}>
      {children}
    </MobileBackContext.Provider>
  );
}

/** Current page's back href for the fixed mobile chrome, or null. */
export function useMobileBackHref(): string | null {
  return useContext(MobileBackContext)?.backHref ?? null;
}

/**
 * Register `href` as the active mobile back destination while mounted.
 *
 * Returns whether the chrome has actually *adopted* this href — not merely
 * whether a provider exists. Registration happens in an effect, so the pill is
 * still the JRC mark on the server render and up to hydration; a caller that
 * hides itself on "a provider exists" hides one commit too early and leaves
 * mobile with no back control at all until hydration. Keyed off `backHref`, the
 * handover is one state change, so the header arrow and the pill swap together.
 */
export function useRegisterMobileBack(href: string): boolean {
  const ctx = useContext(MobileBackContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.register(href);
    return () => ctx.unregister(href);
  }, [ctx, href]);
  return ctx != null && ctx.backHref === href;
}
