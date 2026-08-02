import type { ChassisPlatformId } from "@/lib/cars/carClasses";
import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";

/**
 * Chassis slug → physical platform. The single source of truth for the car-swap tire rule
 * (see `carClasses.ts` for why the platform is inferred rather than picked by the driver).
 *
 * Deliberately a **pure** module — no `server-only`, no Prisma — so `carSwap` and its tests can
 * import it. The chassis catalog itself (`setupSheetModels/authorizedCatalog.ts`) is server-only
 * because it carries schema builders, so it can't own this.
 *
 * Keep in step with `AUTHORIZED_CHASSIS_CATALOG`. A slug missing here resolves to `null`, which
 * `isSamePlatform` treats as "same platform" — so drift degrades safely (tires keep carrying)
 * rather than silently re-deriving a driver's tires mid-day.
 */
export const CHASSIS_PLATFORM_BY_SLUG: Readonly<Record<string, ChassisPlatformId>> = {
  awesomatix_a800rr: "touring",
  mugen_mtc3: "touring",
  mugen_mtc2: "touring",
  xray_t4: "touring",
  xray_x4: "touring",
  yokomo_bd11: "touring",
  yokomo_bd12: "touring",
  tamiya_trf421: "touring",
  infinity_if14: "touring",
  schumacher_atom2: "touring",
  destiny_rx10: "touring",
  arc_r12: "touring",
};

/**
 * Platform for a chassis slug, or null when the chassis isn't in the curated catalog (a
 * user-created model). User-created duplicates are slug-suffixed to stay unique
 * (`mugen_mtc3_2`), so a prefix match keeps them on the right platform.
 */
export function platformForChassisSlug(
  slug: string | null | undefined
): ChassisPlatformId | null {
  const s = slug?.trim().toLowerCase();
  if (!s) return null;
  const exact = CHASSIS_PLATFORM_BY_SLUG[s];
  if (exact) return exact;
  for (const [base, platform] of Object.entries(CHASSIS_PLATFORM_BY_SLUG)) {
    if (s.startsWith(`${base}_`)) return platform;
  }
  return null;
}

/** The car fields a discipline lookup needs. Select these together or the answer is guesswork. */
export type CarDisciplineInput = {
  carClass?: string | null;
  setupSheetTemplate?: string | null;
  setupSheetModel?: { slug: string | null } | null;
};

/**
 * A car's discipline (== chassis platform), or null when nothing says.
 *
 * Inference from the chassis first, then the dormant `Car.carClass` column as an override for
 * cars the catalog can't place. Lifted from `loadGeneralCarIdentity`, which had this exact
 * expression inline and was the only thing reading `carClass` for identity.
 *
 * Be aware what this can return **today**: every slug in `CHASSIS_PLATFORM_BY_SLUG` is
 * `touring`, and nothing writes `carClass` since the picker was dropped 2026-07-22. So on
 * current data this is `"touring"` or `null` and nothing else — any filter built on it is
 * inert until non-touring chassis are catalogued or a way to set `carClass` comes back.
 */
export function disciplineForCar(car: CarDisciplineInput | null | undefined): string | null {
  if (!car) return null;
  const slug = car.setupSheetModel?.slug ?? canonicalSetupSheetTemplateId(car.setupSheetTemplate);
  const inferred = platformForChassisSlug(slug);
  if (inferred) return inferred;
  // `|| null`, not `?? null`: a whitespace-only carClass trims to "" and must read as unset.
  return car.carClass?.trim() || null;
}
