/**
 * dev-fresh-onboarding.ts — DEV/TEST ONLY.
 *
 * Onboarding is the one flow you can't re-experience on your own account: the admin reset
 * (`POST /api/onboarding {"action":"reset"}`) only clears `seen`/`dismissed`, but both gates in
 * `src/lib/onboarding/visibility.ts` also read `hasCar`/`hasAnyRun` — so on an account with data a
 * reset shows you nothing. `/debug/onboarding-preview` covers look-and-copy; this covers the one
 * thing it can't fake: actually being a new user, clicking through the real app.
 *
 * What it does: allowlists a throwaway `+ob…` alias and mints a magic-link URL straight into
 * `VerificationToken` (same SHA-256(`token` + AUTH_SECRET) scheme `@auth/core` uses). No SMTP, no
 * inbox, no /login form — click the printed URL and you land on the dashboard as a brand-new
 * account. The User row is created by the Auth.js adapter on that click, so it is genuinely fresh.
 *
 *   npm run onboarding:new       # new throwaway account + sign-in link
 *   npm run onboarding:new -- --email=me+ob2@gmail.com   # a specific address
 *   npm run onboarding:new -- --link                     # re-link the most recent throwaway
 *   npm run onboarding:cleanup                           # delete every +ob… account and its data
 *
 * The link is single-use (Auth.js consumes the token) and expires in 24h — re-run with --link for
 * another one on the same account. Writes to whatever DATABASE_URL points at, so it prints the host
 * first: point it at the dev Neon branch, never prod.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

/** Base address the throwaway aliases are built from — any inbox works, none is ever emailed. */
const BASE_EMAIL = "jordancaaruso@gmail.com";
/** Marks an address as disposable. `--cleanup` deletes exactly these and nothing else. */
const THROWAWAY_TAG = "+ob";

const args = process.argv.slice(2);
const hasFlag = (name: string) => args.includes(`--${name}`);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

/** `jordancaaruso@gmail.com` → `jordancaaruso+ob0727-4f2a@gmail.com`. Unique per run. */
function freshAlias(): string {
  const [local, domain] = BASE_EMAIL.split("@");
  const now = new Date();
  const stamp = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `${local}${THROWAWAY_TAG}${stamp}-${randomBytes(2).toString("hex")}@${domain}`;
}

/**
 * The magic link Auth.js would have emailed. `sendToken` stores SHA-256(`${token}${secret}`) and
 * puts the raw token in the URL; the callback re-hashes and looks it up, so minting the row here is
 * indistinguishable from a real request — provider id `nodemailer`, basePath `/api/auth`.
 */
async function mintSignInUrl(email: string): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — run via `npm run onboarding:new`.");
  const baseUrl = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000")
    .trim()
    .replace(/\/$/, "");

  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: createHash("sha256").update(`${token}${secret}`).digest("hex"),
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const params = new URLSearchParams({ callbackUrl: `${baseUrl}/`, token, email });
  return `${baseUrl}/api/auth/callback/nodemailer?${params}`;
}

/** Deletes throwaway accounts outright — every user relation is Cascade or SetNull, so this is clean. */
async function cleanup(): Promise<void> {
  const [local, domain] = BASE_EMAIL.split("@");
  const where = { email: { startsWith: `${local}${THROWAWAY_TAG}`, endsWith: `@${domain}` } };
  const users = await prisma.user.findMany({ where, select: { id: true, email: true } });
  const allowed = await prisma.authAllowedEmail.findMany({ where, select: { email: true } });

  if (!users.length && !allowed.length) {
    console.log("Nothing to clean up — no throwaway accounts found.");
    return;
  }
  for (const u of users) {
    await prisma.user.delete({ where: { id: u.id } });
    console.log(`  deleted account  ${u.email}`);
  }
  const emails = allowed.map((a) => a.email);
  if (emails.length) {
    await prisma.authAllowedEmail.deleteMany({ where: { email: { in: emails } } });
    await prisma.verificationToken.deleteMany({ where: { identifier: { in: emails } } });
    console.log(`  removed ${emails.length} allowlist entr${emails.length === 1 ? "y" : "ies"}`);
  }
  console.log("\nDone. Real accounts were never matched — only the +ob aliases.");
}

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`\nDatabase: ${dbHost}\n`);

  if (hasFlag("cleanup")) {
    await cleanup();
    return;
  }

  // --link re-issues a link for the newest existing throwaway (mid-walkthrough, second device),
  // instead of starting over with an empty account.
  let email = argValue("email")?.trim().toLowerCase();
  if (!email && hasFlag("link")) {
    const [local, domain] = BASE_EMAIL.split("@");
    const where = { email: { startsWith: `${local}${THROWAWAY_TAG}`, endsWith: `@${domain}` } };
    const orderBy = { createdAt: "desc" } as const;
    // The signed-in account is the better answer; the allowlist row covers a link that was minted
    // but never clicked (and is the only trace when dev sign-in is open to any address).
    const lastUser = await prisma.user.findFirst({ where, orderBy, select: { email: true } });
    const last =
      lastUser ?? (await prisma.authAllowedEmail.findFirst({ where, orderBy, select: { email: true } }));
    if (!last?.email) throw new Error("No throwaway account yet — run without --link to create one.");
    email = last.email;
  }
  const reusing = Boolean(email);
  email ??= freshAlias();

  // The signIn callback rejects anything not allowed, so this has to land first. Skipped when
  // `AUTH_DEV_ALLOW_ANY_EMAIL=1` already opens dev sign-in — then the token is the only row written.
  const devAllowsAny =
    process.env.AUTH_DEV_ALLOW_ANY_EMAIL === "1" || process.env.AUTH_OPEN_SIGNUP === "1";
  if (!devAllowsAny) {
    await prisma.authAllowedEmail.upsert({ where: { email }, update: {}, create: { email } });
  }

  const url = await mintSignInUrl(email);
  const existing = await prisma.user.findFirst({ where: { email }, select: { id: true } });

  console.log(`Account:  ${email}`);
  console.log(
    reusing || existing
      ? "State:    existing account — keeps whatever you've already done in it"
      : "State:    brand new — no car, no runs, welcome overlay armed",
  );
  console.log("\nStart `npm run dev`, then open this once (single-use, expires in 24h):\n");
  console.log(url);
  console.log("\nWhen you're finished:  npm run onboarding:cleanup\n");
}

main()
  .catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : err}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
