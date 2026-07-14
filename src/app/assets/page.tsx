import { ASSETS_HUB_SECTIONS, type NavHubSection } from "@/components/layout/navConfig";
import { AssetsHubClient } from "@/components/assets/AssetsHubClient";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { hasDatabaseUrl } from "@/lib/env";

/** Live "Mine" totals change on asset mutations — keep the hub fresh. */
export const revalidate = 30;

/** Calibrations are an admin-only surface — drop the link for everyone else. */
function sectionsForUser(isAdmin: boolean): NavHubSection[] {
  if (isAdmin) return ASSETS_HUB_SECTIONS;
  return ASSETS_HUB_SECTIONS.map((section) => ({
    ...section,
    links: section.links.filter((link) => link.href !== "/setup-calibrations"),
  }));
}

export default async function AssetsHubPage() {
  let counts: Record<string, number> | undefined;
  let isAdmin = false;

  if (hasDatabaseUrl()) {
    // requireCurrentUser may redirect — call it outside the try so the redirect
    // isn't swallowed; only the counts are best-effort.
    const user = await requireCurrentUser();
    isAdmin = isAuthAdminEmail(user.email);
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
        <AssetsHubClient sections={sectionsForUser(isAdmin)} counts={counts} />
      </section>
    </>
  );
}
