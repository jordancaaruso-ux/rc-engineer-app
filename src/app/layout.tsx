import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { AuthSessionProvider } from "@/components/providers/AuthSessionProvider";
import { CapacitorDeepLinkBridge } from "@/components/capacitor/CapacitorDeepLinkBridge";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "RC Engineer",
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
        <AuthSessionProvider>
          <CapacitorDeepLinkBridge />
          <div className="app-shell">
            <Sidebar />
            <main className="page">{children}</main>
          </div>
        </AuthSessionProvider>
      </body>
    </html>
  );
}

