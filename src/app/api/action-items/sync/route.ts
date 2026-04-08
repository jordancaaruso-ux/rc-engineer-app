import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { syncActionItemsFromLogFormDraft } from "@/lib/actionItems";

/** Debounced client sync: persist “Things to try” from Log your run before run save. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  try {
    const user = await getOrCreateLocalUser();
    const body = (await request.json()) as { suggestedChanges?: string | null };
    const suggestedChanges =
      typeof body.suggestedChanges === "string" ? body.suggestedChanges : body.suggestedChanges ?? null;

    await syncActionItemsFromLogFormDraft({
      userId: user.id,
      suggestedChanges,
    });

    revalidatePath("/");
    revalidatePath("/runs/new");
    revalidatePath("/engineer");

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
