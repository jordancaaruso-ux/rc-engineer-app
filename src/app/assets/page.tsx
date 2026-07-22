import { ASSETS_HUB_SECTIONS, type NavHubSection } from "@/components/layout/navConfig";
import { AssetsHubClient } from "@/components/assets/AssetsHubClient";
import { UploadSetupSheetBar, type UploadSetupCar } from "@/components/setup/UploadSetupSheetBar";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { hasDatabaseUrl } from "@/lib/env";
import { setupSheetModelIdsSupportingUpload } from "@/lib/setupCalibrations/carSupportsSheetUpload";

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
  /** Cars for the Create / Upload setup sheet flow; null hides the bar (no cars / DB hiccup). */
  let uploadCars: UploadSetupCar[] | null = null;

  if (hasDatabaseUrl()) {
    // requireCurrentUser may redirect — call it outside the try so the redirect
    // isn't swallowed; only the counts are best-effort.
    const user = await requireCurrentUser();
    isAdmin = isAuthAdminEmail(user.email);
    try {
      const [cars, tireSets, carRows] = await Promise.all([
        prisma.car.count({ where: { userId: user.id } }),
        prisma.tireSet.count({ where: { userId: user.id, archivedAt: null } }),
        prisma.car.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            setupSheetModelId: true,
            setupSheetModel: { select: { name: true } },
          },
          take: 25,
        }),
      ]);
      counts = { "/cars": cars, "/tire-sets": tireSets };
      // Every car can CREATE a setup, so the bar lists them all. `supportsUpload` (a green-lit
      // calibration) only decides which door a car opens: the upload/photo/paste sheet, or
      // straight into the create-a-setup flow.
      const uploadableModelIds = await setupSheetModelIdsSupportingUpload(
        carRows.map((c) => c.setupSheetModelId)
      );
      uploadCars = carRows.length
        ? carRows.map((c) => ({
            id: c.id,
            name: c.name,
            chassisName: c.setupSheetModel?.name ?? null,
            supportsUpload: Boolean(
              c.setupSheetModelId && uploadableModelIds.has(c.setupSheetModelId)
            ),
          }))
        : null;
    } catch {
      // Counts are decoration — a DB hiccup shouldn't blank the hub.
      counts = undefined;
    }
  }

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          {/* "Garage" matches the nav label and the /garage redirect — the page
              used to say "Assets", so a new user tapped one word and landed on
              another (2026-07-22). */}
          <h1 className="page-title">Garage</h1>
          <p className="page-subtitle">Your equipment and the shared catalogs.</p>
        </div>
      </header>
      <section className="page-body max-w-2xl flex flex-col gap-3">
        {uploadCars ? <UploadSetupSheetBar cars={uploadCars} /> : null}
        <AssetsHubClient sections={sectionsForUser(isAdmin)} counts={counts} />
      </section>
    </>
  );
}
