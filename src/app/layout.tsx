import type { Metadata, Viewport } from "next";
import { Inter, Montserrat, JetBrains_Mono } from "next/font/google";
import "typeface-hk-grotesk";
import Script from "next/script";
import "./globals.css";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { AuthSessionProvider } from "@/components/providers/AuthSessionProvider";
import { CapacitorDeepLinkBridge } from "@/components/capacitor/CapacitorDeepLinkBridge";
import { TimeZoneCookieSync } from "@/components/layout/TimeZoneCookieSync";
import { bgPreviewBootstrapScript } from "@/lib/appThemePreview";
import { RC_TIMEZONE_COOKIE } from "@/lib/rcTimeZoneCookie";

/** Body, inputs, tables, and helper copy — legible at small sizes. */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600"],
});

/** Display / brand — page titles, nav, session headers. */
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

/** Technical v2 — UI text (HK Grotesk Wide). Self-hosted WOFF2 + HK Grotesk npm fallback; see public/fonts/hk-grotesk-wide/README.md. */

/** Data — lap times, deltas, tracked labels. */
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
  themeColor: "#17130f",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${montserrat.variable} ${jetBrainsMono.variable}`}
    >
      <body className="min-h-[100dvh] font-sans font-normal antialiased">
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

