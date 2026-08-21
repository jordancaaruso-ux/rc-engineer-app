import { NextResponse } from "next/server";
import { deleteNote, listNotes, upsertNote, type MarkupNote } from "@/lib/devMarkup/store";

export const dynamic = "force-dynamic";

/**
 * Dev-only store for the on-app markup layer (`components/devtools/DevMarkupLayer.tsx`).
 *
 * Jordan drives the real app on his phone, pins notes onto real elements, and they land in
 * `.markup/notes.json` in the checkout where they can be read straight off disk. Nothing here is
 * product surface, and the guard below is the only thing keeping it out of production — treat it
 * as load-bearing, exactly like the one in `api/auth/dev-new-user`.
 *
 * Authentication is left to the middleware on purpose: this sits under `/api/`, so an unauthimated
 * caller already gets 401 JSON without a special case here.
 */
function devOnly(): Response | null {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  return null;
}

export async function GET(): Promise<Response> {
  const blocked = devOnly();
  if (blocked) return blocked;
  return NextResponse.json({ notes: await listNotes() });
}

export async function POST(request: Request): Promise<Response> {
  const blocked = devOnly();
  if (blocked) return blocked;

  const body = (await request.json().catch(() => null)) as Partial<MarkupNote> | null;
  if (!body?.id || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const note: MarkupNote = {
    id: body.id,
    createdAt: body.createdAt ?? new Date().toISOString(),
    route: body.route ?? "/",
    kind: body.kind === "draw" ? "draw" : "pin",
    text: typeof body.text === "string" ? body.text : "",
    selector: body.selector ?? null,
    tag: body.tag ?? null,
    className: body.className ?? null,
    label: body.label ?? null,
    x: Number(body.x) || 0,
    y: Number(body.y) || 0,
    vw: Number(body.vw) || 0,
    vh: Number(body.vh) || 0,
    ...(Array.isArray(body.paths) && body.paths.length ? { paths: body.paths } : {}),
    ...(body.done ? { done: true } : {}),
  };

  return NextResponse.json({ notes: await upsertNote(note) });
}

export async function DELETE(request: Request): Promise<Response> {
  const blocked = devOnly();
  if (blocked) return blocked;

  const id = new URL(request.url).searchParams.get("id");
  return NextResponse.json({ notes: await deleteNote(id ?? undefined) });
}
