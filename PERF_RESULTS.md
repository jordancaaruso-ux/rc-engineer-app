# Performance results

**Branch:** `perf/elite-feel`  
**Constraint:** zero functional / visual change; revert if no measurable win.

---

## Fix A — Stop idle-loading `NewRunForm`

**Change:** Remove `void import("@/components/runs/NewRunForm")` from `PrimaryNavProvider` idle prefetch. Keep `router.prefetch("/runs/new")`.

**Why it should help:** After every authenticated page settled, the shell pulled a ~5,200-line client module onto the main thread (parse/compile) even when Log Run was never opened. That contends with taps and burns memory.

### Before (prod, founder laptop, 2026-07-18)

| Signal | Value |
|---|---|
| Idle after Dashboard | ~17 script chunks requested ~1.1–2.2 s post-nav (route + form warm) |
| Sessions transition long tasks | up to 253 ms |
| Engineer first open long task | ~1463 ms (separate; may need Fix B / route split) |
| Wizard step click | 128 ms |

### After

_Pending deploy + re-measure on same machine._

Local `next build` blocked here by Google Fonts fetch failure; measuring after Vercel deploy of this branch.

### Decision

_Pending after numbers._
