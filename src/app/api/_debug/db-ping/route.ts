import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { isAuthAdminEmail } from "@/lib/authAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAuthAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const perQueryMs: number[] = [];
  const errors: string[] = [];

  const t0 = Date.now();
  for (let i = 0; i < 5; i++) {
    const q0 = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1 as ok`;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
    perQueryMs.push(Date.now() - q0);
  }
  const totalMs = Date.now() - t0;

  const sorted = [...perQueryMs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  return NextResponse.json({
    perQueryMs,
    totalMs,
    stats: { min, median, max },
    errors,
    vercelRegion: process.env.VERCEL_REGION ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    note:
      "First query may be slower (connection / Neon wake). Median and min reflect steady-state round-trip cost from Vercel fn → Neon DB.",
  });
}
