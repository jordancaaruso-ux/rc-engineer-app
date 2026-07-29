# Performance hot paths

Budget targets (prod, typical user):

| Route | TTFB goal | Notes |
|-------|-----------|--------|
| `/` | <800ms | Hero sync; Engineer suggestions on-demand (peek only until user taps) |
| `/runs/history` | <600ms | Initial 40 runs; expand lazy-loads |
| `/runs/new` | skeleton <200ms | NewRunForm code-split |
| `/engineer` | skeleton <200ms | Compare tab lazy |

## Dev profiling

```bash
DEBUG_PERF=1 npm run dev
```

Logs `[perf]` spans for `loadDashboardHomeModel`, `fetchRunHistoryRows`, etc.

## Production instrumentation

Off by default. Everything below is gated on one env var, and with it unset the Prisma
extension is never applied, `withPerfRoute` is the identity function, and the client
reporter chunk is never fetched.

| Env var | Default | What it does |
|---|---|---|
| `PERF_INSTRUMENTATION` | off | Master switch. `1` turns the whole layer on. |
| `PERF_LOG` | off | Also print each sample to the server console — how you verify without a browser. |
| `PERF_SAMPLE_RATE` | `1` | Fraction of requests written. Lower only if row volume bites. |
| `PERF_RETENTION_DAYS` | `14` | Rows older than this are dropped by an opportunistic prune. |

**Where the numbers come from**

- `PerfSample` — one row per page render or API request: total ms, DB ms, query count,
  named phases, and the 5 slowest queries. Written from `after()`, so never on the
  response path.
- `PerfClientMetric` — LCP / INP / TTFB / CLS / FCP plus soft-navigation timing,
  beaconed from the browser and the Capacitor webview to `POST /api/perf/beacon`.
- `/admin/perf` — ranks routes by p95, queries by cumulative time, and client vitals by
  p75. Admin-gated, and excluded from its own instrumentation.

**Two caveats that matter when reading the numbers**

1. **Page `totalMs` includes streaming.** A Server Component cannot set a response
   header, so page samples are flushed from `after()`, which fires once the response has
   finished streaming. Treat page `totalMs` as an upper bound; **client TTFB per route is
   the ground truth**, and it is the only signal that works on the phone at all.
2. **`Server-Timing` exists only on route handlers** wrapped in `withPerfRoute`
   (`/api/action-items`, `/api/engineer/dashboard-suggestions` today). Those also get an
   exact pre-stream total. Everything else is sampled to the database via
   `getAuthenticatedApiUser`, which covers ~155 routes with no per-route edit.

**Adding phases.** `perfSpan("label", fn)` from `src/lib/perfLog.ts` feeds both the dev
console and the production `phases` column — the ~20 spans already in the dashboard, run
history, analysis, and engineer-chat paths report for free. Cached reads in
`src/lib/cachedReads.ts` are wrapped too: a ~1 ms phase there is a cache hit, so the
hit/miss ratio is visible rather than being mistaken for a genuinely fast page.

**Verify it works** (no browser needed):

```powershell
npm run test:perf                  # pure units: route keys, header grammar, beacon payload
npm run test:perf-instrumentation  # extension + ALS + phases against the real DB
$env:PERF_INSTRUMENTATION="1"; $env:PERF_LOG="1"; npm run dev
# then watch for: [perf] page /runs/history 412ms db=310ms q=14
curl.exe -sS -D - -o NUL http://localhost:3000/api/action-items   # expect a Server-Timing header
```

If page lines log `q=0` while API lines do not, the React `cache()` carrier is not
reaching the Prisma extension — move the scope open into `requireCurrentUser` (already
`cache()`-wrapped, so it runs once, very early, per render).

## Bundle baseline

After `npm run build`, inspect `.next/static/chunks` for:

- `/runs/new` — should not include full NewRunForm in layout chunk
- `/engineer` — Compare tab split from initial chunk

Optional: `@next/bundle-analyzer` when investigating regressions.

## Cache tags (user-scoped)

| Tag | Invalidated by |
|-----|----------------|
| `dashboard-{userId}` | run save, action-items |
| `runs-{userId}` | run CRUD |
| `cars-{userId}` | car CRUD |
| `tracks-{userId}` | track CRUD |

Never cache across users.

## Engineer suggestions (LLM)

Dashboard and `/engineer` strip call `GET /api/engineer/dashboard-suggestions` on mount (**peek only** — DB cache lookup, no OpenAI). LLM runs only when the user taps **Get suggestions** (`sync=1`). Engineer chat is a separate explicit AI path.

## Checklist (manual)

- [ ] Bottom nav: one today-draft fetch, instant active state
- [ ] Dashboard: loading skeleton, Engineer card shows CTA until user asks (cached shows instantly)
- [ ] Sessions: first page fast, expand fetches engineer-summary
- [ ] Log run: form skeleton then dynamic chunk
- [ ] Engineer: Chat without Compare bundle until tab selected
