"use client";

import { useEffect, useState } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import {
  PAGE_BG,
  type Theme,
  themeCookieString,
} from "@/lib/theme/themeCookie";

const OPTIONS: { value: Theme; label: string; hint: string }[] = [
  { value: "dark", label: "Dark", hint: "Charcoal — the default, and what the app is drawn for." },
  { value: "light", label: "Light", hint: "Warm paper. Easier in direct sun at an outdoor track." },
];

/**
 * Theme switch.
 *
 * `initial` comes from the server (the settings page reads the same cookie the root
 * layout does) and is NOT read from `document` here, even though the attribute is
 * sitting right there on <html>. Reading the DOM for initial state means the server
 * renders "Dark" selected while the client renders "Light", which is a hydration
 * mismatch — React discards the tree and rebuilds it, and the dev overlay reports an
 * error on every settings visit. Server-rendered state has to arrive as a prop.
 *
 * Applied by hand instead of via a reload: writing the cookie only changes what the
 * NEXT render will do, and `router.refresh()` would re-fetch the whole tree to change
 * one attribute. Setting the attribute directly repaints instantly, because every
 * colour in the app resolves through a custom property (see globals.css) — there is
 * nothing to re-render — and the cookie then carries it across navigations.
 */
export function AppearanceSection({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);

  /*
   * The DOM follows the state rather than being written alongside it. Doing both in
   * the click handler works, but it makes the handler the thing that owns <html>'s
   * attribute, and React's immutability rule rejects assigning to globals outside an
   * effect for exactly that reason. This way the state is the single source of truth
   * and the three side effects are one place.
   *
   * It also runs on mount, re-writing the cookie with the value the server just used.
   * That is a no-op in the normal case and quietly refreshes the year-long expiry for
   * someone who visits settings, which is a small bonus rather than a cost.
   */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.cookie = themeCookieString(theme);

    // The browser's own chrome paints from this tag, not from the page — without
    // it the toolbar stays the old theme's colour until a full reload.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", PAGE_BG[theme]);
  }, [theme]);

  return (
    <CardPanel className="mt-10">
      <h2 className="text-sm font-semibold text-foreground">Appearance</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Applies to this device only, so your phone and your laptop can differ.
      </p>

      <div
        role="radiogroup"
        aria-label="Theme"
        className="mt-4 flex flex-col gap-2 sm:flex-row"
      >
        {OPTIONS.map((opt) => {
          const selected = theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(opt.value)}
              className={`tap-active flex flex-1 items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
                selected
                  ? "border-primary-ink bg-elevate/5"
                  : "border-border hover:bg-secondary"
              }`}
            >
              {/* The swatch is the actual page/card pair for that theme, so the
                  choice is legible before you make it. Fixed literals on purpose —
                  a token would resolve to the CURRENT theme in both swatches. */}
              <span
                aria-hidden
                className="mt-0.5 h-8 w-8 flex-none overflow-hidden rounded-md border border-border"
                style={{ backgroundColor: PAGE_BG[opt.value] }}
              >
                <span
                  className="mt-1.5 ml-1.5 block h-5 w-5 rounded-sm"
                  style={{
                    backgroundColor: opt.value === "dark" ? "#181716" : "#FCFBF8",
                    boxShadow: `inset 0 0 0 1px ${
                      opt.value === "dark" ? "rgb(255 255 255 / .1)" : "rgb(25 24 21 / .1)"
                    }`,
                  }}
                />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="ui-title text-sm">{opt.label}</span>
                  {selected ? (
                    <span className="text-[10px] font-bold uppercase tracking-[.14em] text-primary-ink">
                      On
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                  {opt.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="ui-caption mt-3">
        The app icon and the launch splash stay charcoal — those are painted before the
        page loads and can&rsquo;t follow this.
      </p>
    </CardPanel>
  );
}
