import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";

export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const links = await prisma.teammateLink.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      peerUserId: true,
      peer: { select: { name: true, email: true } },
    },
  });
  return NextResponse.json({
    teammates: links.map((l) => ({
      id: l.id,
      peerUserId: l.peerUserId,
      name: l.peer.name?.trim() || null,
      email: l.peer.email?.trim() || null,
    })),
  });
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const user = await getOrCreateLocalUser();
  const body = (await request.json().catch(() => null)) as { email?: string } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  const peer = await prisma.user.findFirst({
    where: { email },
    select: { id: true, name: true, email: true },
  });
  if (!peer) {
    return NextResponse.json({ error: "No user found with that email" }, { status: 404 });
  }
  if (peer.id === user.id) {
    return NextResponse.json({ error: "You cannot add yourself as a teammate" }, { status: 400 });
  }

  try {
    await prisma.teammateLink.create({
      data: { userId: user.id, peerUserId: peer.id },
    });
  } catch {
    return NextResponse.json({ error: "Already linked" }, { status: 409 });
  }

  return NextResponse.json({
    teammate: {
      peerUserId: peer.id,
      name: peer.name?.trim() || null,
      email: peer.email?.trim() || null,
    },
  });
}
