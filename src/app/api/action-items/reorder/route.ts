import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { parseActionItemListQuery, reorderUserActionItems } from "@/lib/actionItems";

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { list?: string | null; orderedIds?: string[] };
  const listKind = parseActionItemListQuery(
    typeof body.list === "string" ? body.list : null
  );
  const orderedIds = Array.isArray(body.orderedIds)
    ? body.orderedIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];

  try {
    await reorderUserActionItems({ userId: user.id, listKind, orderedIds });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Reorder failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  revalidatePath("/");
  revalidatePath("/runs/new");
  revalidatePath("/engineer");

  return NextResponse.json({ ok: true });
}
