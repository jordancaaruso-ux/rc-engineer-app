import type { Metadata, Viewport } from "next";

import { Sora, Space_Grotesk, JetBrains_Mono } from "next/font/google";

import Script from "next/script";

import "./globals.css";

import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/AppShell";

import { auth } from "@/auth";

import { AuthSessionProvider } from "@/components/providers/AuthSessionProvider";

import { CapacitorDeepLinkBridge } from "@/components/capacitor/CapacitorDeepLinkBridge";

import { PwaInstallPrompt } from "@/components/pwa/PwaInstallPrompt";

import { PwaSplashDismiss } from "@/components/pwa/PwaSplashDismiss";

import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";

import { TimeZoneCookieSync } from "@/components/layout/TimeZoneCookieSync";

import { bgPreviewBootstrapScript } from "@/lib/appThemePreview";

import { PWA_SPLASH_MARK_SVG } from "@/lib/pwa/splashMark";

import { RC_TIMEZONE_COOKIE } from "@/lib/rcTimeZoneCookie";



/** UI sans — Sora for all body, nav, titles, and controls (display voice; JetBrains Mono is data). */

const sora = Sora({

  subsets: ["latin"],

  variable: "--font-ui",

  weight: ["400", "500", "600", "700", "800"],

});

/** Display — Space Grotesk; page-title voice only (technical instrument register). */
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display",
});



/** Data — lap times, deltas, tracked labels, table headers. */

const jetBrainsMono = JetBrains_Mono({

  subsets: ["latin"],

  variable: "--font-mono-jb",

  weight: ["400", "500", "700"],

});



export const metadata: Metadata = {

  title: "JRC Race Engineer",

  description:

    "Track runs, setups, and engineering-style guidance for competitive RC touring car drivers.",

  applicationName: "JRC Race Engineer",

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

export const viewport: Viewport = {

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

  themeColor: "#121110",

};



export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const session = await auth();

  return (

    <html

      lang="en"

      className={`${sora.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable}`}

    >

      <body className="min-h-[100dvh] bg-background font-sans font-normal antialiased">

        {/*

         * Single fixed wash at z-index 0 (never negative): duplicate fixed layers on

         * `html` + a div caused a visible seam below the island on iOS Safari.

         * `.app-root` stacks all UI above it so modals/portals still work.

         */}

        <div className="page-bg" aria-hidden="true">

          <div className="page-bg-img" />

          <div className="page-bg-tint" />

          <div className="page-bg-warm" />

          <div className="page-bg-dark" />

          <div className="page-bg-vig" />

        </div>

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

          <Script id="rc-bg-preview-bootstrap" strategy="beforeInteractive">

            {bgPreviewBootstrapScript()}

          </Script>

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
           */}
          <Script id="rc-no-zoom-guard" strategy="beforeInteractive">

            {`(function(){try{var p=function(e){e.preventDefault();};document.addEventListener('gesturestart',p,{passive:false});document.addEventListener('gesturechange',p,{passive:false});}catch(e){}})();`}

          </Script>

          <Script

            id="rc-tz-cookie-bootstrap"

            strategy="beforeInteractive"

          >{`(function(){try{var tz=Intl.DateTimeFormat().resolvedOptions().timeZone;document.cookie='${RC_TIMEZONE_COOKIE}='+encodeURIComponent(tz)+';path=/;max-age=31536000;SameSite=Lax';}catch(e){}})();`}</Script>

          <AuthSessionProvider session={session}>

            <TimeZoneCookieSync />

            <CapacitorDeepLinkBridge />

            <AppShell>{children}</AppShell>

            <PwaInstallPrompt />

            <PwaSplashDismiss />

            <ServiceWorkerRegistrar />

          </AuthSessionProvider>

        </div>

      </body>

    </html>

  );

}


