# Teams — post-pilot hardening (Phase E)

Use this after the two-account pilot and the sharing matrix in `docs/TEAMS_PILOT.md` are filled in. It is a **backlog / decision log**, not committed behavior.

## Done (2026-07-26 — consent gate)

- **Invites**: ✅ `TeamInvite` model + accept/decline. `POST /api/teams/[teamId]/members` no longer creates a
  membership; it creates a `pending` invite and pushes it. The membership row is written only by
  `POST /api/teams/invites/[inviteId]` when the **invited user** accepts. Admins can withdraw a pending
  invite via `DELETE /api/teams/[teamId]/invites/[inviteId]`. Rules are pure and tested in
  `src/lib/teams/teamInviteRules.ts` (`npm run test:teams`).
  - Chose a separate model over a `status` column on `TeamMembership` so no membership row exists before
    consent — every existing membership query stays correct without a `where: { status }` filter.
  - Invites go to **existing, allowlisted** accounts only (open signup is off; the allowlist already gates
    new users). Allowlist is re-checked at accept time, not just at invite time.
- **TeammateLink**: ✅ deleted, not made mutual. It was a one-way grant any authenticated user could create
  against any email, and it bypassed `Run.shareWithTeam`. `canViewPeerRuns` / `peerAccessIsTeamOnly` kept
  their signatures, so all ~18 consumers were untouched and `shareWithTeam` is now absolute.
- **Notification**: ✅ push via `sendPushToUser` (fans out to web push **and** APNs in one call), plus
  self-hiding in-app cards on `/teams` and the dashboard for anyone without push granted.

Decisions behind the above: teams are for crews who pit together and for real named teams, so mutual
visibility is correct; accepting shares the **whole** history retroactively; leaving ends access and the
data goes with the member.

## Still open

- **Roles**: only an admin can invite or remove. Consider letting any member invite for a club crew.
- **Delete team**: no explicit delete — a team is removed automatically when its last member leaves.
- **Invite non-users**: inviting an email with no account 404s. Needs an email token + bind-on-signup if
  open signup is ever enabled.
- **Invite expiry / audit**: `pending` invites live forever and there is no audit log of joins and leaves.
- **Performance**: cap `take` on team run queries; add composite indexes if profiles show slow lists at scale.
- Sessions team view is `?teamId=`; optional dedicated route (e.g. `/runs/team/[teamId]`) if bookmarking or SEO matters.
