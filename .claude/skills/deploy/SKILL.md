---
name: deploy
description: Checklist for putting code on beta.jrcdynamics.com or production (jrcdynamics.com). Use before any git push of main or beta, any Vercel promote or redeploy, and whenever Jordan says deploy, ship, release, push, "put it on beta" or "put production out".
---

# Deploying

Two Vercel projects share ONE production database:
- `rc-engineer-app` builds `main` → jrcdynamics.com (paying users).
- `rc-engineer-beta` builds `beta` → beta.jrcdynamics.com (sign-in limited by `AUTH_ONLY_EMAILS`).

Both builds run `scripts/vercel-build.cjs`, which migrates the production database before building.
So pushing `beta` already changes production's database. To update beta: commit on `main`, then
`git branch -f beta HEAD` and push `beta`.

## Before pushing

1. **Ask Jordan, every time.** List every commit going out (`git log --oneline origin/main..main`,
   or `origin/beta..beta`) in words about what drivers will notice. Say which commits came from
   other sessions and whether a migration rides along. Then wait for him to say "push" in that
   moment, even if an earlier plan said to push. The push-hook prompt is not his decision.
2. **Build what's committed, not the folder.** Other sessions leave half-finished files in the main
   folder, so a clean local build proves nothing about the commit. In the release worktree
   `C:\Users\Jordan\rc-engineer-release` (check `node_modules` is a real folder, not a link):
   `git checkout --detach <sha>` → `npx prisma generate` → `npx tsc --noEmit` → `npx next build`
   → the `test:*` scripts for what changed.
3. **Migrations are additive only.** If beta already serves this commit, its migrations have already
   run on production, and the `main` deploy is code-only.
4. **Engineer rulings roll-call:** `npm run engineer:rulings -- --ref origin/main` (or
   `origin/beta`). Every ruling should read `present`.

## After pushing

- Open `/api/health/version` on the site you pushed. It shows the commit and Engineer label that
  are actually serving. Say which site you checked: "on GitHub" is not "running".
- Smoke test: `/`, `/login`, `/demo`, `/privacy`, `/terms`, `/api/health/db` should all be 200. Then
  sign into the demo via `/api/auth/demo` and open Dashboard, Sessions, Engineer and Tools. Look for
  any 5xx or JS error.
- To watch a build without Vercel access: the repo is public, so
  `https://api.github.com/repos/jordancaaruso-ux/rc-engineer-app/commits/<sha>/status` needs no
  login. `Vercel – rc-engineer-beta` shows failure on every `main` push; that is normal.
- A failed build: `npx vercel inspect <dpl_id> --logs` from the release worktree, in PowerShell. The
  id is in the GitHub status description.

## Never

- Never promote a preview from the Vercel dashboard. A preview of a branch that's behind `main`
  rolls production back; this happened on 2026-08-12. To recover: `vercel ls --prod`, find the last
  `…-git-main-…` deployment, then `vercel promote <url>`.
- Never promote a `beta` deployment inside the main project.
