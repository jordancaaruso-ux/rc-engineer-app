import { ASSETS_HUB_SECTIONS } from "@/components/layout/navConfig";
import { AssetsHubClient } from "@/components/assets/AssetsHubClient";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

/** Live "Mine" totals change on asset mutations — keep the hub fresh. */
export const revalidate = 30;

export default async function AssetsHubPage() {
  let counts: Record<string, number> | undefined;

  if (hasDatabaseUrl()) {
    // requireCurrentUser may redirect — call it outside the try so the redirect
    // isn't swallowed; only the counts are best-effort.
    const user = await requireCurrentUser();
    try {
      const [cars, tireSets, batteries] = await Promise.all([
        prisma.car.count({ where: { userId: user.id } }),
        prisma.tireSet.count({ where: { userId: user.id, archivedAt: null } }),
        prisma.battery.count({ where: { userId: user.id, archivedAt: null } }),
      ]);
      counts = { "/cars": cars, "/tire-sets": tireSets, "/batteries": batteries };
    } catch {
      // Counts are decoration — a DB hiccup shouldn't blank the hub.
      counts = undefined;
    }
  }

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Assets</h1>
          <p className="page-subtitle">Your equipment and the shared catalogs.</p>
        </div>
      </header>
      <section className="page-body max-w-2xl flex flex-col gap-3">
        <AssetsHubClient sections={ASSETS_HUB_SECTIONS} counts={counts} />
      </section>
    </>
  );
}
