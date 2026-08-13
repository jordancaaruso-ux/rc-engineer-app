---
name: test-onboarding
description: Put Jordan into the app as a brand-new user with one tap, to review the first-run flow (welcome overlay + "Get set up" card). Use whenever he says "test onboarding", "test the onboarding", "onboarding as a new user", "fresh account", "first-run flow", or asks to see/check/review the intro, welcome screen, or new-user experience — including on his phone. Hands over one reusable LAN URL; no inbox, no /login form, no real account touched.
---

# Testing onboarding as a new user

Onboarding is the one flow Jordan can't re-experience on his own account. The admin reset
(`POST /api/onboarding {"action":"reset"}`) only clears `seen` / `dismissed`, but **both gates in
[src/lib/onboarding/visibility.ts](../../../src/lib/onboarding/visibility.ts) also read `hasCar` /
`hasAnyRun`** — so on an account with data a reset shows him nothing. That's why this exists.

**Drive it yourself when you are verifying your own work** — run the app, click through, screenshot,
compare, fix, repeat until it passes. That loop is the point; a change you have not seen render is
not finished.

Hand the URL over when **Jordan** wants to review the experience himself — his judgement on how the
first run *feels* is not something to automate away.

## The response

Two steps, and the second one never changes.

1. Start the dev server yourself (`npm run dev`, backgrounded) — don't ask him to.
2. Give him this, on the LAN IP the dev server printed as **Network**:

```
http://<lan-ip>:3000/api/auth/dev-new-user
```

That is the entire handover. Loading it **is** the sign-in: brand-new `+ob…` account, no car, no
runs, welcome overlay up, sitting on the dashboard. It is reusable — every load starts another new
account, so he can bookmark it on the phone and tap it again for a second pass. Nothing to mint
first, nothing single-use to burn, nothing to paste between devices.

- **The IP must already be in `allowedDevOrigins`** ([next.config.mjs](../../../next.config.mjs)) or
  the page renders and nothing is clickable. Read the list; if his current IP isn't in it, add it —
  don't hand over a URL that will silently half-work.
- **Say which database he's on.** `.env.local` is the Neon scratch-dev branch (`ep-muddy-unit`), not
  prod — but grep the host rather than trusting that line, and tell him if it's anything else.
- `npm run onboarding:cleanup` when he's done — deletes every `+ob…` account and its data, and
  matches only those aliases, never his real one. Mention it once at the end, not as a step.

## How it works (so you can fix it when it breaks)

[/api/auth/dev-new-user](../../../src/app/api/auth/dev-new-user/route.ts) creates the alias,
allowlist row and `User` row, then signs the session cookie itself via
[lib/auth/devSessionCookie.ts](../../../src/lib/auth/devSessionCookie.ts) and 307s to `/`.

Two things in there are load-bearing and easy to undo by accident:

- **It never touches Auth.js's redirect machinery.** Auth.js builds redirects from `AUTH_URL`, which
  `.env.local` pins to `http://localhost:3000`. Sign in from a phone through the real magic-link
  callback and you get signed in and then bounced to a localhost URL the phone can't reach — and a
  LAN `callbackUrl` doesn't help, because `@auth/core`'s default `redirect` callback replaces any
  origin that isn't the base URL with the base URL. Sessions are JWT
  ([auth.config.ts](../../../src/auth.config.ts)), so a signed cookie is the whole session.
- **The redirect `Location` is relative (`/`), not absolute.** Measured 2026-08-13: `request.url`
  inside a route handler reported `http://localhost:3000/...` for a request that arrived on
  `http://192.168.50.91:3000/...`, so building an absolute URL from it sends the phone home to a
  host it can't reach. A relative Location makes the browser resolve against what it actually typed.

The route is public by construction — the middleware matcher excludes `api/auth` entirely, and the
static segment beats the `[...nextauth]` catch-all. **The `NODE_ENV === "production"` 404 at the top
is the only thing keeping it out of production.** Never weaken it.

`/api/auth/demo` takes the same dev-only shortcut for the same reason (its production path is
untouched), so the demo link works on his phone too.

Skipped versus a real sign-in: only the token exchange. The allowlist row, the `User` row, the JWT
shape and every onboarding gate downstream are identical.

**For the magic-link leg itself** — or any second device where you want the real flow —
`npm run onboarding:new` still mints a single-use link on a desktop browser
([scripts/dev-fresh-onboarding.ts](../../../scripts/dev-fresh-onboarding.ts): allowlists the alias
and writes a `VerificationToken` holding `SHA-256(rawToken + AUTH_SECRET)`, same scheme
`@auth/core` uses). `-- --link` re-issues for the newest throwaway; `-- --email=…` targets one.
Its printed URL uses `AUTH_URL`, so it is **localhost-only** — don't hand it to a phone.

## The click-through to give him

Order matters — each step is a gate that can regress on its own.

1. Open the URL → dashboard, **welcome overlay up**.
2. Take **"Get set up"** (the yellow button — there is no "Let's go"), then **reload**. The overlay
   must not return. That reload is the `seen` DB write, the one thing `/debug/onboarding-preview`
   stubs out.
3. "Get set up" card leads → `/cars` → add a car → card flips to the payoff, then asks for the next
   missing thing.
4. A **green-lit chassis (Mugen MTC3)** shows the photo/PDF setup door; **Awesomatix A800** routes
   to hand-build instead. Both are worth one look if setup-row copy changed.
5. Add the setup, log a run → the card must retire itself.
6. Ingest laps → the just-in-time **timing-identity gate** fires here, outside both card gates.
7. Second pass — **load the same URL again** for a fresh account: take **"Look around first"**,
   check the card still leads, tap **Ignore**, reload, confirm it stays gone.

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

Full account drive is for what neither can fake: `seen` persisting across a reload, the `/cars` →
add car → card-flips sequence, and the lap-ingest timing gate.

**Driving it headlessly yourself:** the welcome overlay is `createPortal` behind a `mounted` guard
([WelcomeScreen.tsx](../../../src/components/onboarding/WelcomeScreen.tsx)), so it is **never in the
server HTML**. Fetching the page and grepping for its copy gives a false negative every time — use
Playwright (`node_modules/@playwright/test`, 390×844) and assert on the rendered button.

Background: `docs/ONBOARDING_NORTH_STAR.md` — read the "How to test it" section, and note
everything below the reversal marker is retired history.
