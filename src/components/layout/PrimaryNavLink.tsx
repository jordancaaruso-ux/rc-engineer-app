"use client";

import type { ReactNode } from "react";
import { useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PrimaryNavItem } from "@/components/layout/navConfig";
import { usePrimaryNav } from "@/components/layout/PrimaryNavProvider";
import { haptic } from "@/lib/haptics";

type PrimaryNavLinkProps = {
  item: PrimaryNavItem;
  href: string;
  className?: string;
  children: ReactNode;
  "aria-current"?: "page" | undefined;
  "aria-label"?: string;
  "data-active"?: "true" | "false";
};

/**
 * If a soft `<Link>` navigation hasn't committed within this window, we assume
 * the App Router client has wedged (a documented, recurring failure in the
 * installed PWA / webview — see `NewRunForm.navigateAway`) and escape with a
 * hard navigation. Every primary destination is prefetched, so a healthy soft
 * nav commits in well under this; the fallback only ever fires on a real wedge.
 */
const SOFT_NAV_HEAL_MS = 700;

export function PrimaryNavLink({
  item,
  href,
  className,
  children,
  ...a11y
}: PrimaryNavLinkProps) {
  const router = useRouter();
  const { activeId, beginNav } = usePrimaryNav();
  const prefetch = item.prefetch !== false;
  const healTimerRef = useRef<number | null>(null);

  function warmRoute() {
    if (!prefetch) router.prefetch(href);
  }

  /**
   * Self-heal a wedged client router: if the pathname still hasn't become the
   * tapped destination after `SOFT_NAV_HEAL_MS`, the soft nav was swallowed —
   * hard-navigate so the driver is never stranded on the log-run page with a
   * dead nav bar. `window.location.pathname` is read live (not the stale
   * `usePathname` closure) so a successful soft nav is correctly a no-op.
   */
  function armSoftNavFallback() {
    if (typeof window === "undefined") return;
    if (healTimerRef.current !== null) window.clearTimeout(healTimerRef.current);
    healTimerRef.current = window.setTimeout(() => {
      healTimerRef.current = null;
      if (window.location.pathname !== href) window.location.assign(href);
    }, SOFT_NAV_HEAL_MS);
  }

  return (
    <Link
      href={href}
      prefetch={prefetch}
      onPointerEnter={warmRoute}
      onTouchStart={warmRoute}
      onClick={() => {
        if (activeId !== item.id) {
          haptic("light");
          beginNav(item.id);
          armSoftNavFallback();
        }
      }}
      className={className}
      {...a11y}
    >
      {children}
    </Link>
  );
}
