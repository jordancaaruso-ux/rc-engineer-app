# Deploying RC Engineer (Vercel)

## 1. Deploy to Vercel

1. Push the repo to GitHub (or GitLab / Bitbucket).
2. In [Vercel](https://vercel.com), **Add New Project** → import the repository.
3. Framework Preset: **Next.js** (default). Root directory: repo root.
4. **Environment variables** — set at least the variables in section 2 below for Production (and Preview if you use it).
5. Deploy. The build runs `npm run build`, which includes TypeScript checking. `postinstall` runs `prisma generate`.

## 2. Required environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres (e.g. [Neon](https://neon.tech)) connection URI with SSL as required by the provider. |
| `AUTH_SECRET` | Auth.js signing secret (production). Generate with `openssl rand -base64 32`. |
| `AUTH_URL` | Public origin of the site (e.g. `https://your-app.vercel.app`) for magic-link callbacks. |
| `AUTH_ALLOWED_EMAILS` | Comma-separated emails allowed to sign in; also run `npx prisma db seed` to persist into `AuthAllowedEmail`. |
| `EMAIL_SERVER` / `EMAIL_FROM` | Nodemailer SMTP; omit in dev to log magic links to the server console instead. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Optional **Google OAuth** — sign in without SMTP to arbitrary Gmail addresses; **`AUTH_ALLOWED_EMAILS` must still list each person’s Google email**. |
| `BLOB_READ_WRITE_TOKEN` | **Required on Vercel** for persistent setup PDFs and cached run PDFs; without it, storage falls back to local disk (not durable on serverless). |

See `.env.example` for descriptions and placeholders.

Optional: `AUTH_ADMIN_EMAILS` (Settings → in-app allowlist admin), `OPENAI_API_KEY` (lap screenshot import), `LAP_IMPORT_USER_AGENT`, `DEBUG_ACCESS_GATE`. Do **not** set `AUTH_DEV_ALLOW_ANY_EMAIL` on Production.

### Google OAuth (beta testers without a mail domain)

Use this when [Resend](https://resend.com) (or similar) only delivers test mail to your own inbox. Google sign-in does not require owning a sending domain; the **allowlist still applies** to the Google account email.

1. [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID** → type **Web application**.
2. **Authorized JavaScript origins:** `https://your-app.vercel.app` (your real `AUTH_URL` origin).
3. **Authorized redirect URIs:** `https://your-app.vercel.app/api/auth/callback/google` (same host as `AUTH_URL`).
4. Copy **Client ID** → `AUTH_GOOGLE_ID`, **Client secret** → `AUTH_GOOGLE_SECRET` in Vercel (Production + Preview if needed). Redeploy.
5. Add each tester’s **Google email** to `AUTH_ALLOWED_EMAILS` (or DB allowlist / admin UI).

The login page shows **Continue with Google** when both Google env vars are set. Magic link via email remains available if SMTP is configured.

### Web-only beta (you + a few testers)

You do **not** need a custom domain: use the production hostname from **Vercel → Project → Settings → Domains** (e.g. `https://your-project.vercel.app`). Set **`AUTH_URL`** to that origin exactly (scheme + host, no path).

**Checklist — Vercel → Settings → Environment Variables (Production):**

1. `DATABASE_URL` — Neon (or other Postgres) URI for this deployment.
2. `AUTH_SECRET` — new random secret for production (not your dev machine value if it was ever exposed).
3. `AUTH_URL` — same as the URL testers open (see Domains above).
4. `EMAIL_SERVER` + `EMAIL_FROM` — optional if you use **Google OAuth** for everyone; otherwise SMTP for magic links (e.g. [Resend](https://resend.com)). See `.env.example`.
5. `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` — optional; see **Google OAuth** subsection above for inviting testers without a verified mail domain.
6. `BLOB_READ_WRITE_TOKEN` — Vercel Blob read/write token if you test uploads/PDFs.
7. `AUTH_ALLOWED_EMAILS` — comma-separated list of every tester (their **Google** email if they use Google sign-in). Optional: `AUTH_ADMIN_EMAILS` for the in-app allowlist UI.

Save variables, then **Redeploy** (Deployments → … → Redeploy) so new values apply.

## 3. Database migrations (production)

**First time / schema sync:** apply the current Prisma schema to the **production** database using the same `DATABASE_URL` as Vercel. From your machine (PowerShell example):

```powershell
$env:DATABASE_URL="postgresql://..."   # production URI from Neon
npx prisma db push
```

Or, if you rely on migration history in `prisma/migrations/`:

```powershell
$env:DATABASE_URL="postgresql://..."
npx prisma migrate deploy
```

Use **`migrate deploy`** for ongoing releases when you ship new migration files; **`db push`** is acceptable for early beta when you are not yet using migrate-only workflows. **Do not** run `prisma migrate dev` against production.

Optional after env allowlist changes:

```powershell
npx prisma db seed
```

(`seed` upserts `AuthAllowedEmail` from `AUTH_ALLOWED_EMAILS`; sign-in also reads the env list directly — see `src/lib/authAllowlist.ts`.)

Locally you can use:

```bash
npm run db:migrate:deploy
```

(Ensure `DATABASE_URL` is set in the environment.)

## 4. Verify after deploy (smoke test)

1. **Login** — Open `https://YOUR_ORIGIN/login`, request a magic link with an **allowlisted** email; confirm the email arrives and the link signs you in (wrong `AUTH_URL` breaks the link).
2. **Privacy URL** — Open `/privacy` (for App Store later); should load without auth.
3. **Allowlist** — Add a second tester email to `AUTH_ALLOWED_EMAILS` in Vercel, redeploy, confirm they can request a link.
4. **Calibrations** — Open **Setup calibrations**; list should load from Postgres (import script or app usage).
5. **PDF upload + parse** — Upload a setup PDF with `BLOB_READ_WRITE_TOKEN` set; confirm preview and parse/import still work.

## 5. Prisma notes

- `package.json` includes `"postinstall": "prisma generate"` so the client is generated on Vercel installs.
- Schema lives in `prisma/schema.prisma`; migrations under `prisma/migrations/`.

## 6. Known warnings (non-blocking)

- Next may log that the **middleware** file convention is deprecated in favor of **proxy**; behavior is unchanged until you migrate on a future Next version.
