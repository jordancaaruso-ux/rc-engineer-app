import { ASSETS_HUB_SECTIONS, type NavHubSection } from "@/components/layout/navConfig";
import { AssetsHubClient } from "@/components/assets/AssetsHubClient";
import { UploadSetupSheetBar, type UploadSetupCar } from "@/components/setup/UploadSetupSheetBar";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { hasDatabaseUrl } from "@/lib/env";
import { setupSheetModelIdsSupportingUpload } from "@/lib/setupCalibrations/carSupportsSheetUpload";
import { CarSetupsCard, type CarLibrarySetup } from "@/components/setup/CarSetupsCard";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";

/** Live "Mine" totals change on asset mutations — keep the hub fresh. */
export const revalidate = 30;

/**
 * The full setup library, one card per car. The dashboard's Setups card only names the baseline
 * each car is running, so this is where every saved setup lives — Garage owns the list.
 */
type GarageCarSetups = { carId: string; carName: string; setups: CarLibrarySetup[] };

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
  let carSetups: GarageCarSetups[] = [];

  if (hasDatabaseUrl()) {
    // requireCurrentUser may redirect — call it outside the try so the redirect
    // isn't swallowed; only the counts are best-effort.
    const user = await requireCurrentUser();
    const displayTimeZone = await getExplicitTimeZoneForRunFormatting();
    isAdmin = isAuthAdminEmail(user.email);
    try {
      const [cars, tireSets, carRows] = await Promise.all([
        prisma.car.count({ where: { userId: user.id } }),
        prisma.run
          .findMany({
            where: { userId: user.id, tireTypeId: { not: null } },
            distinct: ["tireTypeId"],
            select: { tireTypeId: true },
          })
          .then((rows) => rows.length),
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
      counts = { "/cars": cars, "/tires": tireSets };
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

      const librarySetups = carRows.length
        ? await prisma.setupSnapshot.findMany({
            where: { userId: user.id, carId: { in: carRows.map((c) => c.id) }, isLibrary: true },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              name: true,
              createdAt: true,
              carId: true,
              _count: { select: { runs: true, derivedSnapshots: true } },
            },
          })
        : [];
      carSetups = carRows.map((c) => ({
        carId: c.id,
        carName: c.name,
        setups: librarySetups
          .filter((s) => s.carId === c.id)
          .map((s) => ({
            id: s.id,
            name: s.name,
            createdAtLabel: formatRunCreatedAtDateTime(s.createdAt, displayTimeZone),
            usedInRuns: s._count.runs + s._count.derivedSnapshots,
          })),
      }));
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
        {carSetups.map((c) => (
          <CarSetupsCard key={c.carId} carId={c.carId} label={c.carName} setups={c.setups} />
        ))}
      </section>
    </>
  );
}
