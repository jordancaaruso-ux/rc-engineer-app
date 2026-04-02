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
| `ACCESS_PASSWORD` | If set, enables the whole-app password gate (`/login`). Omit only for private/trusted environments. |
| `BLOB_READ_WRITE_TOKEN` | **Required on Vercel** for persistent setup PDFs and cached run PDFs; without it, storage falls back to local disk (not durable on serverless). |

See `.env.example` for descriptions and placeholders.

Optional: `OPENAI_API_KEY` (lap screenshot import), `LAP_IMPORT_USER_AGENT`, `DEBUG_ACCESS_GATE`.

## 3. Database migrations (production)

**Do not use `prisma migrate dev` in production.** After the first deploy (or whenever migrations change), apply migrations with:

```bash
npx prisma migrate deploy
```

Against production you must use the same `DATABASE_URL` as Vercel (e.g. run locally with `DATABASE_URL=...` from Neon, or use a CI step).

Locally you can use:

```bash
npm run db:migrate:deploy
```

(Ensure `DATABASE_URL` is set in the environment.)

## 4. Verify after deploy

1. **Login** — If `ACCESS_PASSWORD` is set, open `/login`, sign in, and confirm redirect to the app.
2. **Calibrations** — Open **Setup calibrations**; list should load from Postgres (import script or app usage).
3. **PDF upload + parse** — Upload a setup PDF with `BLOB_READ_WRITE_TOKEN` set; confirm preview and parse/import still work.

## 5. Prisma notes

- `package.json` includes `"postinstall": "prisma generate"` so the client is generated on Vercel installs.
- Schema lives in `prisma/schema.prisma`; migrations under `prisma/migrations/`.

## 6. Known warnings (non-blocking)

- Next may log that the **middleware** file convention is deprecated in favor of **proxy**; behavior is unchanged until you migrate on a future Next version.
