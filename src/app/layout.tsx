import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { AuthSessionProvider } from "@/components/providers/AuthSessionProvider";
import { CapacitorDeepLinkBridge } from "@/components/capacitor/CapacitorDeepLinkBridge";
import { TimeZoneCookieSync } from "@/components/layout/TimeZoneCookieSync";
import { RC_TIMEZONE_COOKIE } from "@/lib/rcTimeZoneCookie";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "700"],
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
  themeColor: "#0c0c0e",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en" className={montserrat.variable}>
      <body className="min-h-[100dvh] font-sans font-normal antialiased">
        {/*
         * Single fixed wash at z-index 0 (never negative): duplicate fixed layers on
         * `html` + a div caused a visible seam below the island on iOS Safari.
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
            <AppShell>{children}</AppShell>
          </AuthSessionProvider>
        </div>
      </body>
    </html>
  );
}

