"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { cn } from "@/lib/utils";

/**
 * The hand-off bar of the first-run walk — one box, both places (founder 2026-08-26).
 *
 * The walk has two moments where the driver has finished on one screen and the next
 * thing is somewhere else, and both were failing in the same way:
 *
 *   · **Garage, after the first car.** A grey explanatory line above a `self-start`
 *     chip — two elements saying one thing, and the chip did not read as the way on.
 *   · **Settings, mid-walk.** Nothing at all. The bottom dock's Dashboard tab is
 *     furniture: it reads as "go somewhere else", not "the rest of what you started
 *     is waiting". Every walk that came here for the timing details had to work that
 *     out on its own.
 *
 * So they are now the same component and the same material: full-width yellow
 * (standard `primary` face — no bespoke yellow, no rim), destination bold with the
 * reason under it at 75%, arrow on the far side. `direction` is the only difference —
 * the Garage bar goes forward, the Settings bar goes back.
 *
 * It is on screen from the moment the page loads, not after a save (founder call on
 * the Settings one): the complaint was about being stranded on the page, which is true
 * before anyone types anything.
 *
 * ── Why a portal, and why not `position: sticky` ────────────────────────────────────
 *
 * It has to stay put through the scroll, and neither obvious technique works in place:
 *
 *   · `position: sticky` cannot: `.app-shell` is `overflow-x: hidden`, and the spec
 *     computes `overflow-y` from `visible` to `auto` for that — so the shell is a
 *     scrollport that never actually scrolls (the document does). A sticky child pins
 *     to a box that stays still and simply scrolls away with the page. `TopRail`,
 *     `SetupEditorSaveBar` and `SessionsBrowser` all carry the same finding.
 *   · `position: fixed` inside that same shell is clipped on iOS, which is why
 *     `BottomNav`, `MobileBrandMark` and `AccountMenu` are all mounted OUTSIDE
 *     `.app-shell` in `AppShell`.
 *
 * So the bar portals to `document.body` — out of the shell without needing a mount
 * point in `AppShell` that would then have to re-derive who is mid-walk client-side.
 * Each page keeps ownership of that question; only the pixels move.
 *
 * Being out of the document means nothing reserves its height, so it also stamps
 * `body.has-setup-handoff`, which pushes `.page-body` down by exactly the bar's
 * reach (globals.css). A per-page spacer element cannot do that job on the Garage
 * page: the bar appears from the middle of a list, and the room has to be made at
 * the top of the page.
 *
 * Vertical position clears the chrome that is already fixed up there — the 34px corner
 * pills at `--top-chrome-y` on the phone (where `MobileTitleCondenser` also fades the
 * compact title into that band, so the bar must sit BELOW it, not in it), and the 64px
 * `.top-rail` on desktop. All of it is `.setup-handoff-bar` in `globals.css`, where
 * those numbers already live.
 */
export function SetUpHandoffBar({
  href,
  title,
  detail,
  direction,
}: {
  href: string;
  title: string;
  /** The reason, one line — it rides inside the bar, never as a grey line above it. */
  detail: string;
  /** `forward` for the Garage hand-off, `back` for the Settings one. */
  direction: "back" | "forward";
}) {
  const [mounted, setMounted] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  /**
   * The bar MEASURES the page it is floating over instead of guessing at it, and
   * publishes three numbers `globals.css` spends. Everything guessable here was
   * wrong on one of the two call sites:
   *
   *   · **Width and side.** Settings is a centred `max-w-2xl` column; the Garage is
   *     a left-aligned one with no max-width and, on desktop, no page header at all
   *     (`.page-header.is-echo` collapses — the rail's tab names the page). A pair
   *     of media queries clamped to Settings' column left the Garage bar centred
   *     over empty space beside its content.
   *   · **Height.** The Garage's reason wraps to two lines on a 390px phone where
   *     Settings' does not, so a hard-coded reserve sized for one puts the first
   *     card under the other.
   *   · **The reserve itself.** It is not the bar's height: the bar's top lands
   *     above where `.page-body` starts, by a different amount per page, so what
   *     matters is how far the bar reaches PAST that — which is the subtraction
   *     below and cannot be written in CSS.
   *
   * Padding changes `.page-body`'s content, never its box top, so re-applying is
   * stable rather than a feedback loop. Measured at rest (`+ scrollY`) because the
   * reserve only has to hold at the top of the page — once scrolled, the bar floats
   * over content by design.
   */
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const body = document.body;
    body.classList.add("has-setup-handoff");

    const apply = () => {
      const bar = el.getBoundingClientRect();
      const pageBody = document.querySelector(".page-body");
      if (!pageBody) return;

      /*
       * The COLUMN, which is not the same box as `.page-body`. The Garage's body is
       * full-bleed with a `max-w-2xl` wrapper inside it, so measuring the section
       * gave a 1344px yellow bar over 670px of cards — the banner this was meant to
       * avoid. The first element child is that wrapper on the Garage and the plain
       * `space-y-4` stack on Settings, and on both it already sits inside the
       * gutters, so there is no padding arithmetic to get wrong.
       */
      const column = pageBody.firstElementChild ?? pageBody;
      const col = column.getBoundingClientRect();
      // Left+right rather than a width, so the bar tracks the column through a
      // resize without anyone having to recompute it.
      body.style.setProperty("--setup-handoff-left", `${Math.round(col.left)}px`);
      body.style.setProperty(
        "--setup-handoff-right",
        `${Math.round(window.innerWidth - col.right)}px`
      );

      /*
       * Vertical stays measured against `.page-body` itself, NOT the column: the
       * padding we are about to set moves the column down, which would feed back
       * into its own input. A section's box top does not move when its padding does.
       */
      const pb = pageBody.getBoundingClientRect();
      const reach = bar.top + bar.height + 12 - (pb.top + window.scrollY);
      body.style.setProperty("--setup-handoff-pad", `${Math.max(8, Math.round(reach))}px`);
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    ro.observe(document.documentElement);
    const pageBody = document.querySelector(".page-body");
    if (pageBody) ro.observe(pageBody);

    return () => {
      ro.disconnect();
      body.classList.remove("has-setup-handoff");
      for (const k of ["--setup-handoff-left", "--setup-handoff-right", "--setup-handoff-pad"]) {
        body.style.removeProperty(k);
      }
    };
  }, [mounted]);

  if (!mounted) return null;

  const Arrow = direction === "back" ? ArrowLeft : ArrowRight;

  return createPortal(
    <div ref={barRef} className="setup-handoff-bar">
      <Link
        href={href}
        className={cn(
          buttonLinkClassName("primary"),
          "w-full gap-2.5 rounded-xl px-4 py-3 text-left text-sm shadow-[0_10px_28px_-16px_rgb(0_0_0/0.55)]"
        )}
      >
        {direction === "back" ? (
          <Arrow aria-hidden className="size-4 shrink-0" strokeWidth={2.6} />
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block font-bold leading-snug">{title}</span>
          <span className="block text-[12px] font-medium leading-snug opacity-75">{detail}</span>
        </span>
        {direction === "forward" ? (
          <Arrow aria-hidden className="size-4 shrink-0" strokeWidth={2.6} />
        ) : null}
      </Link>
    </div>,
    document.body
  );
}
