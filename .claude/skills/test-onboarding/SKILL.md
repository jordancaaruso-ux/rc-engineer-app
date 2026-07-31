---
name: test-onboarding
description: Put Jordan into the app as a brand-new user with one click, to review the first-run flow (welcome overlay + "Get set up" card). Use whenever he says "test onboarding", "test the onboarding", "onboarding as a new user", "fresh account", "first-run flow", or asks to see/check/review the intro, welcome screen, or new-user experience. Mints a magic-link sign-in URL for a throwaway account — no inbox, no /login form, no real account touched.
---

# Testing onboarding as a new user

Onboarding is the one flow Jordan can't re-experience on his own account. The admin reset
(`POST /api/onboarding {"action":"reset"}`) only clears `seen` / `dismissed`, but **both gates in
[src/lib/onboarding/visibility.ts](../../../src/lib/onboarding/visibility.ts) also read `hasCar` /
`hasAnyRun`** — so on an account with data a reset shows him nothing. That's why this exists.

**Drive it yourself when you are verifying your own work** — run the app, click through, screenshot,
compare, fix, repeat until it passes. That loop is the point; a change you have not seen render is
not finished. (This reverses the old "never drive the app" rule, deleted 2026-07-31 along with
AGENTS.md: it was the single biggest thing stopping agents from checking their own output.)

Still mint the link and hand it over when **Jordan** wants to review the experience himself — his
judgement on how the first run *feels* is not something to automate away.

## The response

Run the script, then give him the URL and the click-through. Nothing else is needed from him but
`npm run dev` and one click.

```
npm run onboarding:new
```

It prints the DB host, the throwaway address, and a ready sign-in URL. Paste that URL into your
reply verbatim — it is the whole point of the skill.

- **Check the DB host it prints.** If it isn't his dev Neon branch, say so in your reply — the
  script writes an allowlist row + a token, and he should know where they landed.
- The link is **single-use** (Auth.js consumes the token) and expires in 24h.
- The `User` row is created by the adapter on the click, so the account is genuinely fresh: no car,
  no runs, welcome overlay armed.

## How it works (so you can fix it when it breaks)

[scripts/dev-fresh-onboarding.ts](../../../scripts/dev-fresh-onboarding.ts) allowlists a
`jordancaaruso+ob…@gmail.com` alias and writes a `VerificationToken` row directly, using the same
scheme `@auth/core` does: store `SHA-256(rawToken + AUTH_SECRET)`, put the raw token in the URL
(`/api/auth/callback/nodemailer?callbackUrl=…&token=…&email=…`). No SMTP, no inbox, no `/login`
form. If the callback ever rejects the link, re-read `node_modules/@auth/core/lib/actions/signin/
send-token.js` — the hash input or the provider id (`nodemailer`) has changed.

Other flags: `-- --link` re-issues a link for the newest throwaway (second device, or the last link
was burned); `-- --email=…` targets a specific address; `npm run onboarding:cleanup` deletes every
`+ob…` account and its data (matches only those aliases, never his real one).

## The click-through to give him

Order matters — each step is a gate that can regress on its own.

1. `npm run dev`, open the URL → lands on the dashboard, **welcome overlay up**.
2. Take **"Let's go"**, then **reload** — the overlay must not return. That reload is the `seen` DB
   write, the one thing `/debug/onboarding-preview` stubs out.
3. "Get set up" card leads → `/cars` → add a car → card flips to the payoff, then asks for the next
   missing thing.
4. A **green-lit chassis (Mugen MTC3)** shows the photo/PDF setup door; **Awesomatix A800** routes
   to hand-build instead. Both are worth one look if setup-row copy changed.
5. Add the setup, log a run → the card must retire itself.
6. Ingest laps → the just-in-time **timing-identity gate** fires here, outside both card gates.
7. Second pass (`npm run onboarding:new` again, fresh account): take **"Look around first"**, check
   the card still leads, tap **Ignore**, reload, confirm it stays gone.
8. `npm run onboarding:cleanup` when he's done.

## The two cheaper layers — offer them first when they'd do

Don't send him through a full account for a copy tweak.

- **`npm run test:onboarding`** (~7s, no DB) — locks the pure rules in `visibility.ts`. Those
  functions *are* the shipped gates ([server.ts](../../../src/lib/onboarding/server.ts) and
  `DashboardHome.tsx` both call them), so a rule change that isn't covered here regresses silently.
  Add a case whenever you change a rule.
- **`/debug/onboarding-preview`** (dev only, `notFound()` in production) — renders the real
  `WelcomeScreen` and `DashboardGetSetUpCard` across all 8 first-run states with fabricated props;
  `window.fetch` is stubbed for `/api/onboarding` only, so the buttons behave as shipped but write
  nothing. This is the right answer for anything visual or copy-level.

Full account drive is for what neither can fake: first sign-in, `seen` persisting across a reload,
the `/cars` → add car → card-flips sequence, and the lap-ingest timing gate.

Background: `docs/ONBOARDING_NORTH_STAR.md` — read the "How to test it" section, and note
everything below the reversal marker is retired history.
