import type { Metadata, Viewport } from "next";

import { Sora, Space_Grotesk } from "next/font/google";

import Script from "next/script";

import { Analytics } from "@vercel/analytics/next";

import "./globals.css";

import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { BRAND_DOMAIN, PRODUCT_NAME } from "@/lib/brand/brandNames";

import { auth } from "@/auth";

import { AuthSessionProvider } from "@/components/providers/AuthSessionProvider";

import { CapacitorDeepLinkBridge } from "@/components/capacitor/CapacitorDeepLinkBridge";
import { CapacitorPushBridge } from "@/components/capacitor/CapacitorPushBridge";

import { PwaInstallPrompt } from "@/components/pwa/PwaInstallPrompt";

import { PwaSplashDismiss } from "@/components/pwa/PwaSplashDismiss";

import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";

import { TimeZoneCookieSync } from "@/components/layout/TimeZoneCookieSync";
import { ReturnTrailTracker } from "@/components/layout/ReturnTrailTracker";

import { PWA_SPLASH_MARK_SVG, PWA_SPLASH_WORD_SVG } from "@/lib/pwa/splashMark";
import { PWA_STARTUP_IMAGES } from "@/lib/pwa/startupImages";

import { RC_TIMEZONE_COOKIE } from "@/lib/rcTimeZoneCookie";

import { APP_THEME, PAGE_BG } from "@/lib/theme/appTheme";

import { PERF_ENABLED } from "@/lib/perf/perfConfig";

import { beginPagePerf } from "@/lib/perf/beginPerf";

import { perfSpan } from "@/lib/perfLog";

import { WebVitalsReporterMount } from "@/components/perf/WebVitalsReporterMount";

import { DevMarkupLayer } from "@/components/devtools/DevMarkupLayer";



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



/* The link preview, and the one place it exists for anything that is not /welcome.
 *
 * /welcome is rewritten to the static public/landing/index.html (next.config.mjs), which carries
 * its own hand-written head. Everything else — the bare domain most of all — reached crawlers with
 * no og: tags at all, so a pasted https://www.jrcdynamics.com rendered as a title and a line of
 * grey text with no picture. Racers pass links around in Discord and WhatsApp; that is the form
 * most of them see the product in first.
 *
 * The strings below are deliberately byte-identical to the ones in public/landing/index.html.
 * They drifted apart once already: the card image said "your own setups and lap times" while the
 * og:description said "your own data". If one changes, change all three (here, the landing head,
 * and scripts/og-card/card.html) or the picture stops matching its own caption again.
 */

const OG_TITLE = `${PRODUCT_NAME} — your race engineer, in your pocket`;

const OG_DESCRIPTION =

  "Log a run in a minute. Ask what to change next — the answer is built from your own setups and lap times, not the internet.";

const OG_IMAGE_ALT =

  "Two matching phone screens: a logged race — the 2026 QLD State Titles A-main, its lap graph comparing your run against another driver — and the JRC Trackside Engineer answering a question about that run, beside the line: your race engineer, in your pocket.";

/* Bumped with the picture. Preview images are cached by URL by iMessage, WhatsApp, Slack and
   Discord, so a changed card always ships under a new filename rather than overwriting. */
const OG_IMAGE = "/landing/assets/og-card-v3.jpg";

