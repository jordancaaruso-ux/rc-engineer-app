import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { isThrowawayEmail } from "@/lib/account/throwawayAccounts";
import { redirectSignedIn } from "@/lib/auth/devSessionCookie";

/**
 * Dev-only one-tap sign-in as an EXISTING account. The sibling of `/api/auth/dev-new-user`:
 * that one always mints a brand-new empty account, this one gets you into an account that
 * already has runs in it — your own, the demo season, a tester's — without an inbox.
 *
 * Why it exists: locally there was no way in. The magic-link leg is localhost-only
 * (`AUTH_URL` is pinned, see `lib/auth/devSessionCookie.ts`), `scripts/dev-demo-signin.ts`
 * prints a SINGLE-USE link and only ever reaches the demo account, and `dev-new-user` hands
 * back an empty dashboard. Any surface that needs real data — Analysis, Sessions, the
 * Engineer — had nothing to show.
 *
 *   GET /api/auth/dev-signin              → a tap-to-pick list of accounts
 *   GET /api/auth/dev-signin?email=a@b.c  → straight in as that account
 *   GET /api/auth/dev-signin?email=…&to=/analysis → …and land on that page
 *
 * Reusable and bookmarkable: no token is burned, so the same URL works forever and from any
 * device on the LAN (the redirect is relative — same reason as `dev-new-user`).
 *
 * Public by construction, exactly like `/api/auth/demo`: the middleware matcher excludes
 * `api/auth` entirely, and this static segment takes priority over the `[...nextauth]`
 * catch-all. The 404 below is therefore the ONLY thing keeping it out of production —
 * treat it as load-bearing.
 *
 * Read-only against the database: it never creates a User and never writes an AuthAllowedEmail
 * row. It does not need to — `redirectSignedIn` mints the JWT cookie directly, so Auth.js's
 * `signIn` allowlist gate never runs on this path. Nothing here can invent an account, which
 * matters because `.env.local` points at scratch-dev, a copy-on-write clone holding real
 * users' rows.
 */

const MAX_LISTED = 40;

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "No DATABASE_URL" }, { status: 503 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get("email")?.trim().toLowerCase();

  if (!email) {
    return accountPicker(url);
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true },
  });
  if (!user?.email) {
    return new NextResponse(
      page(`<p class="err">No account for <b>${escapeHtml(email)}</b> in this database.</p>
        <p><a class="btn" href="/api/auth/dev-signin">Pick from the list</a></p>`),
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  console.info(`[dev-signin] signed in as ${user.email} (${user.id})`);

  // `to` is deliberately restricted to a same-site path: this route hands out a live session
  // cookie, so an absolute Location would make it a redirector that signs you in on the way out.
  const to = url.searchParams.get("to");
  const safeTo = to && /^\/(?!\/)/.test(to) ? to : "/";

  return redirectSignedIn({ request, userId: user.id, email: user.email, to: safeTo });
}

async function accountPicker(url: URL): Promise<Response> {
  const showAll = url.searchParams.get("all") === "1";

  const users = await prisma.user.findMany({
    select: { email: true, name: true, _count: { select: { runs: true } } },
    orderBy: [{ runs: { _count: "desc" } }, { createdAt: "desc" }],
    take: 300,
  });

  // Throwaway `+ob…` aliases pile up one per `dev-new-user` load and would bury the real
  // accounts. Hidden behind `?all=1` rather than dropped — sometimes you want back into the
  // one you just walked onboarding with.
  const listed = (showAll ? users : users.filter((u) => !isThrowawayEmail(u.email))).slice(
    0,
    MAX_LISTED,
  );
  const hiddenCount = users.length - listed.length;

  const rows = listed
    .map((u) => {
      const address = u.email ?? "";
      const runs = u._count.runs;
      return `<a class="row" href="/api/auth/dev-signin?email=${encodeURIComponent(address)}">
        <span class="who">
          <b>${escapeHtml(u.name?.trim() || address)}</b>
          ${u.name?.trim() ? `<span class="sub">${escapeHtml(address)}</span>` : ""}
        </span>
        <span class="runs">${runs} run${runs === 1 ? "" : "s"}</span>
      </a>`;
    })
    .join("");

  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";

  return new NextResponse(
    page(`
      <h1>Sign in as…</h1>
      <p class="sub">Dev only. Tap an account — no email, no link to burn, reusable forever.</p>
      <div class="list">${rows || '<p class="err">No accounts in this database.</p>'}</div>
      <p class="foot">
        <a class="btn" href="/api/auth/dev-new-user">Brand-new empty account</a>
        ${showAll ? '<a class="btn ghost" href="/api/auth/dev-signin">Hide throwaways</a>' : `<a class="btn ghost" href="/api/auth/dev-signin?all=1">Show throwaway accounts${hiddenCount > 0 ? ` (${hiddenCount})` : ""}</a>`}
      </p>
      <p class="db">${escapeHtml(dbHost)}</p>
    `),
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Self-contained — the app's stylesheet is not loaded on an API route. */
function page(body: string): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dev sign-in</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; padding:24px 16px 48px; background:#efece6; color:#1c1a17;
    font:16px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:560px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 4px; }
  p.sub { margin:0 0 20px; color:#6b665e; font-size:14px; }
  .list { display:flex; flex-direction:column; gap:8px; }
  a.row { display:flex; align-items:center; justify-content:space-between; gap:12px;
    padding:14px 16px; background:#fff; border:1px solid #ded9d0; border-radius:12px;
    text-decoration:none; color:inherit; min-height:44px; }
  a.row:active { background:#f6f3ee; }
  .who { display:flex; flex-direction:column; min-width:0; }
  .who b { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sub { color:#6b665e; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .runs { color:#6b665e; font-size:13px; white-space:nowrap; }
  .foot { display:flex; flex-wrap:wrap; gap:8px; margin:24px 0 0; }
  .btn { display:inline-block; padding:10px 14px; border-radius:10px; background:#f5c518;
    color:#1c1a17; font-size:14px; font-weight:600; text-decoration:none; }
  .btn.ghost { background:transparent; border:1px solid #ded9d0; font-weight:500; }
  .err { color:#a3341f; }
  .db { margin:24px 0 0; color:#8a857c; font-size:11px; font-family:ui-monospace,Consolas,monospace; }
</style></head><body><main>${body}</main></body></html>`;
}
