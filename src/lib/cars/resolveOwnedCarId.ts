import { prisma } from "@/lib/prisma";

export async function resolveOwnedCarId(
  userId: string,
  carIdRaw: unknown
): Promise<{ ok: true; carId: string } | { ok: false; message: string }> {
  const trimmed = typeof carIdRaw === "string" ? carIdRaw.trim() : "";
  if (!trimmed) return { ok: false, message: "carId is required" };
  const car = await prisma.car.findFirst({
    where: { id: trimmed, userId },
    select: { id: true },
  });
  if (!car) return { ok: false, message: "Car not found" };
  return { ok: true, carId: car.id };
}