export const metadata: Metadata = {

  /* Required for the relative OG_IMAGE path above to resolve. Without it Next emits a relative
     og:image, which most crawlers refuse to follow. */
  metadataBase: new URL(`https://www.${BRAND_DOMAIN}`),

  title: PRODUCT_NAME,

  description:

    "Track runs, setups, and engineering-style guidance for competitive RC touring car drivers.",

  applicationName: PRODUCT_NAME,

  openGraph: {

    type: "website",

    siteName: PRODUCT_NAME,

    title: OG_TITLE,

    description: OG_DESCRIPTION,

    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: OG_IMAGE_ALT }],

  },

  twitter: {

    card: "summary_large_image",

    title: OG_TITLE,

    description: OG_DESCRIPTION,

    images: [{ url: OG_IMAGE, alt: OG_IMAGE_ALT }],

  },

  /*
   * iOS home-screen behaviour. `capable` renders full-screen (no Safari chrome).
   *
   * `statusBarStyle` was `black-translucent` until 2026-08-18, which let the charcoal
   * background flow under the status bar — but it also forces the clock, signal and
   * battery to WHITE, and white on ash paper is invisible. `default` keeps the bar out
   * of the page with dark text; `env(safe-area-inset-top)` then reports 0 up there,
   * which is exactly what `.page-header` already handles.
   */
  appleWebApp: {

    capable: true,

    title: "JRC",

    statusBarStyle: "default",

    /*
     * The picture iOS shows from the icon tap until the page has painted (2026-09-04).
     * Without it iOS shows its own blank launch screen — white, or black on a phone in
     * dark mode — so a cold launch read as black → white → the splash. One PNG per
     * screen size, generated from the same geometry the web splash below is laid out
     * to (`scripts/generate-pwa-startup-images.mjs`), so the hand-off is invisible.
     */
    startupImage: [...PWA_STARTUP_IMAGES],

  },

  // Favicon + apple-touch-icon come from the `app/icon.png` + `app/apple-icon.png`
  // file conventions (Next injects the tags). Manifest icons live in `manifest.ts`.

};



/**

 * `viewportFit: "cover"` makes `env(safe-area-inset-*)` return real values on

 * notched phones, which `.page-header` / `.page-body` use to keep content

 * clear of the device's left/right bezel.

 */

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

  // themeColor is set in `viewport` below, from PAGE_BG.

};

/*
 * Static again (2026-08-18). This was `generateViewport` while the theme was a
 * per-device cookie, purely so `themeColor` could follow the choice — the browser's
 * own chrome (Safari's toolbar, the Android status bar) paints from this tag, and a
 * charcoal bar above a paper page is the most visible seam a half-done theme has.
 * There is one look now, so the colour is a constant and the viewport no longer has
 * to be computed per request.
 *
 * `manifest.ts`, `capacitor.config.ts`, `public/offline.html` and the iOS
 * `Splash.imageset` carry the same hex by hand — they paint before or outside the
 * document and cannot read a token. Move them together.
 */
export const viewport: Viewport = { ...baseViewport, themeColor: PAGE_BG };




