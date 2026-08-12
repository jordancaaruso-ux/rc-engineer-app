import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NavHubPage } from "@/components/layout/NavHubPage";
import { MORE_HUB_LINKS } from "@/components/layout/navConfig";

/**
 * The phone's overflow door (nav restructure 2026-08-12).
 *
 * A page, not a bottom sheet. A sheet would make these three sections feel like a
 * menu you dismiss, and they are destinations you go to — Events and Garage each
 * had their own dock cell until this change. A route also means Back works, the
 * dock keeps a lit cell while you are inside one of them
 * (`resolveActiveMobileNavId`), and the three doors are linkable.
 *
 * Desktop never routes here — the top rail shows all seven destinations at once —
 * but the page is not blocked at md+ either: landing on it from a shared link
 * should show the doors, not a dead end.
 */
export const metadata: Metadata = {
  title: "More",
};

export default function MoreHubPage(): ReactNode {
  return (
    <NavHubPage
      title="More"
      subtitle="Events, your garage, and the workbenches."
      links={MORE_HUB_LINKS}
    />
  );
}
