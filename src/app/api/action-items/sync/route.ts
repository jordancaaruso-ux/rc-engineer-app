import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { syncActionItemsFromLogFormDraft } from "@/lib/actionItems";

/** Debounced client sync: persist “Things to try” from Log your run before run save. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  try {
    const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const raw = (await request.json()) as {
      suggestedChanges?: string | null;
      suggestedPreRun?: string | null;
    };
    if (!("suggestedChanges" in raw) && !("suggestedPreRun" in raw)) {
      return NextResponse.json({ error: "No fields to sync" }, { status: 400 });
    }
    const draft: {
      userId: string;
      suggestedChanges?: string | null;
      suggestedPreRun?: string | null;
    } = { userId: user.id };
    if (Object.prototype.hasOwnProperty.call(raw, "suggestedChanges")) {
      const v = raw.suggestedChanges;
      draft.suggestedChanges = typeof v === "string" ? v : v ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(raw, "suggestedPreRun")) {
      const v = raw.suggestedPreRun;
      draft.suggestedPreRun = typeof v === "string" ? v : v ?? null;
    }
    await syncActionItemsFromLogFormDraft(draft);

    revalidatePath("/");
    revalidatePath("/runs/new");
    revalidatePath("/engineer");

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
