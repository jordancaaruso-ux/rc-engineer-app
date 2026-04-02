import { NextResponse } from "next/server";

const COOKIE = "rc-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const login = new URL("/login", url.origin);
  const res = NextResponse.redirect(login);
  res.cookies.set(COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
    sameSite: "lax",
  });
  return res;
}
