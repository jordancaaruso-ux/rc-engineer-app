import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";

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

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en" className={`${montserrat.variable} dark`}>
      <body className="min-h-screen font-sans font-normal antialiased">
        <div className="app-shell">
          <Sidebar />
          <main className="page">{children}</main>
        </div>
      </body>
    </html>
  );
}

