"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PrimaryNavItem } from "@/components/layout/navConfig";
import { usePrimaryNav } from "@/components/layout/PrimaryNavProvider";

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
    if (!prefetch) router.prefetch(href);
  }

  return (
    <Link
      href={href}
      prefetch={prefetch}
      onPointerEnter={warmRoute}
      onTouchStart={warmRoute}
      onClick={() => {
        if (activeId !== item.id) beginNav(item.id);
      }}
      className={className}
      {...a11y}
    >
      {children}
    </Link>
  );
}
