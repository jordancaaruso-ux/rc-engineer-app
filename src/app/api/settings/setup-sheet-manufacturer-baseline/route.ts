import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";

function normalizeHttpsUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAuthAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = await prisma.setupSheetManufacturerBaseline.findMany({
    orderBy: { setupSheetTemplate: "asc" },
    select: {
      setupSheetTemplate: true,
      pdfUrl: true,
      summary: true,
      reviewedAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({
    baselines: rows.map((r) => ({
      ...r,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}

export async function PUT(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAuthAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as {
    setupSheetTemplate?: string;
    pdfUrl?: string;
    summary?: string | null;
    setReviewedNow?: boolean;
  } | null;
  const template = canonicalSetupSheetTemplateId(body?.setupSheetTemplate ?? null);
  if (!template) {
    return NextResponse.json({ error: "setupSheetTemplate is required" }, { status: 400 });
  }
  const pdfUrl = typeof body?.pdfUrl === "string" ? normalizeHttpsUrl(body.pdfUrl) : null;
  if (!pdfUrl) {
    return NextResponse.json(
      { error: "pdfUrl must be a valid https:// URL" },
      { status: 400 }
    );
  }
  const summary =
    body?.summary === null || body?.summary === undefined
      ? null
      : typeof body.summary === "string"
        ? body.summary.trim() || null
        : null;
  const reviewedAt =
    body?.setReviewedNow === true ? new Date() : undefined;

  const row = await prisma.setupSheetManufacturerBaseline.upsert({
    where: { setupSheetTemplate: template },
    create: {
      setupSheetTemplate: template,
      pdfUrl,
      summary,
      reviewedAt: reviewedAt ?? null,
    },
    update: {
      pdfUrl,
      summary,
      ...(reviewedAt !== undefined ? { reviewedAt } : {}),
    },
    select: {
      setupSheetTemplate: true,
      pdfUrl: true,
      summary: true,
      reviewedAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({
    baseline: {
      ...row,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    },
  });
}

export async function DELETE(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAuthAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const template = canonicalSetupSheetTemplateId(searchParams.get("setupSheetTemplate"));
  if (!template) {
    return NextResponse.json({ error: "setupSheetTemplate query required" }, { status: 400 });
  }
  const del = await prisma.setupSheetManufacturerBaseline.deleteMany({
    where: { setupSheetTemplate: template },
  });
  if (del.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
