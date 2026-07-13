"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { GearSix, ShieldCheck, SignOut } from "@phosphor-icons/react";
import { avatarSrc } from "@/lib/profileImage/avatarSrc";

/**
 * Account avatar + menu — the home for Settings after it left the mobile dock
 * (2026-07-06). A floating button pinned top-right on mobile only (desktop
 * keeps Settings in the sidebar). Tapping it opens account details plus the
 * low-frequency destinations that no longer earn a dock slot.
 *
 * Positioned above the page header on centered-title screens (top-right is free
 * there); the dashboard's date chip is nudged clear in globals.css.
 */
function initials(name?: string | null, email?: string | null): string {
  const src = (name && name.trim()) || (email && email.trim()) || "";
  if (!src) return "?";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && !src.includes("@")) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return src.split("@")[0].slice(0, 1).toUpperCase();
}

export function AccountMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const name = session?.user?.name ?? null;
  const email = session?.user?.email ?? null;
  const image = avatarSrc(session?.user?.image ?? null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const face = image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image} alt="" className="h-full w-full object-cover" />
  ) : (
    <span aria-hidden>{initials(name, email)}</span>
  );

  return (
    <div
      ref={wrapRef}
      className="fixed right-4 z-40 md:hidden"
      style={{ top: "var(--top-chrome-y)" }}
    >
      <button
        type="button"
        aria-label="Account and settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="tap-active grid h-[34px] w-[34px] place-items-center overflow-hidden rounded-full border border-white/[0.15] bg-card/70 text-[13px] font-bold text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.45)] backdrop-blur-[20px] backdrop-saturate-[1.4] transition-transform duration-150 active:scale-95"
      >
        {face}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-[calc(100%+0.5rem)] w-56 overflow-hidden rounded-2xl border border-white/[0.12] bg-card/[0.85] p-1.5 shadow-[0_24px_50px_-18px_rgba(0,0,0,0.8)] backdrop-blur-[34px] backdrop-saturate-[1.4]"
        >
          <div className="mb-1.5 flex items-center gap-2.5 border-b border-border px-2.5 pb-3 pt-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-white/[0.15] bg-secondary text-[13px] font-bold text-foreground">
              {face}
            </span>
            <span className="min-w-0">
              {name ? (
                <span className="block truncate text-[13px] font-semibold text-foreground">
                  {name}
                </span>
              ) : null}
              <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                {email ?? "Signed in"}
              </span>
            </span>
          </div>

          <MenuLink
            href="/settings"
            icon={<GearSix size={17} aria-hidden />}
            onNavigate={() => setOpen(false)}
          >
            Settings
          </MenuLink>
          <MenuLink
            href="/privacy"
            icon={<ShieldCheck size={17} aria-hidden />}
            onNavigate={() => setOpen(false)}
          >
            Privacy
          </MenuLink>

          <div className="mx-1 my-1.5 h-px bg-border" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut({ callbackUrl: "/login" });
            }}
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-[13.5px] text-destructive transition-colors hover:bg-muted"
          >
            <SignOut size={17} aria-hidden />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onNavigate,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-[13.5px] text-foreground transition-colors hover:bg-muted"
    >
      <span className="text-muted-foreground" aria-hidden>
        {icon}
      </span>
      {children}
    </Link>
  );
}
