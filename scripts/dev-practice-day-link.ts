/**
 * dev-practice-day-link.ts — DEV ONLY. Mints a FRESH sign-in link for the account
 * `dev-seed-practice-day.ts` created and rewrites `e2e/.auth/practice-day.json`.
 *
 * A magic link is single-use: `useVerificationToken` deletes the row on the way through, so
 * a second drive on the same file signs in nobody and every page 500s. Run this between drives.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-practice-day-link.ts --base=http://localhost:3005
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

const FILE = "e2e/.auth/practice-day.json";
const args = process.argv.slice(2);
const argValue = (n: string) =>
  args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const BASE = (argValue("base") ?? process.env.AUTH_URL ?? "http://localhost:3000")
  .trim()
  .replace(/\/$/, "");

async function main() {
  const saved = JSON.parse(readFileSync(FILE, "utf8")) as { email: string };
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: saved.email,
      token: createHash("sha256").update(`${token}${secret}`).digest("hex"),
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const params = new URLSearchParams({ callbackUrl: `${BASE}/`, token, email: saved.email });
  const signInUrl = `${BASE}/api/auth/callback/nodemailer?${params}`;
  writeFileSync(FILE, JSON.stringify({ ...saved, signInUrl }, null, 2));
  console.log(signInUrl);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
