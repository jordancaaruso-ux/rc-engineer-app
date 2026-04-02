import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { rebuildSetupAggregationsForUserCars } from "@/lib/setupAggregations/rebuildCarParameterAggregations";

export async function POST() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const result = await rebuildSetupAggregationsForUserCars(user.id);
  return NextResponse.json(result, { status: 200 });
}
