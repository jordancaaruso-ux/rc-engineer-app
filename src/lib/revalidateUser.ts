import { revalidatePath, revalidateTag } from "next/cache";
import { carsTag, dashboardTag, runsTag, tracksTag } from "@/lib/cacheTags";

const IMMEDIATE = { expire: 0 } as const;

export function revalidateAfterRunMutation(userId: string): void {
  revalidatePath("/runs/history");
  revalidatePath("/");
  revalidatePath("/engineer");
  revalidatePath("/laps/import");
  revalidateTag(dashboardTag(userId), IMMEDIATE);
  revalidateTag(runsTag(userId), IMMEDIATE);
}

export function revalidateAfterActionItemMutation(userId: string): void {
  revalidatePath("/");
  revalidatePath("/runs/new");
  revalidatePath("/engineer");
  revalidateTag(dashboardTag(userId), IMMEDIATE);
}

export function revalidateAfterCarMutation(userId: string): void {
  revalidatePath("/cars");
  revalidatePath("/runs/new");
  revalidateTag(carsTag(userId), IMMEDIATE);
  revalidateTag(dashboardTag(userId), IMMEDIATE);
}

export function revalidateAfterTrackMutation(userId: string): void {
  revalidatePath("/tracks");
  revalidatePath("/runs/new");
  revalidatePath("/events");
  revalidateTag(tracksTag(userId), IMMEDIATE);
}
