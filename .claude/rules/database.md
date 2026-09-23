---
paths:
  - "prisma/**"
  - "package.json"
  - "scripts/vercel-build.cjs"
---

# Database and migrations

- `.env.local` points at the Neon scratch-dev branch (`ep-muddy-unit`); production is
  `ep-hidden-rice`. Check the host, not the file name. Scratch-dev is a copy of production, so it
  holds real users' rows: isolated, not anonymised.
- Scratch-dev row counts say nothing about real users, because every test run piles up there. For a
  question about real users, the numbers must come from production.
- Drift repair is `npm run db:migrate:reconcile` or `prisma migrate resolve`, never `db push`.
- Run `prisma migrate` against `DATABASE_URL_UNPOOLED`; the pooled host throws P1002 lock timeouts.
- After a migration, restart Jordan's dev server: its Prisma client is stale until you do.
- Migrations must stay additive. Pushing `beta` runs them on the production database, and
  jrcdynamics.com keeps serving the older code against the new columns until `main` catches up.
