# Performance baseline — JRC Race Engineer

**Date:** 2026-07-18  
**Branch:** `perf/elite-feel`  
**Production:** https://rc-engineer-app.vercel.app  
**Deploy id seen on assets:** `dpl_4g35QXzAokVgrED186FZPDsoJtLi`  
**Constraint:** measure + plan only in this file; no functional/visual changes yet.

Tooling note: Chrome DevTools MCP / Playwright MCP were unavailable. Baseline uses Lighthouse CLI, curl asset sizing, and static code analysis. Authenticated INP / route timings need a logged-in Chrome session (founder).

---

## 1. Environments measured

| Surface | How | Notes |
|---|---|---|
| Prod `/login` | Lighthouse mobile (simulated Slow 4G + 4× CPU) | Harsh lab; useful for relative pain, not “feels like” on a modern phone Wi‑Fi |
| Prod `/login` | Lighthouse desktop, **no** throttle | Closer to real desktop |
| Prod `/login` | curl TTFB / HTML size | Network truth without CPU throttle |
| Authenticated app shell | Code analysis + idle-prefetch audit | Highest confidence for post-login feel |
| Authenticated INP / charts | **Pending founder DevTools pass** | See §5 |

---

## 2. Public login — numbers

### Network (unthrottled curl)

- Document: **200**, ~**47 KB** HTML, TTFB **~208 ms**, total **~216 ms**
- Server response (Lighthouse): **~20 ms** root document — origin is fine

### JS on login (transfer / raw from Lighthouse network + direct chunk download)

| Chunk (login page) | Raw size |
|---|---:|
| `0t1cupau1mtgy.js` | **226 KB** (largest; ~71 KB transfer gzip) |
| `3fs87u2_r41_n.js` | **147 KB** |
| `0cz1d0mv5g_q7.js` | **113 KB** |
| Remaining listed login chunks | smaller |
| **Sum of listed login JS chunks (raw)** | **~778 KB** |
| **JS transfer total (Lighthouse network audit)** | **~200 KB** |

Login total page weight (Lighthouse): **~409 KiB**.

### Lighthouse — mobile simulated

| Metric | Value |
|---|---|
| Performance score | **0.29** |
| FCP | 6.8 s |
| LCP | 8.8 s |
| TBT | **1,630 ms** |
| Speed Index | 12.6 s |
| CLS | 0.033 |
| Main-thread work | **4.8 s** (style/layout 1.6 s, script eval ~1.0 s) |
| Bootup time | 1.1 s (largest script eval on `0t1cupau1mtgy.js`) |

Throttle settings: RTT 150 ms, ~1.6 Mbps down, **4× CPU**. Treat as stress test, not desktop Wi‑Fi reality.

### Lighthouse — desktop unthrottled

| Metric | Value |
|---|---|
| Performance score | **0.95** |
| FCP / LCP | **1.1 s** |
| TBT | **0 ms** |
| Speed Index | 1.3 s |
| CLS | 0.005 |
| Bootup | 0.2 s |
| Main-thread work | 0.6 s |

**Read:** login is already fine on a normal desktop. Elite feel work is **post-login** (shell, nav, log-run, analysis), not the sign-in page.

### Fonts / first paint

Root layout loads **three** Google font families via `next/font`: Sora (5 weights), Space Grotesk (2), JetBrains Mono (3). Login HTML references multiple `.woff2` files. Not the main story vs JS, but worth a later weight trim if budgets stay tight.

### Hydration / client tree (login)

Login is a light client island (“Loading…” → Sign in). Authenticated tree is heavier: root `layout.tsx` always mounts `AppShell` → nav chrome → `PrimaryNavProvider` (client) for every logged-in page.

---

## 3. Authenticated app — code findings (high confidence)

### Smoking gun: idle-warm of the entire Log Run form

`PrimaryNavProvider` on idle:

1. Prefetches primary routes (`/`, `/analysis`, `/engineer`, …, `/runs/history`)
2. Prefetches `/runs/new`
3. **`void import("@/components/runs/NewRunForm")`** — pulls a **~5,200-line** client module on **every** authenticated page after idle

`NewRunFormDynamic.tsx` is **not** a dynamic import — it re-exports the full form. So “Dynamic” is a name only.

**Impact:** main-thread parse/compile + memory on pages that never open Log Run. Directly fights “nothing ever feels like it’s thinking.”

### Dual icon libraries in always-on chrome

- Lucide: sidebar / hub links / `navConfig`
- Phosphor: bottom nav, FAB, account menu, ideas dock, log-run bar  

Both sit in the shared client shell → paid on every nav paint.

### Prefetch posture

Already aggressive (good for tab feel). Risk is **JS warm**, not route RSC prefetch:

- Primary tabs prefetch (except Add run link flag)
- Idle route prefetch list includes garage hubs
- Log Run FAB uses hover/touch `router.prefetch` (OK) **plus** the idle NewRunForm module import (not OK)

### Charts / telemetry

No Recharts/Chart.js. Custom SVG (`SessionTrendCard`, `LapTimeGraph`) and video canvases. Cost is **re-render / layout**, not a fat chart vendor — verify with founder Interaction trace on Analysis + Sessions.

### Already lazy (good)

Calibration editor, setup sheet structured view, run-history modals, PDF preview inside calibration — already split. Keep that pattern; don’t regress.

### Heavy deps (client vs server)

