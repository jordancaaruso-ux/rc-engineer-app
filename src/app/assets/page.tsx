import { ASSETS_HUB_SECTIONS } from "@/components/layout/navConfig";
import { AssetsHubClient } from "@/components/assets/AssetsHubClient";

export default function AssetsHubPage() {
  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Assets</h1>
          <p className="page-subtitle">Your equipment and the shared catalogs.</p>
        </div>
      </header>
      <section className="page-body max-w-2xl flex flex-col gap-3">
        <AssetsHubClient sections={ASSETS_HUB_SECTIONS} />
      </section>
    </>
  );
}
