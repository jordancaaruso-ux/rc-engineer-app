# Teams — post-pilot hardening (Phase E)

Use this after the two-account pilot and the sharing matrix in `docs/TEAMS_PILOT.md` are filled in. It is a **backlog / decision log**, not committed behavior.

## Likely follow-ups

- **Invites**: `TeamInvite` (email token) or admin-only API instead of seed-only membership.
- **Roles**: promote `admin` vs `member`; restrict who can add/remove members.
- **Leave team / delete team**: lifecycle and audit log.
- **TeammateLink vs team**: either auto-create pairwise `TeammateLink` rows for backward compatibility, or remove `TeammateLink` checks everywhere now covered by `canViewPeerRuns` / `hasTeamAccess`.
- **Privacy flags**: per-run or per-membership “hide from team” if the matrix requires it.
- **Performance**: cap `take` on team run queries; add composite indexes if profiles show slow lists at scale.

## API / product polish

- `GET /api/teams` exists for listing teams; consider admin `POST` for membership management.
- Sessions team view is `?teamId=`; optional dedicated route (e.g. `/runs/team/[teamId]`) if bookmarking or SEO matters.
