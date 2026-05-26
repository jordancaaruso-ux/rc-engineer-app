# Performance hot paths

Budget targets (prod, typical user):

| Route | TTFB goal | Notes |
|-------|-----------|--------|
| `/` | <800ms | Hero sync; Engineer suggestions client-side |
| `/runs/history` | <600ms | Initial 40 runs; expand lazy-loads |
| `/runs/new` | skeleton <200ms | NewRunForm code-split |
| `/engineer` | skeleton <200ms | Compare tab lazy |

## Dev profiling

```bash
DEBUG_PERF=1 npm run dev
```

Logs `[perf]` spans for `loadDashboardHomeModel`, `fetchRunHistoryRows`, etc.

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

## Checklist (manual)

- [ ] Bottom nav: one today-draft fetch, instant active state
- [ ] Dashboard: loading skeleton, Engineer card non-blocking
- [ ] Sessions: first page fast, expand fetches engineer-summary
- [ ] Log run: form skeleton then dynamic chunk
- [ ] Engineer: Chat without Compare bundle until tab selected