export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  // Opens the render-scoped perf store before anything else awaits, so the whole page
  // render is attributed. No-op unless PERF_INSTRUMENTATION=1.
  if (PERF_ENABLED) await beginPagePerf();

  const session = await perfSpan("auth", () => auth());

  return (

    <html

      lang="en"

      /* Every paper colour in globals.css hangs off this attribute, and it arrives in
         the first byte of HTML rather than from a script, so there is no flash. */
      data-theme={APP_THEME}

      className={`${sora.variable} ${spaceGrotesk.variable}`}

    >

      <body className="min-h-[100dvh] bg-background font-sans font-normal antialiased">

        {/*
         * Standalone bootstrap — a REAL inline script, first thing in the body, so it runs
         * while the HTML is still being parsed and before anything below it can paint.
         *
         * It was a `next/script` with `strategy="beforeInteractive"` until 2026-09-04.
         * In the App Router that does not emit an inline script: it emits
         * `self.__next_s.push([...])`, a queue the framework drains once its own chunks
         * have loaded. "Before hydration", yes — but seconds after first paint on a phone
         * leaving the pits, and this script is what switches the launch splash on. So a
         * cold launch painted paper and a half-built page first, then the splash arrived
         * late over the top: the "white, then the loading screen" the founder saw.
         *
         * What it does:
         *  · stamps `data-standalone` when launched from the home screen (installed PWA),
         *    which gates the native-feel CSS and shows `#pwa-splash`;
         *  · stamps `data-native` inside the iOS shell (Capacitor injects its bridge at
         *    document start, so `window.Capacitor` is already there) — the shell counts as
         *    standalone regardless of what `display-mode` reports in a WKWebView, and
         *    `data-native` is what SUPPRESSES the web splash there: the shell has its own
         *    native one from the icon tap, and two in a row read as going backwards;
         *  · publishes `--splash-vh`, the viewport height as measured on the very first
         *    frame, which the splash uses instead of a live unit. A `100dvh`/`100svh` box
         *    is re-measured whenever the viewport changes, and a standalone launch does
         *    change it (the web view settles, the status strip gets reserved): the lockup
         *    was centred in the first measurement, then jumped when the second arrived.
         *    It goes in a constructed stylesheet rather than `documentElement.style`: an
         *    adopted sheet is not part of the DOM tree, so React cannot see it, while an
         *    inline style on <html> the server never rendered is one more root attribute
         *    for hydration to diff. (A standalone launch already logs the "attributes
         *    didn't match" warning from `data-standalone` — verified 2026-08-18 that it
         *    predates this; don't read it as this line's doing.) Where the API is missing
         *    the property is simply absent and the CSS falls back to `100svh`.
         */}
        <script
          id="rc-pwa-standalone-bootstrap"
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var n=!!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform());if(n){document.documentElement.setAttribute('data-native','true');}var s=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true||n;if(!s){return;}document.documentElement.setAttribute('data-standalone','true');var h=window.innerHeight;if(h&&typeof CSSStyleSheet==='function'&&'adoptedStyleSheets' in document){var sheet=new CSSStyleSheet();sheet.replaceSync(':root{--splash-vh:'+h+'px}');document.adoptedStyleSheets=document.adoptedStyleSheets.concat([sheet]);}}catch(e){}})();",
          }}
        />

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
         *
         * The yellow field with the ink mark is the app icon, held open: tapping the
         * icon and landing on the splash is one continuous surface rather than a swap
         * from yellow tile to paper screen (founder design, 2026-09-03).
         *
         * On iOS this frame is a continuation, not a start: the startup image
         * (`appleWebApp.startupImage` above) has shown this exact picture since the icon
         * tap, and this element takes over at first paint without moving a pixel. That is
         * why the mark AND the TRACKSIDE word are inline SVG outlines (no client loader, no
         * network round trip, no font to wait for), why nothing here has an entrance
         * animation any more (a lockup that lifted in would first have to vanish), and
         * why the layout is mirrored in `scripts/splash-scene.mjs`. Only the "JRC
         * DYNAMICS" line is live text, and it fades in after the hand-off over dots that
         * do not move. All of it is laid out in globals.css.
         */}
        <div id="pwa-splash" aria-hidden="true">
          <div className="splash-lockup">
            <div
              className="splash-mark"
              dangerouslySetInnerHTML={{ __html: PWA_SPLASH_MARK_SVG }}
            />
            <div className="splash-rule" />
            <div
              className="splash-word"
              dangerouslySetInnerHTML={{ __html: PWA_SPLASH_WORD_SVG }}
            />
          </div>
          <div className="splash-foot">
            <div className="splash-dots">
              <i />
              <i />
              <i />
            </div>
            <div className="splash-name">JRC DYNAMICS</div>
          </div>
        </div>

        <div className="app-root">

          {/*
           * The standalone bootstrap used to sit here as a `next/script`; it is now the
           * real inline <script> at the top of <body> — see the note there. The two
           * below are not paint-critical, so the queued strategy is fine for them.
           *
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
            <ReturnTrailTracker />

            <CapacitorDeepLinkBridge />

            <CapacitorPushBridge />

            <AppShell>{children}</AppShell>

            <PwaInstallPrompt />

            <PwaSplashDismiss />

            <ServiceWorkerRegistrar />

            {PERF_ENABLED ? <WebVitalsReporterMount /> : null}

            {/*
              Anonymous page views (Vercel Web Analytics). Covers every React page — the paid
              door (/join), /login, the legal pages, and the whole signed-in app. It does NOT
              cover the pitch page at /welcome: that is `public/landing/index.html` served
              verbatim by a rewrite, so it never renders this layout and carries its own
              script tag instead. Change one, look at the other.

              Cookieless and aggregate-only by design — no identifier, no IP stored — so it
              answers "how many strangers looked" and can never answer "which stranger".
              Every page view is a billed event, pooled across the whole Vercel account.
            */}
            <Analytics />

            {/* Dev-only markup layer: tap anything to pin a note. Never ships. */}
            {process.env.NODE_ENV !== "production" ? <DevMarkupLayer /> : null}

          </AuthSessionProvider>

        </div>

      </body>

    </html>

  );

}


