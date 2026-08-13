import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NavHubPage } from "@/components/layout/NavHubPage";
import { TOOLS_HUB_LINKS } from "@/components/layout/navConfig";

/**
 * Tools — setup comparison, the roll-centre lab, and video analysis.
 *
 * Split out of the Analysis hub when desktop Analysis moved to the Sessions
 * workbench (`ANALYSIS_DESKTOP`): these are destinations you open deliberately,
 * not things you glance at while reviewing a day, so they read better as their
 * own sidebar entry than as doors under a chart. The phone still reaches all
 * three from `/analysis` — the mobile dock has no slot to spare.
 */
export const metadata: Metadata = {
  title: "Tools",
};

export default function ToolsHubPage(): ReactNode {
  return (
    <NavHubPage
      title="Tools"
      subtitle="Compare setups, model geometry, and review video."
      links={TOOLS_HUB_LINKS}
      echoesNav
    />
  );
}