| Likely client | Likely server (leave alone for this pass) |
|---|---|
| lucide + phosphor | onnxruntime-node, sharp |
| react-markdown + remark-* (Engineer) | cheerio, pdf-lib / pdf2json / pdf-parse |
| react-pdf / pdfjs (setup flows) | prisma, nodemailer |

---

## 4. Authenticated INP / route timing — measured (Chrome DevTools MCP → normal Chrome)

**Machine:** founder laptop (unthrottled). Absolute ms are machine-relative; rankings matter most.  
**Session:** 2026-07-18 via `user-chrome-devtools` `--autoConnect` on logged-in prod.

| Interaction | Event duration | Long tasks after tap | Notes |
|---|---:|---|---|
| Analysis → Sessions (`/runs/history`) | click **72 ms** | **253 ms**, **151 ms**, 73 ms | Over 50 ms budget during transition |
| Tab: Engineer | click **40 ms** | **65 ms**, then **1463 ms** | Worst finding — main thread blocked ~1.5 s after tap |
| Open Finish run / Log Run edit | (nav) | **140 ms**, **88 ms** | Form mount cost |
| Wizard Session → Tires | click **128 ms** | none observed in window | Under 200 ms INP-ish; above 100 ms feedback budget |
| Trace session INP (aggregate) | **126 ms** | — | DevTools insight: input 22 / proc 41 / present 63 |

**Idle after Dashboard load:** ~17 script chunk requests start ~1.1–2.2 s after navigation (many `transferSize: 0` = cache) — consistent with idle route + `NewRunForm` warm in `PrimaryNavProvider`.

Chart re-render: Session Trend on Analysis was empty-state copy (no heavy chart this session); defer chart-specific work until a day with lap trend data unless Engineer/Sessions long tasks already justify Fix A–B.

---

## 5. Ranked findings (impact × confidence)

| Rank | Finding | User-perceived impact | Confidence | Evidence |
|---:|---|---|---|---|
| 1 | Idle `import(NewRunForm)` from global nav provider | High — steals main thread after every page settles | **Very high** | `PrimaryNavProvider.tsx` |
| 2 | `NewRunFormDynamic` not actually dynamic | High — first open of Log Run + edit routes pay full cost incorrectly attributed | **Very high** | `NewRunFormDynamic.tsx` re-export |
| 3 | Dual Lucide + Phosphor in shell | Medium — parse/size on every authenticated page | High | layout components |
| 4 | Analysis / Sessions first paint (large client tables + SVG) | Medium — tab transition + scroll | Medium | sizes; needs INP confirm |
| 5 | Three font families / many weights | Low–medium — first paint on cold load | Medium | `layout.tsx` + login assets |
| 6 | Aggressive route prefetch of hubs | Low if only RSC; **High if paired with heavy client modules** | Medium | prefetch lists |
| 7 | Login mobile Lighthouse TBT under 4× CPU | Low for “elite feel” on real hardware Wi‑Fi | High numbers, **low product relevance** | LH mobile vs desktop gap |
| 8 | Engineer markdown stack | Low unless opened / on dashboard surfaces | Medium | deps + EngineerChatPanel |

---

## 6. Proposed fix plan (await approval — no code yet)

Do **one change → re-measure → commit or revert**. Prefer local `next build && next start` for A/B, spot-check prod after deploy.

### Fix A — Stop idle-loading NewRunForm (expected biggest win)

- Remove `void import("@/components/runs/NewRunForm")` from `PrimaryNavProvider` idle callback.
- Keep `router.prefetch("/runs/new")` if we still want route shell warm.
- Re-measure: Performance after landing on Home for 5s — NewRunForm chunk should **not** appear until FAB/open.

### Fix B — Make `NewRunFormDynamic` a real `next/dynamic`

- Loading placeholder must match current chrome (no visual redesign).
- First open of Log Run may show existing loading pattern only; end state identical.

### Fix C — Icon shell slim (only if A/B leave budget headroom)

- Prefer one library on always-on chrome **without** changing icons’ look (same glyphs / sizes). If a 1:1 Phosphor↔Lucide swap would change the glyph, **decline** and document.

### Fix D — Analysis / Sessions split (only if founder INP shows pain)

- Dynamic-import chart/modal pieces already partially done; extend only where Interaction trace shows >200 ms.

### Fix E — Font weight audit (last)

- Drop unused weights only if build proves they’re unused — zero visual change.

### Explicitly later / out of scope for “invisible” pass

- Optimistic UI that changes copy or loading messaging
- Virtualizing lists that change scroll physics/scrollbar behavior without proof
- Workers for SVG charts unless Interaction trace proves main-thread chart cost
- Touching OCR / setup-import WIP on other agent’s files

---

## 7. Budgets (targets)

| Budget | Target |
|---|---|
| Tap → visual feedback | <100 ms |
| INP p75 | <200 ms |
| Route transition perceived | <200 ms |
| Long task during interaction | none >50 ms |

---

## 8. Artifacts on disk (local, not necessarily committed)

- `perf-lighthouse-login.json` — mobile simulated
- `perf-lighthouse-login-desktop.json` — desktop unthrottled

---

## 9. Next step

1. Founder pastes authenticated Interaction / console numbers into §4.  
2. Approve Fix A (and B) to start Phase 2.  
3. After each fix: update `PERF_RESULTS.md` with before/after.
