import type { Metadata, Viewport } from "next";

import { Sora, Space_Grotesk } from "next/font/google";

import Script from "next/script";

import { cookies } from "next/headers";

import "./globals.css";

import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";

import { auth } from "@/auth";

import { AuthSessionProvider } from "@/components/providers/AuthSessionProvider";

import { CapacitorDeepLinkBridge } from "@/components/capacitor/CapacitorDeepLinkBridge";
import { CapacitorPushBridge } from "@/components/capacitor/CapacitorPushBridge";

import { PwaInstallPrompt } from "@/components/pwa/PwaInstallPrompt";

import { PwaSplashDismiss } from "@/components/pwa/PwaSplashDismiss";

import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";

import { TimeZoneCookieSync } from "@/components/layout/TimeZoneCookieSync";

import { PWA_SPLASH_MARK_SVG } from "@/lib/pwa/splashMark";

import { RC_TIMEZONE_COOKIE } from "@/lib/rcTimeZoneCookie";

import { PAGE_BG, RC_THEME_COOKIE, parseTheme } from "@/lib/theme/themeCookie";

import { PERF_ENABLED } from "@/lib/perf/perfConfig";

import { beginPagePerf } from "@/lib/perf/beginPerf";

import { perfSpan } from "@/lib/perfLog";

import { WebVitalsReporterMount } from "@/components/perf/WebVitalsReporterMount";



/** The one UI face — Sora for everything the user reads, figures included.
    Numbers are Sora + `tabular-nums` (see the `.fig-*` ramp in globals.css), not a second
    typeface: its digits are proportional by default and only snap to a uniform 676/1000em
    under `tnum`, which the served woff2 subset does carry (measured 2026-08-14). */

const sora = Sora({

  subsets: ["latin"],

  variable: "--font-ui",

  // No font-extrabold / 800 in the app — omit to shrink the font payload.
  weight: ["400", "500", "600", "700"],

});

/** Display — Space Grotesk; page-title voice only (technical instrument register). */
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  // Titles use weight 700 only (`.page-title`, `.page-title-condensed`).
  weight: ["700"],
  variable: "--font-display",
});



/* JetBrains Mono was deleted 2026-08-14 (one-voice pass). It had drifted onto ~460 call
   sites doing three unrelated jobs — aligning figures, marking machine strings, and an
   uppercase-tracked label voice the north star had already retired. Figures are now Sora
   on the `.fig-*` ramp; genuine machine text uses the platform mono stack via
   `.type-machine`, which loads nothing. Do not reintroduce a webfont for data. */



export const metadata: Metadata = {

  title: PRODUCT_NAME,

  description:

    "Track runs, setups, and engineering-style guidance for competitive RC touring car drivers.",

  applicationName: PRODUCT_NAME,

  /*
   * iOS home-screen behaviour. `capable` renders full-screen (no Safari chrome);
   * `black-translucent` lets the charcoal background flow under the status bar so
   * an installed launch reads as a native app, not a web view.
   */
  appleWebApp: {

    capable: true,

    title: "JRC",

    statusBarStyle: "black-translucent",

  },

  // Favicon + apple-touch-icon come from the `app/icon.png` + `app/apple-icon.png`
  // file conventions (Next injects the tags). Manifest icons live in `manifest.ts`.

};



/**

 * `viewportFit: "cover"` makes `env(safe-area-inset-*)` return real values on

 * notched phones, which `.page-header` / `.page-body` use to keep content

 * clear of the device's left/right bezel.

 */

