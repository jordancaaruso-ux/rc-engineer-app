import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { matchTireTypes, suggestModelCodeFromDisplayName } from "@/lib/tires/matchTireType";
import { ensureSeedTireTypes } from "@/lib/tires/ensureSeedTireTypes";
import { notifyAdminsOfUnverifiedAsset } from "@/lib/assets/notifyAdminReview";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { parseTireBucket } from "@/lib/tires/tireCatalogFilter";
import { TIRE_CATALOG_MAX, tireCatalogScopeWhere } from "@/lib/tires/tireCatalogScope";
import { objectionableTextError } from "@/lib/moderation/wordFilter";

/**
 * The picker downloads the catalog once and filters locally, so this is the ceiling on what is
 * findable at all — a row past it is not merely last, it does not exist as far as the driver is
 * concerned. 500 was written when the catalog was ~30 rows; the 1/10 off-road import took it to
 * 739 and would have made 239 tires unreachable and unsearchable. Headroom, not a page size.
 * The real answer at the next jump is filtering the list by what the car races, which keeps any
 * one driver's list short no matter how big the catalog gets — that is `?bucket=` below
 * (2026-09-19). The cap stays as the ceiling for a car nothing can place, which still gets it all.
 */
const CATALOG_MAX = TIRE_CATALOG_MAX;

const TIRE_TYPE_SELECT = {
  id: true,
  displayName: true,
  modelCode: true,
  verifiedAt: true,
  // The picker sorts on these; it never shows them.
  discipline: true,
  position: true,
} as const;

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  // One row by id — how the picker names a selection it was handed (a copied run, a spec tire)
  // that sits outside the car's bucket. Never filtered: the tire is already on the run.
  const id = searchParams.get("id")?.trim() ?? "";
  if (id) {
    const one = await prisma.tireType.findUnique({ where: { id }, select: TIRE_TYPE_SELECT });
    return NextResponse.json({ tireTypes: one ? [one] : [] });
  }

  // The picker filters locally so its search is instant, which only holds if it
  // was handed the whole catalog — a cap of 50 silently hid the tail and pushed
  // drivers into creating duplicates of types that already existed. Default stays
  // 50 for callers that just want a sample (admin merge, near-match suggestions).
  const take = Math.min(CATALOG_MAX, Math.max(1, Number(searchParams.get("limit") ?? 50) || 50));

  const count = await prisma.tireType.count();
  if (count === 0) {
    await ensureSeedTireTypes();
  }

  const where = await tireCatalogScopeWhere(parseTireBucket(searchParams.get("bucket")), user.id);

  if (q.length >= 1) {
    const catalog = await prisma.tireType.findMany({
      where,
      select: TIRE_TYPE_SELECT,
      orderBy: [{ displayName: "asc" }],
      take: CATALOG_MAX,
    });
    const matches = matchTireTypes(q, catalog, take);
    return NextResponse.json({
      tireTypes: matches.map((m) => m.tireType),
      query: q,
    });
  }

  const tireTypes = await prisma.tireType.findMany({
    where,
    select: TIRE_TYPE_SELECT,
    orderBy: [{ displayName: "asc" }],
    take,
  });
  // Verified-first (stable sort keeps the alphabetical order within each group); unverified sinks
  // below so junk rarely surfaces in the picker. At launch all rows are null → order unchanged.
  tireTypes.sort((a, b) => (a.verifiedAt ? 0 : 1) - (b.verifiedAt ? 0 : 1));
  return NextResponse.json({ tireTypes });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  try {
    // Open create (any signed-in user). A tire a DRIVER types is the one catalog row that still
    // waits for the founder (ruling 2026-09-26): it lands unverified, sits in /admin/review with a
    // merge suggestion when it is one of ours spelled another way, and pings him. One the founder
    // adds himself is trusted on arrival. See docs/ASSET_ACCESS_NORTH_STAR.md.
    const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const byAdmin = isAuthAdminEmail(user.email);
    const body = (await request.json()) as {
      displayName?: string;
      modelCode?: string;
      /** The bucket of the car it was added from — keeps a buggy tire out of touring lists. */
      discipline?: string;
    };

    const displayName = body.displayName?.trim();
    if (!displayName) {
      return NextResponse.json({ error: "displayName is required" }, { status: 400 });
    }
    // Other drivers see a typed name in their pickers straight away.
    const unclean = objectionableTextError(displayName);
    if (unclean) return NextResponse.json({ error: unclean }, { status: 400 });

    const modelCodeRaw = body.modelCode?.trim() || suggestModelCodeFromDisplayName(displayName);
    const modelCode = modelCodeRaw.toUpperCase().replace(/\s+/g, "-");

    const existingByCode = await prisma.tireType.findUnique({
      where: { modelCode },
      select: TIRE_TYPE_SELECT,
    });
    if (existingByCode) {
      return NextResponse.json(
        {
          error: "A tire type with this model code already exists.",
          existing: existingByCode,
        },
        { status: 409 }
      );
    }

    const catalog = await prisma.tireType.findMany({
      select: TIRE_TYPE_SELECT,
      take: CATALOG_MAX,
      orderBy: { displayName: "asc" },
    });
    const nearMatches = matchTireTypes(displayName, catalog, 4).filter((m) => m.score >= 70);

    const tireType = await prisma.tireType.create({
      data: {
        displayName,
        modelCode,
        createdByUserId: user.id,
        // An unknown value is dropped, not refused: the tire is real either way, and an unplaced
        // row simply shows in every list. `position` is deliberately left unset — stamping the
        // end it was added from would bury it when the same driver opens the other end.
        discipline: parseTireBucket(body.discipline),
        verifiedAt: byAdmin ? new Date() : null,
      },
      select: TIRE_TYPE_SELECT,
    });

    // Skips the founder's own rows by itself; they are verified above and never wait.
    await notifyAdminsOfUnverifiedAsset({
      kind: "Tire type",
      label: tireType.displayName,
      createdByEmail: user.email,
    });

    return NextResponse.json({ tireType, nearMatches: nearMatches.map((m) => m.tireType) }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create tire type";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
