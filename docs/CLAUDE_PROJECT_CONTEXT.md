# JRC Race Engineer — project context

Upload this as a **Project file**, not as instructions. It's reference and current state — replace
it when it drifts rather than editing your instructions. Last updated 2026-07-26.

---

## Product

**One sentence:** replace the race notebook — help every RC driver log every run with almost no
effort, review what worked, and get trustworthy setup guidance so they learn faster lap by lap.

**Core loop, every run:** arrive at track → log a run (minimal taps, laps auto-link, setup + notes +
ratings) → review the day → ask the Engineer → apply one change → log again.

**Who for:** absolute beginner through world-class pro; solo drivers and teams. Teams may be worth
more than solo — teammates learn from each other's working setups, and collating across drivers
narrows direction at a race meeting.

**Moat:** accumulated context. Losing the app should feel like losing a notebook.

**Stack rank:** 1 lap-time ingestion / session capture · 2 Engineer AI · 3 teams · 4 community
aggregation · 5 setup compare · 6 video analysis · 7 garage & catalog · 8 iOS shell.

---

## The Engineer

> A real race engineer at your shoulder: reads your run, asks what it needs to know, and is exactly
> as confident as the evidence allows.

- **Loop:** absorb max context → understand the driver's actual words (never keyword-match) →
  diagnose an explicit causal picture, separating rubber / track state / conditions from chassis
  before blaming a knob → decide. The change falls out of the diagnosis, never the reverse.
- **Trackside** (10–15 min between runs): the read in 1–2 lines, then the call. ~150 words. One sharp
  question only if a decision-changing input is missing. Decisive, no pedagogy.
- **At home:** real back-and-forth, what-if exploration, mechanism explanations. Depth means better
  reasoning, never more simultaneous recommendations.
- Practice day → design the test that teaches the most. Race meeting → commit to the best bet.
- Failed test directions are information. Same change ≠ same effect in a different context.

---

## Physics model (the KB's spine)

**Bite/hold is a feel, not physics.** Canonical term "initial vs overall grip"; say "bite vs hold" to
drivers.

- Model as a grip curve: x = how hard you're asking the tyre (*not* clock-time through the corner),
  y = grip.
- **Bite** peaks sooner, higher, narrower, then cliffs — precise and pointy, answers every input
  including bumps and your mistakes, little warning when it lets go.
- **Hold** peaks later, lower, wider — a plateau, progressive, lets go gently. Too little bite → numb.
- Both ends hurt. The window is driver-dependent; there's no "more is better". Each axle has its own.
- **The physics is load transfer — specifically its speed.** Load transferred through the links and
  geometry is fast (bite); through the suspension — springs, dampers, ARBs — is slow (hold). That's
  geometric vs elastic transfer, and roll-centre height sets the fast fraction. It's why higher RC
  gives more bite.
- **Chain:** knobs → load-transfer path split → speed of transfer [physics] → bite/hold [feel].
- **Balance / understeer-oversteer is the output axis, not a cause node** — every parameter affects
  it. Parameters state their balance impact directly; the Engineer walks backward from a symptom.

**KB structure:** two epistemic tiers per knob — `Physics.` (invariant, flat) and `Effects.` (context
dependent, each tagged reliable / usual / situational / experimental). Plus a concept layer with
directional `[[slug]]` links. Physics-concepts get a Physics block; feel-concepts never do. No third
ranking or commonality tier — that would assert a method.

---

## Grounded extraction (how catalog data is built)

- **No source, no row.** Every entity carries a `source_url` proving it exists. Model recall is banned
  as a source; a gap is flagged, never filled from memory.
- **Enumerate against an index, not memory:** brand facets on multi-brand retailer category pages,
  plus race/spec lists, swept by region (EU / NA / Asia / Oceania).
- **Stopping rule:** stop when the last two independent indexes each add ~0 new. Log blocked sources
  (Cloudflare walls) as explicit coverage caveats.
- Retailers = discovery index (what exists). The maker's own site = source of record (the data).
- **Never gate capturing an entity on an optional attribute** — capture the entity, mark the fragile
  field unknown. Requiring an explicit asphalt/carpet label once dropped 7 whole tyre brands.
- **Cheapest checkpoint:** Jordan ratifies the ~15-row brand list *before* extraction. Right brand
  list + grounded extraction → leaf rows are correct by construction, so review is a spot-check.
- Recall demonstrably fails: two separate "that's the complete list" verdicts were each followed by a
  pass that found 7+ more real brands.

---

## Design voice

> A premium racing instrument: charcoal graphite surfaces, electric-but-confident yellow for every
> action, Sora for UI type, JetBrains Mono for data. Two voices — friendly prose to learn, mono
> instrument panel to trust. Never cold, never gimmicky.

