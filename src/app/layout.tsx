import type { Metadata, Viewport } from "next";

import { Inter, JetBrains_Mono } from "next/font/google";

import Script from "next/script";

import "./globals.css";

import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/AppShell";

import { AuthSessionProvider } from "@/components/providers/AuthSessionProvider";

import { CapacitorDeepLinkBridge } from "@/components/capacitor/CapacitorDeepLinkBridge";

import { TimeZoneCookieSync } from "@/components/layout/TimeZoneCookieSync";

import { bgPreviewBootstrapScript } from "@/lib/appThemePreview";

import { RC_TIMEZONE_COOKIE } from "@/lib/rcTimeZoneCookie";



/** UI sans — Inter for all body, nav, titles, and controls. */

const inter = Inter({

  subsets: ["latin"],

  variable: "--font-ui",

  weight: ["400", "500", "600", "700", "800"],

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

    "Track runs, setups, and engineering-style guidance for competitive RC touring car drivers."

};



/**

 * `viewportFit: "cover"` makes `env(safe-area-inset-*)` return real values on

 * notched phones, which `.page-header` / `.page-body` use to keep content

 * clear of the device's left/right bezel.

 */

export const viewport: Viewport = {

  width: "device-width",

  initialScale: 1,

  viewportFit: "cover",

  themeColor: "#121110",

};



export default function RootLayout({ children }: { children: ReactNode }): ReactNode {

  return (

    <html

      lang="en"

      className={`${inter.variable} ${jetBrainsMono.variable}`}

    >

      <body className="min-h-[100dvh] bg-background font-sans font-normal antialiased">

        {/*

         * Single fixed wash at z-index 0 (never negative): duplicate fixed layers on

         * `html` + a div caused a visible seam below the island on iOS Safari.

         * `.app-root` stacks all UI above it so modals/portals still work.

         */}

        <div className="page-bg" aria-hidden="true" />

        <div className="app-root">

          <Script id="rc-bg-preview-bootstrap" strategy="beforeInteractive">

            {bgPreviewBootstrapScript()}

          </Script>

          <Script

            id="rc-tz-cookie-bootstrap"

            strategy="beforeInteractive"

          >{`(function(){try{var tz=Intl.DateTimeFormat().resolvedOptions().timeZone;document.cookie='${RC_TIMEZONE_COOKIE}='+encodeURIComponent(tz)+';path=/;max-age=31536000;SameSite=Lax';}catch(e){}})();`}</Script>

          <AuthSessionProvider>

            <TimeZoneCookieSync />

            <CapacitorDeepLinkBridge />

            <AppShell>{children}</AppShell>

          </AuthSessionProvider>

        </div>

      </body>

    </html>

  );

}


