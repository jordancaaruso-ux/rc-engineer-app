import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

const TIRE_SET_SELECT = {
  id: true,
  label: true,
  setNumber: true,
  initialRunCount: true,
  insertLabel: true,
  wheelLabel: true,
  specificModel: true,
  tireTypeId: true,
  tireType: { select: { id: true, displayName: true, modelCode: true } },
} as const;

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tireSets = await prisma.tireSet.findMany({
    where: { userId: user.id },
    orderBy: [{ label: "asc" }, { setNumber: "asc" }, { createdAt: "desc" }],
    select: TIRE_SET_SELECT,
  });
  return NextResponse.json({ tireSets });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  try {
    const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await request.json()) as {
      tireTypeId?: string;
      /** Legacy free-text create (deprecated). */
      label?: string;
      setNumber?: number;
      initialRunCount?: number;
      insertLabel?: string | null;
      wheelLabel?: string | null;
      specificModel?: string | null;
      notes?: string;
    };

    const initialRunCount =
      typeof body.initialRunCount === "number" &&
      Number.isFinite(body.initialRunCount) &&
      body.initialRunCount >= 0
        ? Math.floor(body.initialRunCount)
        : 0;

    const insertLabel = body.insertLabel?.trim() || null;
    const wheelLabel = body.wheelLabel?.trim() || null;
    const specificModel = body.specificModel?.trim() || null;

    const tireTypeId = body.tireTypeId?.trim();
    if (tireTypeId) {
      const setNumber =
        typeof body.setNumber === "number" && Number.isFinite(body.setNumber) && body.setNumber >= 1
          ? Math.floor(body.setNumber)
          : null;
      if (setNumber == null) {
        return NextResponse.json({ error: "setNumber is required when tireTypeId is set" }, { status: 400 });
      }

      const tireType = await prisma.tireType.findUnique({
        where: { id: tireTypeId },
        select: { id: true, displayName: true },
      });
      if (!tireType) {
        return NextResponse.json({ error: "Tire type not found" }, { status: 400 });
      }

      const existing = await prisma.tireSet.findFirst({
        where: { userId: user.id, tireTypeId, setNumber },
        select: TIRE_SET_SELECT,
      });
      if (existing) {
        const needsUpdate =
          (specificModel != null && specificModel !== existing.specificModel) ||
          (insertLabel && insertLabel !== existing.insertLabel) ||
          (wheelLabel && wheelLabel !== existing.wheelLabel);
        const updated = needsUpdate
          ? await prisma.tireSet.update({
              where: { id: existing.id },
              data: {
                specificModel: specificModel ?? existing.specificModel,
                insertLabel: insertLabel ?? existing.insertLabel,
                wheelLabel: wheelLabel ?? existing.wheelLabel,
              },
              select: TIRE_SET_SELECT,
            })
          : existing;
        return NextResponse.json({ tireSet: updated }, { status: 200 });
      }

      const tireSet = await prisma.tireSet.create({
        data: {
          label: tireType.displayName,
          tireTypeId: tireType.id,
          setNumber,
          initialRunCount,
          insertLabel,
          wheelLabel,
          specificModel,
          notes: body.notes?.trim() || null,
          userId: user.id,
        },
        select: TIRE_SET_SELECT,
      });
      return NextResponse.json({ tireSet }, { status: 201 });
    }

    const label = body.label?.trim();
    if (!label) {
      return NextResponse.json({ error: "tireTypeId or label is required" }, { status: 400 });
    }

    const setNumber =
      typeof body.setNumber === "number" && Number.isFinite(body.setNumber) && body.setNumber >= 1
        ? Math.floor(body.setNumber)
        : 1;

    const tireSet = await prisma.tireSet.create({
      data: {
        label,
        setNumber,
        initialRunCount,
        insertLabel,
        wheelLabel,
        specificModel,
        notes: body.notes?.trim() || null,
        userId: user.id,
      },
      select: TIRE_SET_SELECT,
    });

    return NextResponse.json({ tireSet }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create tire set";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
