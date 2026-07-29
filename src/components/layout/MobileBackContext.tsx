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

/**
 * Lets a page's `PageBackLink` publish its back destination to the fixed
 * mobile corner chrome, so the top-left JRC pill can morph into a back button
 * when a page has one (instead of the pill covering the header's back arrow).
 *
 * Last-registered-wins with match-guarded clear: on an A→B route change React
 * runs A's cleanup (`unregister`) before B's effect (`register`), and the
 * guard means a stale unregister never wipes the incoming page's href.
 */
type BackAction = () => void;

type MobileBackValue = {
  backHref: string | null;
  register: (href: string, action: BackAction | null) => void;
  unregister: (href: string) => void;
  /** Read at click time — see the ref note on the provider. */
  getBackAction: () => BackAction | null;
};

const MobileBackContext = createContext<MobileBackValue | null>(null);

export function MobileBackProvider({ children }: { children: ReactNode }) {
  const [backHref, setBackHref] = useState<string | null>(null);
  /**
   * The optional back *handler* lives in a ref, not in state, and the href stays a
   * plain string. That's load-bearing: on every route change React runs the outgoing
   * page's `unregister` and the incoming page's `register` in one batch, so the state
   * lands back on the same value it started from. With a primitive, `Object.is` says
   * "unchanged" and React skips the re-render; with an object it's a fresh reference
   * every time, the provider re-renders, `ctx` changes identity, the effect re-runs —
   * and that's an infinite loop ("Maximum update depth exceeded").
   */
  const actionRef = useRef<BackAction | null>(null);

  const register = useCallback((href: string, action: BackAction | null) => {
    actionRef.current = action;
    setBackHref(href);
  }, []);
  const unregister = useCallback(
    (href: string) => setBackHref((cur) => (cur === href ? null : cur)),
    []
  );
  const getBackAction = useCallback(() => actionRef.current, []);

  const value = useMemo(
    () => ({ backHref, register, unregister, getBackAction }),
    [backHref, register, unregister, getBackAction]
  );

  return <MobileBackContext.Provider value={value}>{children}</MobileBackContext.Provider>;
}

/** Current page's back href for the fixed mobile chrome, or null. */
export function useMobileBackHref(): string | null {
  return useContext(MobileBackContext)?.backHref ?? null;
}

/**
 * Getter for the handler the pill should run instead of navigating (e.g. history
 * back). A getter rather than a value so the pill never re-renders just because a
 * page swapped its back behaviour — it only matters at the moment of the tap.
 */
export function useMobileBackAction(): () => BackAction | null {
  const ctx = useContext(MobileBackContext);
  const noAction = useCallback(() => null, []);
  return ctx?.getBackAction ?? noAction;
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
export function useRegisterMobileBack(
  href: string,
  /** Optional handler for the pill — e.g. history back instead of a push. */
  action?: BackAction | null
): boolean {
  const ctx = useContext(MobileBackContext);
  // Held in a ref so a fresh closure each render doesn't re-run the effect and
  // clobber the registration; only its presence is part of the effect's identity.
  const actionRef = useRef<BackAction | null>(null);
  const hasAction = action != null;
  useEffect(() => {
    actionRef.current = action ?? null;
  }, [action]);
  const stableAction = useCallback(() => actionRef.current?.(), []);
  useEffect(() => {
    if (!ctx) return;
    ctx.register(href, hasAction ? stableAction : null);
    return () => ctx.unregister(href);
  }, [ctx, href, hasAction, stableAction]);
  return ctx != null && ctx.backHref === href;
}
