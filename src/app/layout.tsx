import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { AuthSessionProvider } from "@/components/providers/AuthSessionProvider";
import { CapacitorDeepLinkBridge } from "@/components/capacitor/CapacitorDeepLinkBridge";
import { TimeZoneCookieSync } from "@/components/layout/TimeZoneCookieSync";
import { RC_TIMEZONE_COOKIE } from "@/lib/rcTimeZoneCookie";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
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
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en" className={`${montserrat.variable} dark`}>
      <body className="min-h-screen font-sans font-normal antialiased">
        {/*
         * Fixed page wash sits at z-index 0 (never negative): in WKWebView a
         * negative z-index can paint under `html`’s canvas background, which
         * reads as a flat band from the physical top down to the Dynamic Island.
         * `.app-root` stacks all UI above it so modals/portals still work.
         */}
        <div className="page-bg" aria-hidden="true" />
        <div className="app-root">
          <Script
            id="rc-tz-cookie-bootstrap"
            strategy="beforeInteractive"
          >{`(function(){try{var tz=Intl.DateTimeFormat().resolvedOptions().timeZone;document.cookie='${RC_TIMEZONE_COOKIE}='+encodeURIComponent(tz)+';path=/;max-age=31536000;SameSite=Lax';}catch(e){}})();`}</Script>
          <AuthSessionProvider>
            <TimeZoneCookieSync />
            <CapacitorDeepLinkBridge />
            <div className="app-shell">
              <Sidebar />
              <main className="page">{children}</main>
            </div>
          </AuthSessionProvider>
        </div>
      </body>
    </html>
  );
}

