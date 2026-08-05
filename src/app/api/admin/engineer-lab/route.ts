import { NextResponse } from "next/server";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import {
  canUseEngineerLab,
  ENGINEER_LAB_RUNGS,
  loadEngineerLabRungs,
  setEngineerLabRung,
  type EngineerLabRungId,
} from "@/lib/engineerChat/lab/labFlags";

/**
 * Read and flip the Engineer lab rungs for the signed-in admin. Both verbs re-check the gate —
 * the settings section being hidden is presentation, not access control.
 */

export const dynamic = "force-dynamic";

async function requireLabUser() {
  if (!hasDatabaseUrl()) {
    return { error: NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 }) };
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!canUseEngineerLab(user.email)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const gate = await requireLabUser();
  if (gate.error) return gate.error;

  const active = await loadEngineerLabRungs({ userId: gate.user.id, email: gate.user.email });
  return NextResponse.json({
    rungs: ENGINEER_LAB_RUNGS.map((r) => ({
      id: r.id,
      label: r.label,
      description: r.description,
      on: active.includes(r.id),
    })),
  });
}

export async function POST(request: Request) {
  const gate = await requireLabUser();
  if (gate.error) return gate.error;

  const body = (await request.json().catch(() => null)) as { rung?: unknown; on?: unknown } | null;
  const rung = ENGINEER_LAB_RUNGS.find((r) => r.id === body?.rung);
  if (!rung) {
    return NextResponse.json({ error: "Unknown rung" }, { status: 400 });
  }

  await setEngineerLabRung({
    userId: gate.user.id,
    rung: rung.id as EngineerLabRungId,
    on: body?.on === true,
  });

  const active = await loadEngineerLabRungs({ userId: gate.user.id, email: gate.user.email });
  return NextResponse.json({ ok: true, active });
}
