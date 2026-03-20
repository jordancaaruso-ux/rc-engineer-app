import type { Metadata } from "next";
import "./globals.css";
import { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";

export const metadata: Metadata = {
  title: "RC Engineer",
  description:
    "Track runs, setups, and engineering-style guidance for competitive RC touring car drivers."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <div className="app-shell">
          <Sidebar />
          <main className="page">{children}</main>
        </div>
      </body>
    </html>
  );
}

