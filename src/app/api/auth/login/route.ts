import { NextResponse } from "next/server";

const COOKIE = "rc-auth";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function POST(request: Request) {
  const password = process.env.ACCESS_PASSWORD?.trim();
  if (!password) {
    return NextResponse.json({
      ok: true,
      gateDisabled: true,
      message: "ACCESS_PASSWORD is not set; gate is off.",
    });
  }

  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const attempt = typeof body.password === "string" ? body.password : "";
  if (attempt !== password) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, password, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    path: "/",
    sameSite: "lax",
  });
  return res;
}
