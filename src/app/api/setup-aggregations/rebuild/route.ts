import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/lib/env";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { rebuildSetupAggregationsForUserCars } from "@/lib/setupAggregations/rebuildCarParameterAggregations";
import { rebuildCommunityTemplateAggregations } from "@/lib/setupAggregations/rebuildCommunityTemplateAggregations";

export async function POST() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = isAuthAdminEmail(user.email);
  const userCars = await rebuildSetupAggregationsForUserCars(user.id);
  const community = isAdmin ? await rebuildCommunityTemplateAggregations() : null;

  return NextResponse.json(
    {
      userCars,
      community,
      ...(isAdmin ? {} : { communitySkipped: "Admin only — set AUTH_ADMIN_EMAILS to rebuild community stats." }),
    },
    { status: 200 }
  );
}
