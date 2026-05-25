import { NavHubPage } from "@/components/layout/NavHubPage";
import { GARAGE_HUB_LINKS } from "@/components/layout/navConfig";

export default function GarageHubPage() {
  return (
    <NavHubPage
      title="Garage"
      subtitle="Cars, tracks, events, and setup tools."
      links={GARAGE_HUB_LINKS}
    />
  );
}
