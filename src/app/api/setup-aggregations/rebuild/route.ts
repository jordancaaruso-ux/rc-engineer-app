import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { rebuildSetupAggregationsForUserCars } from "@/lib/setupAggregations/rebuildCarParameterAggregations";
import { rebuildCommunityTemplateAggregations } from "@/lib/setupAggregations/rebuildCommunityTemplateAggregations";

export async function POST() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [userCars, community] = await Promise.all([
    rebuildSetupAggregationsForUserCars(user.id),
    rebuildCommunityTemplateAggregations(),
  ]);
  return NextResponse.json({ userCars, community }, { status: 200 });
}
