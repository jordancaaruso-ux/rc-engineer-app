# Teams pilot (two accounts)

This document supports **Phase D** of the teams pilot: validate mutual visibility with two real accounts before expanding product scope.

## Preconditions

- `DATABASE_URL` points at your Postgres instance.
- Apply migrations (includes `Team` / `TeamMembership`), e.g. `npx prisma migrate deploy` in each environment.
- Both pilots can sign in (allowlist / OAuth unchanged).

## Seed a pilot team (optional)

Set in `.env` (or the shell) before `npx prisma db seed`:

- `TEAM_PILOT_MEMBER_EMAILS` — comma- or space-separated emails of **existing** `User` rows (minimum **two**).
- `TEAM_PILOT_NAME` — optional display name (default `Pilot team`).

The seed script creates **one** team with that name and a `TeamMembership` for each resolved user. If a team with the same name already exists, the seed **skips** creating another team (idempotent by name).

## What to exercise (checklist)

1. **Sessions — team filter**  
   Open `/runs/history`, use **View → [team name]** (or `/runs/history?teamId=<id>`). Confirm you see members’ runs, the **Member** column, and that **reorder** is off. Expand a **peer** row: **Edit** / **Delete** should be hidden; your own rows keep those actions.

2. **Engineer — compare UI**  
   Pick a primary run, switch to **Teammate** mode: the peer dropdown should list **linked** teammates and **team-only** peers (from `/api/teammates`). Same-track filtering for their runs should match your primary’s track.

3. **Engineer — tools chat**  
   Use `list_linked_teammates` and `search_runs` with `owner_scope: "teammate"` against a team-only peer (no `TeammateLink`). Confirm `apply_engineer_focus` works when the compare run is on the **same track** as the primary.

4. **Teams tab**  
   Open `/teams` (sidebar **Teams**): create a team, add another allowlisted user by email, confirm they appear under members. Use **View team sessions** (or `/runs/history?teamId=…`) to see combined history.

5. **Run-level team sharing**  
   On **Log your run** / **Edit run**, toggle **Share this run with my teams**. When off, that run is hidden from **mutual team** lists (Team Sessions, team-only Engineer peer runs). **TeammateLink** visibility is unchanged — linked peers still see the run when using link-based flows.

## Sharing matrix (fill during pilot)

| Asset | Pilot default | Gap / decision |
|--------|----------------|----------------|
| Runs (list + detail) | Mutual team | |
| Engineer compare / search | Link **or** team + same-track compare | |
| Cars / tracks / events | Via run relations only | |
| Setup snapshots / aggregations | Deferred | |
| Privacy (hide run from team) | Per-run `shareWithTeam` (default on) | Team-only surfaces; not TeammateLink |

Capture decisions and follow-ups for `docs/TEAMS_POST_PILOT_HARDENING.md`.