Friendly expert + premium with a hint of competition energy — **not** dated motorsport (no checkered
flags, racing stripes, faux-carbon). Yellow `#FFD60A` on charcoal `#121110`. Mobile-first at 390px.
Trust first; one obvious next action. Visual work is restyle-only — no behaviour or API changes.

---

## Stack

Next 16.2 App Router · React 19 · TypeScript strict (`@/*` → `src/*`) · Prisma 6 · NextAuth 5 beta ·
Tailwind v4 · Capacitor 8 (iOS shell) · Vercel Blob · onnxruntime-node (local PP-OCR) · Phosphor +
Lucide.

`src/app` routes + `api/` · `src/components` · `src/lib` (~42 domain folders — the real logic) ·
`prisma/` · `docs/` north-star specs · `content/vehicle-dynamics/` locked Engineer KB · `scripts/`.
Auth = allowlist magic-link + optional Google.

Ship order: `npx tsc --noEmit` → the matching `npm run test:*` → `npx next build`. `npm run build` is
the Vercel pipeline, never local. Setup aggregations are materialized — stats changes need a rebuild
or numbers go stale silently.

---

## Current state (drifts fastest — confirm before relying on it)

- **KB rework is the critical path.** Geometry-cluster concepts are written; parameter files next.
  Rollout works by subsystem cluster, not alphabetically, because knobs are documented across several
  feel-named files.
- **The KB is nearly empty, and that's the real blocker** — not the Engineer's reasoning. With little
  to ground on it hedges and generalises. The flaw-hunt harness is parked until it's filled.
- **Monetization:** pay-to-signup, no free tier. **LIVE since 2026-08-01**; repriced 2026-08-06 to
  **Notebook AUD 9.99/mo** (logging, review, compare + 1 Engineer question/day) and **Race Engineer
  AUD 19.99/mo** (+ video, roll-centre, a 100-question/month Engineer pool spendable in bursts).
  Annual $99.90 / $199.90. Internal tier ids are still `standard`/`pro`; labels live in
  `TIER_LABELS`. A public read-only demo — a seeded driver whose data shows a believable *arc* — is
  the try-before-buy, because the value is longitudinal and a fresh trial account is empty. Testers
  are comped via 100%-off promo codes (grandfathering retired to admins only).
- **Engineer cost — MEASURED 2026-08-06 against real production usage: US$0.048/answer** (all 77
  `engineer-chat` answers in prod `AiUsageDaily`; 58% prompt-cache hit; ~42K-token average prompt,
  roughly half what the older notes assumed because the v0 KB rebuild shrank it). **US$0.097 with
  zero caching** — the number the current prices are safe against. **Video has zero AI cost** — its
  cost is stored GB forever, hence ~30-day retention.
  - Everything below this line predates the terra ship and the v0 KB rebuild; it is kept for the
    reasoning, not the figures.
  - **MEASURED 2026-07-31 (gpt-5.5, 3 bench cases, real usage):** ~**$0.18/answer**, not $0.12.
    Two errors cancelled out to roughly the right answer: `budgets.ts` priced gpt-5.5 at gpt-5's
    $1.25/$10 when it is **$5/$30** (~4x under), while every harness ignored prompt caching, which
    actually serves **~77–89% of input tokens** at 10% of rate. Both are fixed. Standard break-even
    is therefore ≈ **55/month**, not 75 — tighter than documented but not underwater. Cost per
    answer swings ~5.7x with tool-loop depth ($0.06 shallow → $0.36 deep).
  - **Model choice is now the biggest cost lever, not the prompt.** Same 3 cases, medium effort,
    normalised to 85% cache: gpt-5.5 $0.124 · gpt-5.6-sol $0.142 · gpt-5.6-terra $0.046 ·
    **gpt-5.6-luna $0.0048 (26x cheaper than today)**. Quality is founder-judged blind and pairwise
    (`npm run engineer:bench:model-pairwise`) — the gpt-4o judge saturates and cannot separate these.
- **Catalog:** 149 touring rubber tyres / 25 brands extracted and imported unverified, awaiting
  review. Cars, additives and tracks reuse the same method.
- **Asset access:** Jordan stays sole verifier, with a one-tap review queue and deliberately shrunk
  inflow (pre-seed the finite catalogs, GPS-dedup the infinite ones). Delegated verification and
  auto-promote-by-convergence are out.
- **Kept for later:** asymmetric clip sharing — upload the 2–4s sector clip, never the source video.
  Cross-driver compare is an identity problem, not a camera-angle one; one fixed trackside camera
  already contains every car in the heat.
