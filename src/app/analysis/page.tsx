import { NavHubPage } from "@/components/layout/NavHubPage";
import { ANALYSIS_HUB_LINKS } from "@/components/layout/navConfig";

export default function AnalysisHubPage() {
  return (
    <NavHubPage
      title="Analysis"
      subtitle="Sessions, video, and setup comparison."
      links={ANALYSIS_HUB_LINKS}
    />
  );
}
