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

### After (local `next dev`, same founder session, 2026-07-18)

| Signal | Value |
|---|---|
| Idle 5s on Dashboard | **0** resource URLs matching `NewRunForm` / `components_runs` / `LogRunWizard` |
| Open `/runs/new` | Form renders (`Log your run`, Exit chrome present) — behavior unchanged |
| Engineer soft-nav (warm) | No longtask ≥40 ms recorded in observer window |

Prod before/after for Engineer cold **1463 ms** longtask is a separate cost (route JS); Fix A removes idle contention, not Engineer first-load weight. Will confirm on Vercel after push.

### Decision

**Keep.** Measurable: Log Run module no longer idle-loads; on-demand open still works.
