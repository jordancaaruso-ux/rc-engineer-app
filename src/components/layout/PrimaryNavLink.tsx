"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PrimaryNavItem } from "@/components/layout/navConfig";
import { usePrimaryNav } from "@/components/layout/PrimaryNavProvider";
import { haptic } from "@/lib/haptics";
import { warmNewRunForm } from "@/lib/runs/warmNewRunForm";

type PrimaryNavLinkProps = {
  item: PrimaryNavItem;
  href: string;
  className?: string;
  children: ReactNode;
  "aria-current"?: "page" | undefined;
  "aria-label"?: string;
  "data-active"?: "true" | "false";
};

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

  function warmRoute() {
    if (!prefetch) {
      router.prefetch(href);
      // Add-run uses prefetch:false; warm the form chunk on intent only.
      if (item.id === "add-run") warmNewRunForm();
    }
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
          // Arms the provider-owned wedge self-heal for `href`.
          beginNav(item.id, href);
        }
      }}
      className={className}
      {...a11y}
    >
      {children}
    </Link>
  );
}
