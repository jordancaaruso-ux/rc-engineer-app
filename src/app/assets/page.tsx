import { NavHubPage } from "@/components/layout/NavHubPage";
import { ASSETS_HUB_SECTIONS } from "@/components/layout/navConfig";

export default function AssetsHubPage() {
  return (
    <NavHubPage
      title="Assets"
      subtitle="Your equipment and the shared catalogs."
      sections={ASSETS_HUB_SECTIONS}
    />
  );
}