/*
 * `generateViewport` rather than a static `viewport`, purely so `themeColor` can
 * follow the chosen theme — the browser's own chrome (Safari's toolbar, the
 * Android status bar) paints from this tag, and a charcoal bar above a paper page
 * is the most visible seam a half-done theme has.
 *
 * The root layout is already per-request (it awaits `auth()`), so reading a cookie
 * here costs nothing extra.
 *
 * NOT covered by this: `manifest.ts`, `capacitor.config.ts`, `public/offline.html`
 * and the iOS `Splash.imageset`. Those are build-time assets that paint before the
 * document exists, so an installed launch shows the charcoal splash whichever theme
 * is set. That is a deliberate limit of a per-device cookie, not an oversight —
 * making it follow would mean a themed manifest per user, and the splash is on
 * screen for a few hundred milliseconds.
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = parseTheme((await cookies()).get(RC_THEME_COOKIE)?.value);
  return { ...baseViewport, themeColor: PAGE_BG[theme] };
}

const baseViewport: Viewport = {

  width: "device-width",

  initialScale: 1,

  // Lock zoom entirely (founder decision 2026-07-14): tapping a dropdown / input

  // must never trigger iOS focus-zoom, and no pinch gesture should zoom the app.

  // `maximumScale: 1` stops Safari's input focus-zoom; `userScalable: false` locks

  // the WKWebView / installed PWA fully. Safari ignores `userScalable`, so pinch is

  // additionally blocked via `touch-action` + a `gesturestart` guard (see globals.css

  // and the inline no-zoom script below).

  minimumScale: 1,

  maximumScale: 1,

  userScalable: false,

  viewportFit: "cover",

  // themeColor is set per-request in `generateViewport` above, from PAGE_BG.

};



export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  // Opens the render-scoped perf store before anything else awaits, so the whole page
  // render is attributed. No-op unless PERF_INSTRUMENTATION=1.
  if (PERF_ENABLED) await beginPagePerf();

  const session = await perfSpan("auth", () => auth());

  /*
   * Stamped on the server, so the very first byte of HTML already carries the
   * theme and there is no flash. A client-side read (localStorage in an effect,
   * or a bootstrap <script>) would repaint after hydration on every navigation —
   * the same trap the PWA standalone bootstrap avoids by running
   * `beforeInteractive`, except a cookie lets us skip the script entirely.
   */
  const theme = parseTheme((await cookies()).get(RC_THEME_COOKIE)?.value);

  return (

    <html

      lang="en"

      data-theme={theme}

      className={`${sora.variable} ${spaceGrotesk.variable}`}

    >

      <body className="min-h-[100dvh] bg-background font-sans font-normal antialiased">

        {/*

         * Single fixed background at z-index 0 (never negative): duplicate fixed layers

         * on `html` + a div caused a visible seam below the island on iOS Safari.

         * `.app-root` stacks all UI above it so modals/portals still work. One flat

         * ash-warm fill — colour and comment live in globals.css.

         */}

        <div className="page-bg" aria-hidden="true" />

        {/*
         * PWA launch splash — CSS-gated to installed (standalone) launches via
         * `html[data-standalone]` (set pre-paint by the bootstrap script below), so it
         * covers the cold-launch gap; `PwaSplashDismiss` fades it once the app is ready.
         * Plain <img> (not next/image) so it paints without a client loader.
         */}
        <div
          id="pwa-splash"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: PWA_SPLASH_MARK_SVG }}
        />

        <div className="app-root">

          {/*
           * Mark the document when launched from the home screen (installed PWA) so
           * native-feel CSS (no rubber-band, no tap-callout) applies only there and the
           * in-browser experience is untouched. Runs pre-hydration to avoid a flash.
           */}
          <Script id="rc-pwa-standalone-bootstrap" strategy="beforeInteractive">

            {`(function(){try{var s=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true;if(s){document.documentElement.setAttribute('data-standalone','true');}}catch(e){}})();`}

          </Script>

          {/*
           * No-zoom guard for mobile Safari, which ignores `user-scalable=no`.
           * `gesturestart`/`gesturechange` fire only on pinch; preventing them
           * blocks pinch-zoom without touching normal scroll/tap. Double-tap zoom
           * is handled by `touch-action: manipulation` (globals.css) and input
           * focus-zoom by `maximum-scale=1` (viewport). Founder decision 2026-07-14.
           *
           * SKIPPED ON DESKTOP (2026-08-07). These are WebKit gesture events, and on macOS Safari
           * a TRACKPAD pinch fires them too — so the guard was silently disabling pinch-to-zoom for
           * desktop Safari users, which is an accessibility problem nobody asked for and the phone
           * decision never intended. The bar is `(min-width: 1024px) and (pointer: fine)`: a phone
           * is neither, and a touch tablet fails the pointer test, so the trackside behaviour is
           * unchanged. Desktop keyboard zoom (ctrl +/-) and ctrl+scroll were never affected —
           * those are wheel/key events, and desktop browsers ignore the viewport meta entirely.
           */}
          <Script id="rc-no-zoom-guard" strategy="beforeInteractive">

            {`(function(){try{if(window.matchMedia&&window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches){return;}var p=function(e){e.preventDefault();};document.addEventListener('gesturestart',p,{passive:false});document.addEventListener('gesturechange',p,{passive:false});}catch(e){}})();`}

          </Script>

          <Script

            id="rc-tz-cookie-bootstrap"

            strategy="beforeInteractive"

          >{`(function(){try{var tz=Intl.DateTimeFormat().resolvedOptions().timeZone;document.cookie='${RC_TIMEZONE_COOKIE}='+encodeURIComponent(tz)+';path=/;max-age=31536000;SameSite=Lax';}catch(e){}})();`}</Script>

          <AuthSessionProvider session={session}>

            <TimeZoneCookieSync />

            <CapacitorDeepLinkBridge />

            <CapacitorPushBridge />

            <AppShell>{children}</AppShell>

            <PwaInstallPrompt />

            <PwaSplashDismiss />

            <ServiceWorkerRegistrar />

            {PERF_ENABLED ? <WebVitalsReporterMount /> : null}

          </AuthSessionProvider>

        </div>

      </body>

    </html>

  );

}


