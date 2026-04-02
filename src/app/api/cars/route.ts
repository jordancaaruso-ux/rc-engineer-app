import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }
  try {
    const user = await getOrCreateLocalUser();
    const body = (await request.json()) as {
      name?: string;
      chassis?: string | null;
      notes?: string | null;
      setupSheetTemplate?: string | null;
    };
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }
    const setupSheetTemplate = body.setupSheetTemplate === "awesomatix_a800rr"
      ? "awesomatix_a800rr"
      : null;
    const car = await prisma.car.create({
      data: {
        name,
        chassis: body.chassis?.trim() || null,
        notes: body.notes?.trim() || null,
        setupSheetTemplate,
        userId: user.id,
      },
      select: { id: true, name: true, chassis: true, notes: true, setupSheetTemplate: true },
    });
    revalidatePath("/cars");
    revalidatePath("/runs/new");
    return NextResponse.json({ car }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create car";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
