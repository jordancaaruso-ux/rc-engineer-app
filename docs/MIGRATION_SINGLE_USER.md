# Migrating off the shared `jordancaaruso@gmail.com` user

Earlier builds used a single database user for everyone. After real auth:

**Check for a legacy row:** `npm run check:legacy-local-user` (or `npx tsx scripts/check-legacy-local-user.ts`).

1. **Add invites** — set `AUTH_ALLOWED_EMAILS` (comma-separated) and run `npm run db:seed` / `npx prisma db seed`, insert into `AuthAllowedEmail` manually, or use Settings → allowlist (if your email is in `AUTH_ADMIN_EMAILS`).
2. **Reuse the same row (recommended if you have data)** — before the first magic-link sign-in for your address, point the existing row at your email so Auth.js adopts it:

```sql
UPDATE "User"
SET email = 'you@example.com'
WHERE email = 'local@rc.engineer';
```

Then complete magic link sign-in with `you@example.com`. The adapter matches by email and updates `emailVerified` / session for that row.

3. **Start clean** — delete the old user (cascades) or truncate owned tables, then sign in to create a fresh user.

If you already created a **second** user by signing in first, merge manually with SQL (reassign `userId` on all owned tables from the old id to the new id) or delete the empty account and use option 2.
