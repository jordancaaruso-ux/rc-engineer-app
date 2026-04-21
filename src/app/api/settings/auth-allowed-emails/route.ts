import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { isAuthAdminEmail } from "@/lib/authAdmin";

function normalizeEmail(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t || !t.includes("@")) return null;
  return t;
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
  const rows = await prisma.authAllowedEmail.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, createdAt: true },
  });
  return NextResponse.json({ emails: rows });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAuthAdminEmail(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : null;
  if (!email) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }
  const row = await prisma.authAllowedEmail.upsert({
    where: { email },
    create: { email },
    update: {},
    select: { id: true, email: true, createdAt: true },
  });
  return NextResponse.json({ email: row }, { status: 201 });
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
  const raw = searchParams.get("email") ?? "";
  const email = normalizeEmail(raw);
  if (!email) {
    return NextResponse.json({ error: "email query parameter required" }, { status: 400 });
  }
  const existing = await prisma.authAllowedEmail.findUnique({
    where: { email },
    select: { email: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.authAllowedEmail.delete({ where: { email } });
  return NextResponse.json({ ok: true });
}
