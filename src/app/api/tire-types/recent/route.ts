import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isSamePlatform } from "@/lib/cars/carClasses";
import { disciplineForCar } from "@/lib/cars/chassisPlatform";
import { tireProfileForDiscipline } from "@/lib/cars/tireProfile";
import { activeTireBucket } from "@/lib/tires/tireCatalogScope";

const TIRE_TYPE_SELECT = {
  id: true,
  displayName: true,
  modelCode: true,
  discipline: true,
  position: true,
  createdByUserId: true,
} as const;

type RecentTireType = {
  id: string;
  displayName: string;
  modelCode: string;
  discipline: string | null;
  position: string | null;
};

const RUN_SCAN = 40;
const MAX_RECENT = 8;

/**
 * Distinct tire types from the user's recent runs (most recently used first).
 *
 * With `?carId=`, compounds run on cars of the same discipline lead the list —
 * what's on the other touring car is a much better guess for a new touring car
 * than the last thing bolted onto a buggy — and anything from another slice of
 * the catalog is left out altogether, the same rule the full list follows
 * (`tireCatalogWhere`): a touring car's "Recently used" never offers a pin tire.
 *
 * With `?end=front` the list is the tires this driver has run on the FRONT — on a front/rear car
 * the two ends are different products, and offering a rear pin tire as the front's most likely
 * answer is worse than offering nothing. Any other value reads the rear (or only) tire. The one
 * exception is a one-tire class that can log its ends apart (touring, FWD: `frontRearSwitch`):
 * the same tires fit both ends, so its front also offers the tires it has run all round. Its
 * front list was otherwise empty until a front had been saved (review, 2026-09-26).
 *
 * The discipline comes from `disciplineForCar`, never from `Car.carClass` alone:
 * that column is only the last-resort override, so reading it directly placed
 * no car whose chassis already answered the question — which is most of them.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const carId = params.get("carId");
  const front = params.get("end") === "front";
  const cars = carId
    ? await prisma.car.findMany({
        where: { userId: userId },
        select: {
          id: true,
          carClass: true,
          setupSheetTemplate: true,
          setupSheetModel: { select: { slug: true, discipline: true } },
        },
      })
    : [];
  const discipline = disciplineForCar(cars.find((c) => c.id === carId));
  const profile = tireProfileForDiscipline(discipline);
  const bucket = await activeTireBucket(profile.bucket);
  const frontFromEitherEnd = front && profile.frontRearSwitch;
  // Only cars that positively share the discipline — `isSamePlatform` treats an unplaced car as
  // "same", which is right for carrying tires and wrong for ranking a list.
  const sameDisciplineCarIds = discipline
    ? cars
        .filter((c) => {
          const other = disciplineForCar(c);
          return other != null && isSamePlatform(discipline, other);
        })
        .map((c) => c.id)
    : [];

  const baseWhere = frontFromEitherEnd
    ? { userId: userId, OR: [{ frontTireTypeId: { not: null } }, { tireTypeId: { not: null } }] }
    : front
      ? ({ userId: userId, frontTireTypeId: { not: null } } as const)
      : ({ userId: userId, tireTypeId: { not: null } } as const);
  const query = async (where: object) => {
    const runs = await prisma.run.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: RUN_SCAN,
      select: {
        tireType: { select: TIRE_TYPE_SELECT },
        frontTireType: { select: TIRE_TYPE_SELECT },
      },
    });
    // A run's front first, then its rear, so a front the driver has logged still leads.
    return runs.flatMap((r) =>
      frontFromEitherEnd
        ? [{ tireType: r.frontTireType }, { tireType: r.tireType }]
        : [{ tireType: front ? r.frontTireType : r.tireType }]
    );
  };

  // Two scans rather than one filtered afterwards: a driver whose last 40 runs
  // were all off-road would otherwise see nothing for their touring car.
  const [sameClassRuns, anyRuns] = await Promise.all([
    sameDisciplineCarIds.length > 0
      ? query({ ...baseWhere, carId: { in: sameDisciplineCarIds } })
      : Promise.resolve([]),
    query(baseWhere),
  ]);

  const seen = new Set<string>();
  const tireTypes: RecentTireType[] = [];
  for (const run of [...sameClassRuns, ...anyRuns]) {
    const tt = run.tireType;
    if (!tt || seen.has(tt.id)) continue;
    seen.add(tt.id);
    const inBucket =
      !bucket || tt.discipline === bucket || tt.discipline == null || tt.createdByUserId === userId;
    if (!inBucket) continue;
    tireTypes.push({
      id: tt.id,
      displayName: tt.displayName,
      modelCode: tt.modelCode,
      discipline: tt.discipline,
      position: tt.position,
    });
    if (tireTypes.length >= MAX_RECENT) break;
  }

  return NextResponse.json({ tireTypes });
}
