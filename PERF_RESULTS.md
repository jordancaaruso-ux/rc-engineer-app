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

### After (prod deploy `dpl_7Ko5ZAxBWAHi55KxHKYNgavhXJzw`, same laptop, 2026-07-18)

| Signal | Before | After |
|---|---|---|
| Deploy | `dpl_4g35…` | `dpl_7Ko5…` (confirmed) |
| Idle late chunks on Dashboard | ~17 scripts ~1–2s | Still ~13 (route prefetch) |
| Largest idle chunk contains Log Run (`lrWizardStep`) | yes (via idle `import` + prefetch) | **still yes** — via `router.prefetch("/runs/new")` alone (~207 KB) |
| Analysis click / longtask | — | 120 ms / 122 ms |
| → Sessions click / max longtask | 72 / **253** ms | 80 / **118** ms |
| → Engineer soft-nav click / longtask | 40 / **1463** ms | 80 / **none ≥40** ms (prefetch may warm this) |
| Engineer hard reload LCP | — | **949** ms |

### Decision

**Keep Fix A** (removed a redundant idle `import()`), but it is **incomplete**: prefetching `/runs/new` still downloads Log Run JS because `NewRunFormDynamic` is not a real code-split yet.

**Next:** Fix B — real `next/dynamic` for NewRunForm, and stop or delay `router.prefetch("/runs/new")` until hover/FAB intent.

---

## Fix B — Real code-split + intent-only Log Run warm

**Changes:**
1. `NewRunFormDynamic` → real `next/dynamic` (brief `Loading…` skeleton only until chunk arrives).
2. Remove idle `router.prefetch("/runs/new")` from `PrimaryNavProvider`.
3. Warm form chunk on intent: FAB / Add-run nav / dashboard Start-run CTA (`warmNewRunForm` + route prefetch on pointer/touch).

**Negatives considered:**
| Risk | Mitigation |
|---|---|
| Cold open flash of Loading… | Hover/touch starts download before click; end UI unchanged |
| Slower first open with no hover | Same final form; only first paint of the form may wait on chunk |
| Dashboard Link default prefetch pulled form | CTA links now `prefetch={false}` + intent warm |
| Types broken by `dynamic()` | `LogRunWizardHost` props typed via `typeof import(...).NewRunForm` (type-only) |

### After

_Pending prod deploy re-measure._
