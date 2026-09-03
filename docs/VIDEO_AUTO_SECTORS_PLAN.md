# Video Auto-Sectors Plan (resume 2026-08-25)

**Status:** Working plan — status audit + build sequence. **Owner:** Jordan.

The plan for resuming video analysis and getting to **automatic sectors** (every lap's sector
times detected from footage, no hand-marking) and eventually the telemetry layer. This doc is
*status and order*, not doctrine — the rulings all live in the three locked specs and are not
re-argued here:

- `docs/VIDEO_ANALYSIS_REWORK_NORTH_STAR.md` — where video lives, the analyze flow, storage (local-first)
- `docs/VIDEO_TRACE_NORTH_STAR.md` — channels, trust tiers, calibration, speed-trace phases
- `docs/SECTOR_COMPARE_NORTH_STAR.md` — driver-vs-driver aggregates, the auto-detection recipe, rollout

Everything below marked **verified** was checked by driving the app on 2026-08-25 (dev server,
Jordan's account on scratch-dev, real Chrome).

---

## Where we are (verified 2026-08-25)

Still wired in and working after the August redesigns:

| Piece | State |
|---|---|
| Run compare section (`LapComparePanel` in `RunDetailPanel`) | ✅ rendered on every run detail |
| Mobile analyze flow (`AnalyzeFlowClient`): pick → timing → lines → sync → mark → done | ✅ works end to end; July session's data intact (sector-delta preview renders) |
| Sector line sets drawn in-flow, saved per track camera profile | ✅ |
| Timing from run laps or LiveRC URL | ✅ (July session restored its laps on re-pick) |
| Video library upload + "From library" pick + durable session↔asset link | ✅ **verified end to end** — see findings |
| `/videos` tools page (recent sessions + library + worker lane) under Tools nav | ✅ |
| Ghost overlay engine | ✅ (per north star; not re-driven today) |
| Python worker (detect/track/crossings/validate) `video-analysis/` | ✅ built; desktop lane, JSON import only |
| Phone decode feasibility rig `/debug/video-decode-test` | ✅ built — measures whether a phone can feed the auto-marker |

Open items carried from the specs: real-footage trust gate on the delta surface never formally
closed; crop UI absent from the rebuilt flow; Phase C retirements (legacy overlay components) not
done; `/analysis` video door deliberately removed 2026-08-19 (run + Tools are the homes).

## Findings from the 2026-08-25 drive

### The library upload — works, and what it's for

Upload → private Vercel Blob → appears in Library → analyze flow's pick step grows a
**"From library"** option → picking it links the session durably (reopen streams the video, no
re-picking). Zero errors. **Its purpose:** the opt-in durable store under the local-first
doctrine — normally the video stays on the phone and a session only remembers the *file name*;
saving to the library is what makes ghost clips work everywhere and sessions reopen with footage
attached.

Two real limits, **both fixed 2026-08-25** after Jordan hit them ("Invalid form data" locally —
`formData()` buffering the whole body; 413 on prod — the ~4.5MB serverless body limit):

1. Upload is now **client-direct to Vercel Blob** (`src/lib/videos/clientUpload.ts` +
   `/api/videos/client-upload` token route + JSON register branch on `POST /api/videos`):
   multipart with parallel chunks and retries, live progress %, cap ~2GB (the `bytes` column is a
   4-byte Int — do not raise past `VIDEO_MAX_BYTES_DIRECT`). The server never touches the bytes,
   so the same path works locally and on Vercel. Both upload buttons (tools page + analyze flow
   save-to-library) share the helper. Verified end to end: 40MB upload with progress → library
   row → playback → seek; zero errors.
2. `/api/videos/[id]/file` no longer buffers whole files: own private blobs get a **307 to a
   short-lived presigned CDN URL** (CDN serves Range natively — verified 206s), local dev files
   stream from disk with real ranges; the old buffering path survives only as a legacy fallback.

### "Recent analysis sessions show black" — diagnosed

Both existing sessions (TFTR 7/21 and 8/11) have **no video attached — there was never anything
to play**. Local-first means the video was never uploaded; the session stores only the name
(`IMG_4044.MOV`) and expects you to re-pick the file on every visit. Uploading to the library
doesn't retroactively attach anything to old sessions either — nothing links them.

Verified: when a video *is* supplied (re-pick or library), the player is healthy on every step —
sync, mark, lines — including HEVC iPhone-style `.MOV` on desktop Chrome. So the fix is not a
codec fix; it's the **no-video state and the linking**:

### The black-video hunt, SOLVED + reproduced 2026-08-25 (do not re-litigate)

**Cause: Jordan's Chrome had hardware acceleration switched off, and Chrome ships no software
HEVC decoder.** HEVC on Windows Chrome is hardware-decode-only, so with acceleration off every
iPhone video loses its decoder. `Local State` read `hardware_acceleration_mode: {"enabled": false}`.

Reproduced exactly by launching Chrome with `--disable-accelerated-video-decode` and driving the
real flow with the real file:

| | metadata | seeks | readyState | videoWidth | error | picture |
|---|---|---|---|---|---|---|
| hardware ON | ok | ok | 4 | 3840 | none | 92% visible |
| hardware OFF | ok | ok | 4 | **0** | **none** | **100% black** |

The container opens on the **audio track alone** — hence a known duration, a correctly scaled
scrubber, and seeks that all succeed — while the video track is silently dropped. A pure-video
HEVC file errors honestly (`DEMUXER_ERROR_NO_SUPPORTED_STREAMS`); real camera footage has audio,
so it fails silently instead. `canPlayType('…hvc1…')` returns `""` in this state.

**Three traps that produced three wrong "verified" claims:**
1. `readyState`/dimensions/duration all look healthy — `readyState` reaches 4 with no picture.
2. `onError` NEVER fires; the only tell is `videoWidth === 0` after `loadedmetadata`.
3. Canvas pixel reads are not a shortcut here — and a clean Playwright profile has acceleration
   ON by default, so it can never reproduce a user's disabled-acceleration bug. **Check the
   user's actual browser config before theorising.**

Wrong turns worth not repeating: HDR/Dolby-Vision, >2GB files, deep-seek stalls on a never-played
element, and the stored-crop maths were each investigated and each disproved by measurement. An
opt-in CSS-filter "picture fix" was built on the GPU-overlay theory, shipped, **failed in his
browser, and has been deleted** — the overlay theory was wrong.

The file is entirely fine: `hvc1` HEVC Main 10, HLG HDR (BT.2020), 3840×2160, 11:50, 3.51GB, VFR
(nominal 59.94 / average 31.5 fps), five Apple `mebx` metadata tracks.

Shipped: `src/lib/videos/videoPlaybackDiagnosis.ts` — `diagnoseMissingPicture()` (called on
`loadedmetadata`, catches `videoWidth === 0` and names the acceleration setting) and
`describeVideoError()`, wired into the analyze flow and `SectorClipPlayer`. The flow previously
showed a silent black box on a black panel for any unplayable file.

- The relink state should read as "re-pick to continue", never as a dead player.
- Offer "attach from library" when a library video exists (and consider prompting to link when
  the names match).
- Caveat: HEVC decode depends on hardware on Windows browsers — degrade with words, not a black box.

**Built 2026-08-25 — local-first clips on the run page.** The compare section no longer needs an
upload to play footage: with no linked asset it shows a "pick it to watch the clips — nothing
uploads" row (named after the session's `localVideoName`), plays every ghost clip straight off the
device file, and on Chromium desktop remembers the file handle per job (IndexedDB +
File System Access API) so the next visit is one "Reopen" tap + the browser's permission chip.
iOS/Firefox fall back to a plain pick (camera roll). `src/lib/videos/useLocalVideoSource.ts` is
the reusable hook — the analyze flow's re-pick step should adopt it too (open item). Uploads are
now strictly opt-in keepers, which also settles the cost question: film 4K, analyze locally, pay
nothing. Verified on `/debug/lap-compare-preview` (attach → 3 Watch chips appear → ghost pair
plays from the blob URL, 0 errors).

Also noticed: neither session is linked to a run, so their results can never reach the run's
compare panel — the "link this analysis to a run" step matters more than it looks.

### ✅ The auto-detection truth data — RECOVERED 2026-08-26

Pulled off Google Drive to `Documents/rc-autosnap-results/autosnap-me/`: `probe-data.json`
(the six lines, the lap list, the anchor and the seed offsets), `loop-results-b22-t14.json`
(115 reference crossings), `hand-marks.json` (Jordan's 15 marks), `compare-summary.json`
(the Jordan-vs-Cooper aggregates) and `loop_eval_me.py` itself. `videoPath` in the probe file
is rewritten to this machine's copy of `IMG_4044.MOV`. The re-validation gate is closed — see
step 3 and the changelog.

---

## The build sequence

Order follows the locked sector-compare rollout; step 0 is the hygiene this audit surfaced.

### 0 — Unblock and close gates (small, do first)

- Close the **real-footage gate**: one real session through the flow, founder reads the deltas.
  (Same session can seed new truth data if the autosnap folder stays lost.)
- Fix the **no-video/relink UX** + "attach from library" on existing sessions (the "black" report).
- ~~Client-direct blob upload to lift the 4MB production cap~~ ✅ **Done 2026-08-25** (see findings).
- ~~Locate or regenerate the **autosnap truth sets**~~ ✅ **Done 2026-08-26** — recovered from Google Drive.

### 1 — Aggregation layer (`driverCompare.ts`)

Crossings (hand marks or detected — same manualJson v2) → per-lap segment times, top-5/best/median
±sd, suspect flags (>25% off segment median), ranked rails, video windows. Plus story cards +
sector matrix + basis toggle on the run compare surface. Works with hand-marked data on day one;
it's where automatic every-lap data will land. Correctness rules and reference numbers: spec §Data
pipeline (walk the complete lap list; bin by SF interval; honest not-found).

### 2 — Sector player

Tap any number → owner's clip cropped to that segment + ranked rail of your times + tap-to-ghost.
Needs a saved (library) video — another reason step 0's upload work comes first.

### 3 — **Find crossings: the automatic-sectors moment**

🟡 **Detector rebuilt in TypeScript and re-validated 2026-08-26** — `src/lib/videoAnalysis/findCrossings/`
(`geometry` · `spans` · `imageOps` · `detector` · `calibrate` · `tracks` · `refine` · `predict`),
harness `scripts/find-crossings-validate.ts` (plus `-tracks`, `-debug`, `-render`, `-sweep`,
`-matrix-test`, `-blur-check`).

🟢 **Wired into the app 2026-08-26 and driven end to end.** `browserScan.ts` (decode lane) +
`fromSession.ts` (targets in, marks out) + a **"Find the rest"** panel in `AnalyzeFlowClient`'s
Mark step. Drove the real July session in real Chrome with the real 3.5GB file: kept **one**
hand-marked lap, pressed the button, and it filled the other two laps — **10 of 10 found, median
10ms from Jordan's own hand marks, 9 of 10 within 100ms** (worst 289ms), identical to the
millisecond across two runs. Marks apply only to empty cells, so a hand mark always wins.
`/debug/find-crossings` is the standing rig that compares the browser lane against the offline
one on the July fixture.

Two browser-only findings, both measured, **do not re-litigate:**

1. **The canvas must NOT be `willReadFrequently`.** That hint moves the canvas to CPU storage,
   so every `drawImage` converts the whole 4K HDR frame in software: **93.8ms per frame with it,
   0.2ms without**, and the readback only rose 1.3→6.7ms because it covers one small crop. That is
   4 frames a second against 27 — the difference between working and seeing one frame in seven.
2. **Frames can silently stop arriving.** `requestVideoFrameCallback` only fires for frames the
   browser presents, and a tab that loses focus presents far fewer — one run collected 1332 frames
   where an identical run collected 2198, with no error anywhere. Any stretch whose frames arrive
   more than 100ms apart *in video time* is now reported as **not found**, and the panel says why.
   A gap is honest; a wrong mark is not.

Brightness is recovered from RGB here (Rec.709 weights) rather than read off the decoder's luma
plane, and the per-line calibration still chooses brightness for all five kerb lines on this
footage — so the recovery is clean enough. It is measured per line, not assumed.

🟢 **Nothing needs marking, verified 2026-08-26.** `bootstrap.ts` works out where the corners
are from the footage: read four whole laps with nothing assumed, and take the offset that keeps
repeating against **this driver's own irregular lap times**. A rival's crossings do not stay in
step, because their laps are a different length. Driven on the real session with **all 15 hand
marks deleted**:

| | |
|---|---|
| Corners found | **49 of 50** (10 laps × 5), 1 held back as odd |
| Against the deleted hand marks | **15/15 found**, median **10ms**, 13/15 within one frame, worst 53ms |
| Lap times from video vs transponder | **1ms** |
| Questions asked | **none** |

Three supports settle it without asking: how many laps agree, then — only on a genuine tie —
whether a candidate fits between its already-settled neighbours in the order the lines were drawn.
A tie that survives both is put to the driver as one tap on the right car, with the video seeked
to each candidate; it is never guessed.

**Colour identity is built but NOT proven — do not claim it works.** `carColour.ts` samples the
car at the start/finish crossings (transponder-identified, so it is the right car) and filters
wrong-colour candidates, failing safe when it would reject everything. On this footage it reported
"colour differs" for the *correct* candidates too, so it is currently deciding nothing. The cause
is the sample, not the idea: a motion blob covers where the car was AND where it now is, so an
11-pixel patch at its centre is mostly track — at the far corners it compares tarmac with tarmac.
**Next step: average only the pixels that actually moved.** Until that is measured, the screen says
nothing about colour.

Two more decode findings, both measured, both nastier than they look:

3. **A seek does not clear what is on screen.** The first frame after one routinely carries the
   PREVIOUS position's timestamp. The learning pass runs two scans back to back, so the second
   scan's first frame was already past its window's end and the pass stopped before reading
   anything — which then read as zero frames, which read as "too slow". A correctness bug wearing
   a performance bug's clothes; it cost two debugging cycles. Frames outside the range are now
   skipped until one lands inside it.
4. **A starved stretch is read again at half speed** (twice, down to 20%), rather than lost.
   Slower playback reads the same frames with twice the time per frame, and costs wall clock only
   where it is needed.

**Still to build:** the phone lane. `/debug/video-decode-test` already exists to answer "can this
phone feed it?" (its verdict copy even says: fail → run it on a computer). Desktop browser is the
spec's default; phone joins if the rig passes.

**It is no longer a port of b22-t14 — it beats it, and the recipe's fixed constants are gone.**
Measured against the same footage and the same 15 hand marks (see the changelog for the four
findings that got it there):

| | b22-t14 as ported | now |
|---|---|---|
| Lap times vs transponder | median 2.5 ms, 19/19 laps within 50 ms | unchanged |
| Jordan's hand marks | 13/15 found, all within 100 ms | **15/15 found**, median 10 ms, all within 100 ms |
| Corners found | 74/95 | **91/95** |
| Agreement with the 2026-07 probe | median 2.3 ms, 84/94 within a frame | median 1.7 ms, **94/100** within a frame |
| Crossings the probe found and this misses | 6 | **0** |
| Corner times plausible vs that line's own median | — | 87/91 (the 4 cluster on two laps, both corners shifted together — an incident, not noise) |
| Corners out of track order | 1 | **0** |

Every crossing carries how it was reached — `confirmed` (a tracked object crossed there),
`rescued` (only tracking saw it), `unconfirmed` (nothing coherent; fell back to the old
behaviour). The 5 unconfirmed corners are the same ones the plausibility check flags, so the
label predicts trouble rather than decorating it. Nothing is ever interpolated: a not-found stays
not-found.

### 4 — Heat-grid + track map tabs

Pure rendering over steps 1/3 data.

### 5 — Line overlay ("Trace lap")

Tracker v2 port (multi-track + waypoint selection + refuse-to-draw gate). Per-lap opt-in, desktop
lane, minutes per lap. Reference implementation was in a July session scratchpad — design survives
in the spec + memory `sector-compare-workflows`.

### Later — the telemetry layer (separate track, own gates)

Metric survey → meters → continuous position export → speed channels
(`VIDEO_TRACE_NORTH_STAR.md` Phases 2–3; bar is "worth the extra precision" — founder ruling:
sector deltas already deliver most of a speed trace's value). Then **Engineer integration**
(Phase 4): sector deltas as evidence tied to setup changes.

---

## Standing constraints (don't relearn these)

- Pillar-6 rule: video work slots opportunistically; it never displaces logging/Engineer fires.
- Local-first storage is **locked** — saving to the library is opt-in, never required to analyze.
- Trust is per-channel; same-video relative comparison is the near-perfect tier everything here
  rides on. No metric calibration needed for any of steps 1–5.
- No server-side worker until the pipeline earns it; the Python worker stays an import lane.

**Changelog:**
- 2026-09-03 (two clocks) — **A practice driver is placed on the video with no tap, and a lap is
  fitted whole.** From the four-driver Bendigo practice (IMG_4521, job `cmtkvgho2…`), where
  "Cooper has no sectors": his sync tap sat 35s before his session had begun. Three findings,
  three builds:
  1. **The wall clock.** A LiveRC practice page stamps the session start to the SECOND (the
     `timing.ts` note calling it minute-resolution was wrong for these pages), and a phone's
     `mvhd` stamps when recording began (`readRecordingStart` in `mp4.ts`; iPhone 14 Pro Max
     checked). Stamp minus recording start is that driver's lap 1 on the video: Justin 758.0
     (tapped 758.42), Jordan 1290.0 (1289.55), Sandy 1562.0 (1562.19), Cooper 50.0 (tapped
     14.73). `wallClock.ts` predicts; `scanLapStarts` (run.ts) reads eight 3s start-line windows
     where the opening laps are due; `fitLapsToCrossings` confirms, and must land within
     `CLOCK_CONFIRM_SEC`+0.5 of the prediction. The Sync step runs it itself once per driver per
     recording, you included (`clockTriedRef`), falls back to the blind sweep for anyone it cannot
     place, and a hand tap more than `CLOCK_DISAGREE_SEC` (2s) from the clock gets one line and a
     "Go there" button — never a refusal. `localVideoRecordedAtIso` is new on the session.
     Cooper re-scanned with his anchor at 50.0 and nothing else changed: 12 → 59 of 60 written,
     start line seen on all ten laps.
  2. **`lapFit.ts` replaces `refineByChaining` in `reviewResults`.** Jordan's lap 14: S2 was a
     12px dot with no candidate, the window took a stranger 1.4s late, the chain anchored on it
     and S3–S6 followed — with the right crossing in the pool on three of them. Each lap is now
     a small dynamic programme over the lines: gap from the previous chosen corner (per driver,
     ≥3 laps; pooled otherwise; capped at 1.2s, 2.5s from the lap start) + 0.4 × the distance
     from the driver's usual offset for the line (largest cluster, ≥3 laps) + a miss cost of 1.5s,
     so a stranger the gap likes still pays at the offset. Then a second pass: where the chosen
     corners agree on how late the lap runs (≥3 lines within 0.4s), the usual offsets are moved
     by that much and the lap re-fitted — a warm-up lap 1.3s late at every corner is judged as a
     late lap, not skipped line by line (IMG_4523 lap 1 showed exactly that with one pass). Never
     invents, never moves off a candidate, never removes a fitting pick; a row it leaves out
     keeps the window's answer for the vote. Replayed on the saved scan: the 5 recoverable held
     rows (me L14 S3–S6, Sandy L2 S6) come back at the right times; 3 genuine misses stay held;
     nothing that was right changed. A/B against the old chain (sed-swapped, same footage): truth
     grade IMG_4523 identical (18/18, median 10ms, worst 47ms, held 15 / written 87); Justin on
     IMG_4522 held 7→5, missing 2→1, written 92→95. `refineByChaining` stays for
     `find-crossings-validate.ts` and the debug page.
  3. **Direction is a penalty, not a veto.** 28–40% of candidates on IMG_4521 arrived as ±
     pairs within 60ms — the read is noisy — and the strip in `applyLineDirections` had thrown
     away Jordan's real S5 (rescued, read −) and Sandy's real S6. The fit sees every candidate
     the window saw (`evidence`), wrong-way ones at `WRONG_WAY_SEC`; rows below the fit still
     carry only right-way candidates for the field and the vote; a wrong-way pick the fit does
     not want is emptied as before (`emptiedByFit`).
  Rigs: `scripts/tmp/sheet.mjs` (contact sheets with the line drawn; `FINE=1` zooms),
  `replay-lapfit.mts` (the CURRENT review over a saved scan), `clone-with-anchor.mjs`,
  `clone-unsynced.mjs`, `session-stamps.mjs`. Not touched: the detector, the field, the vote.
- 2026-09-02 (the flow, desktop-wide) — **The steps are Set up · Lines · Sync · Scan · Compare,
  hand-marking is off the rail, and the compare is your laps against one of theirs.** The
  rulings and the build are in `VIDEO_ANALYSIS_REWORK_NORTH_STAR.md`'s changelog of the same
  date. For this plan: `dev-drive-scan.mts` now looks for the SCAN chip; the scan targets come
  from `scanLaps` (everyone's quickest ten) rather than `selectedLaps.me`; `hasMarkedLap` counts
  any whole lap of yours.
- 2026-09-02 (the file, decoded) — **The scan reads the file directly, and calibrates on its
  quietest clip.** Jordan: "Is there a better way to read the video rather than actually view
  it on the browser? … sounds like a no brainer. Build it."

  1. **`mp4.ts` + `frameSource.ts`.** A small QuickTime/MP4 index reader (moov only — a few
     hundred KB of a 300MB phone file, `moov` at either end, HEVC and H.264, edit lists,
     negative reorder offsets shifted the way ffmpeg does it) and a WebCodecs `VideoDecoder` fed
     the compressed frames for each window straight out of the file. Every frame arrives, in
     order, with its own timestamp, at decoder speed. Checked in Node against ffprobe's packet
     list on the three phone files (9745 / 8567 / 22415 samples): every offset, size, keyframe
     and presentation time exact. The old seek-and-play reader stays as the fallback
     (`PlaybackSource`) for a browser without WebCodecs or a codec it can't decode, a library
     asset streamed by URL, or a decoder failure mid-scan; `localStorage.rc_frame_reader =
     "playback"` forces it for a comparison.
  2. **The real cause of the browser's S2 holes was its calibration, not dropped frames.** With
     every frame decoded the holes were still there. The browser's four calibration clips are
     spread across the session; pooled, two busy ones (a car parked in S5's band, the phone
     being picked up at the end) lifted the 5th percentile until S1 gated at 22, S2 at 18 and S5
     at 64 — the harness's single clip had 8, 8 and 5. `calibrateFromClips`: the noise floor is
     the quietest clip's. The browser now logs `[scan] cal-clips …` per clip and `[scan] cal …`
     per line so a browser run and a harness run can be compared gate for gate.
  3. **`scripts/dev-drive-scan.mts`** presses "Find every crossing" in a real Chrome (signed in
     through the dev door, the file handed to the page) and streams the page's `[frames]`,
     `[scan]` and `[review]` lines — the check the harness could never make. The harness
     itself now builds the field (both drivers' lap starts) like the app, and takes `--cal
     s2=colour@12` and `--dump-candidates`.

  Measured, Bendigo IMG_4522 on a clean clone, the app's own button: **decoded 56s, 109 found,
  2 held, 2 missing, 0 starved** (both drivers' S1 and S2 on every lap, every S5 on the same
  pass); the same scan on the playback reader **317s** for the same rows. Before either fix the
  same button gave 92 found / 19 missing. Times agree with the harness to the frame (me L3 S2
  45.030 vs 45.03). Regressions unchanged: 4523 truth 18/18 median 10ms, 4K 15/15 ref 91/100,
  synthetic 9/10. Chrome on this PC decodes the phone's HEVC in hardware; iPhone Safari has
  WebCodecs with HEVC from 16.4. Anything else falls back to playback and says so in the log.
- 2026-09-02 (hairpin, two cars) — **A line is crossed one way, and a window offers every car
  it tracked.** Bendigo IMG_4522 again, once the rival was placed on the right lap: his S1 and
  S2 came back on a handful of laps, and his S4→S5 read 1.2s against Jordan's 2.1s.

  1. **S5 sits across both legs of a hairpin.** Frame by frame: the car crosses it heading out
     1.15s after S4 and again heading back a second later. Both are real crossings; each window
     took whichever sat nearer its guess, and the guess differed by driver. `direction.ts` gives
     each line ONE direction — a tap at the picker, or the marks an earlier scan wrote (marks
     now carry `dir`), else the majority of picks across every driver scanned, an even split
     going to "me" — and holds every row to it before the chain, the field matching and the
     odd-lap vote run. Wrong-way candidates leave the row (the full list stays as evidence); a
     row with nothing right-way is emptied for the bracket pass. The start line is exempt: it
     answers to the transponder, and a big car on a long near line throws flips both ways.
  2. **A window keeps every car it tracked.** In the browser, Jordan's S2 windows on the laps
     the rival was 1.1s behind held ONE candidate — the rival's — so the duplicate rule rightly
     left a hole; headless held both cars. `resultFromWindow` now offers tracked-only crossings
     clear of every confirmed one (0.4s), the two best-supported (≥6 observations), tagged
     `source: "rescued"`. The window's own pick is unchanged; the chain prefers a confirmed
     candidate by half a second; the field matching sees them all. Candidates and marks carry
     `source`.
  3. **A measured start line beats the drift model.** Lap 1's slow first sector read as +0.39s
     of clock drift, and the start line seen 19ms from the transponder was thrown out for
     disagreeing with that invented number. `sfStartFor` keeps a detection that agrees with the
     corrected start OR the plain walk.
  4. On the way: `reviewResults` keyed its lap times by the literal string ":" so the
     timing-vs-footage disagreement list could never find a lap time.

  Graded: S5 on the second pass for both drivers on every lap (spread 0.35s / 0.46s); the
  rival scanned with windows on the FIRST pass and the corner declared the other way turns six
  rows and lands on the identical numbers; 4523 hand marks 18/18 within 100ms, median 10ms,
  worst 47ms; 4K 15/15, median 11ms, reference 91/100, two chain moves — unchanged; synthetic
  9/10, refusals 10/10. **Trap:** `find-crossings-validate.ts` defaulted to `b22-t14` (July's
  wide zones), which read as a 91→75 regression that was nothing of the kind — it now defaults
  to the active recipe. **Not verified in the browser:** the S2 holes are a browser-only loss
  (frames the trace never sampled), so the second fix is proven by construction
  (`windowPool.test.ts`) and wants a re-scan of the job. Harness: `find-crossings-job.ts
  --dump-candidates` prints every window's flips, tracks and pool; `--dir s5=+1` declares a
  direction as the picker would.
- 2026-09-02 (far lines) — **A far line is read with less blur, and one crossing is one car.**
  Bendigo practice, 1080p fisheye, IMG_4522: the rival's S1 came back empty on every lap, and
  with it sector 2 (measured from S1). Measured frame by frame, not inferred:

  1. **At S1 the car is four pixels on a tan strip near its own tone, moving two pixels a
     frame.** The detector blurs each frame (5-tap) before differencing: the pass reads 15–24
     raw and 6–10 after the blur, against a gate of 8. Jordan's car poked over on 8 laps of 10,
     the rival's on none (6–7 every frame). S2 and S5 are the same length and work — S2 is on
     blue carpet and the car moves ten pixels a frame there; frame differencing measures change,
     so its signal shrinks with speed. Length was never the problem (Jordan: "they're short
     because that's what the track looks like at that point").
  2. **The blur is chosen per line** (`blurKernelFor`: 5-tap from 40px, 3-tap from 16px, none
     below), and **the gate is measured under that blur** (`calibrate.ts` takes the kernel).
     The floors (8 colour / 5 brightness) stay: a gate of 3 was tried and moved S3 33ms late on
     every hand-marked lap — the floor is what keeps a fast near car's blob crisp, not the
     sensor's noise.
  3. **Stolen crossings no longer vote.** Every S1 the rival was handed was Jordan's car to the
     millisecond; the field matcher labelled them but they still sat in the plausibility sample,
     and four stolen times outvoted his two real ones (2.24s, 2.33s — where everyone's S1 is).
     `dropCrossDriverDuplicates` removes the other driver's copy of one event before the vote.
  4. **Built, graded, and left OFF:** comparing each pixel with the learnt empty track
     (`motionMaskInBandBg`, `bgGateMultiple`). Its signal does not shrink with speed and it saw
     the one lap the blur change still misses (a car crawling through S1 at the noise floor).
     But it invents crossings where a car stops in the band — median start, learning only from
     real change, and requiring a blob to contain real change all reduced it and none removed
     it — and doubled the rows held back. Kept behind the knob for the harness.

  Graded: rival's S1 **0 of 9 → 16 of 17** laps, fifteen within four tenths; the 18 Bendigo hand
  marks (IMG_4523, scanned blind) 18/18 within 100ms, median 10ms; the 15 4K hand marks
  15/15, median 11ms, reference agreement 91/100 within a frame (was 94) with 7 more corners
  found than the reference; synthetic suite unchanged. Harness: `find-crossings-job.ts` grew `--truth`
  (grade against frozen hand marks, their laps scanned blind), `--role`, `--seeds`, `--no-marks`,
  `--debug-targets`; `crossings-truth.mts` freezes hand marks to `data/crossing-truth/`.
  Traps met on the way: a job whose anchor was re-synced to another lap leaves every mark two
  laps stale (the walk still keys them by lap number); the script had been handing the rival
  Jordan's anchor. Tests: `crossDriver.test.ts`, `imageOps.test.ts`.
- 2026-08-28 (sector board) — **The Done step is the video, then ONE table.** Five artifact
  rounds after "this whole workflow is just bad… I don't know what I'm looking at": the matrix +
  story cards + chip picker + second (lap-vs-lap) video are gone. What replaced them is the lap
  sheet's grammar ("a base that's blank, and an overlay that's coloured, never more than one
  table, only one driver's table at a time"): BASE = you, flat, as a chip (top-5 average / best
  lap / same lap number); OVERLAY = one driver or None; rows = that driver's laps, cells = gap to
  the base tinted with `getDeltaStyle` on `resolveDeltaTintRange` (the lap sheet's scale), actual
  time small underneath; footer = Best sectors vs your best, Top-5 avg vs your average; a
  FASTEST line = one chip per sector naming who holds it on the average (tap → they become the
  overlay with their best through it loaded). Tap a sector cell → that sector; tap a lap time →
  the whole lap, sector lines as ticks on the scrubber (`SectorClipPlayer` `ticks`); the
  overlay is solid and the base is the ghost every time, with a Swap. An average has no footage,
  so its ghost is your clean lap closest to it (`ghostClip`). Lib additions in
  `driverCompare.ts`: `lapRows`, `bestLap`, `baseValues`, `baseLapTotal`, `ghostClip`,
  `sectorLeaders` (tests in `test:driver-compare`); `storyCards` stays in the lib, unused by the
  screen. His rulings along the way: averages for everyone, one basis; per-sector RANKING
  beat the grid ("I don't know how to find who's the best here"); then the VRS stint analyzer
  he pasted (rows = laps, columns = sectors, colour = delta to one reference) beat the ranking;
  video at the top, table below. Driven on `cmtc6i07e` (plumbing only — its figures are junk):
  the player opens on the overlay's quickest lap with anything on it even when no lap is clean;
  a lap with a missing crossing is a lap with a hole, not a doubtful lap. Shot rig:
  `scripts/dev-shot-sector-board.mjs` (rest / tap / None at W=1440 or 390). Production build
  run after, clean. Then "red should always be user is slower": every gap on the sheet and
  under the player is read from HIS side (base − theirs; positive = he is slower = red), the
  footer sums too; the caption says so.
- 2026-08-28 (automatic) — **The picker decides for itself wherever "your car" and "the corner"
  agree, and only asks where they don't.** From the first saved `lastIdentify` (his Test A3
  session, lap 12): S3 pre-picked his OWN car at 10.79s (kept step 2/2 — through the S3 pixels
  on another part of the lap) over the real 3.61 inside the field's window; S4 pre-picked the
  hairpin's return pass (7.81, on the 14px line) over the real 6.38 ("beside" it); S1 offered
  one car and still asked; S5/S6 were right and still asked; "moves with Sandy, 10s" was
  reachable under Show more. His ruling on the 14px S4: "that's just how wide the track is."
  - **Evidence order, now enforced:** the field's corner cluster (where + WHICH WAY) says what
    the corner is; kept-step says whose car it is; geometry (on/off the drawn line) is the
    weakest and is silenced on lines shorter than a car. Six rules in `identify.ts`:
    1. Field window beats kept-step — no exemption; a kept-step car outside it is "yours —
       later in the lap, not this corner".
    2. Corner direction from the field (`FieldWindow.dir`, ≥75% of a cluster's crossings
       agreeing, `ReadWindow.dirs`); a crossing the other way is `wrongWay` → folds
       ("crosses the other way to the field"). Caught Tim's return pass at S3 on IMG_4480.
    3. One car left inside the field's window is picked (`defaultPicks`); "only one left"
       stays worthless without a window.
    4. Ruled out twice over (`foldReasons(o).length ≥ 2`) → `dropped`: not shown at all, not
       counted, kept on the record.
    5. Every line decided → no picker: `runIdentify` cuts the pictures, then calls
       `scanFromIdentifiedCar(picks)` straight away; the review says "picked on every line
       without asking — Check the pictures" (opens the picker). Lines the screen decided show
       their pick alone with "Show N more"; undecided lines show what is left.
    6. Five laps read (`EXTRA_LAPS` 4). Which broke "every lap": with four other laps one
       missed detection failed his own car (3/4) and emptied the field learner. `enoughHits`
       = all up to three, three of four beyond (`keptStep`, `ownersOf`).
  - **Geometry on short lines:** `ON_LINE_SLACK_PX` 24 — along-line slack is max(20%, a car's
    length ÷ line length), so a 14px line never calls anything "beside"; direction decides.
    The detector's band is untouched: its 30px is ACROSS the line (the car's travel), and it
    only reaches 35% past the ends — the box was never the problem, the judging was.
  - Driven on IMG_4480 lap 12: S1 5→1 picked (3.90, 3/4), S3 7→1 picked (6.61), S2 and S4
    ask — each has TWO cars keeping his step 4/4 about 0.45s apart (a car on his tail on his
    lap time, or his car twice). The auto-skip path (all lines decided) is typechecked, not
    yet seen live — this footage never decides all four.
- 2026-08-28 (driver compare) — **Steps 1 and 2 built: driver-vs-driver sector compare with the
  ghosted sector player, for several drivers.** "Pick a few drivers and get the best or average
  of each sector… then you're not judging on an outlier… who did the best of this sector, click
  on it, and watch how they did it." Interview (same day): headline = me vs each driver's
  **top-5 average** (spec ruling stands), best lap on the toggle; drivers nobody tapped are
  **shown, marked lower-trust**; the "why" is the **ghost** (the driven-line overlay was never
  built — a July scratchpad only — so nothing to re-test); accuracy work deferred in favour of
  the surface.
  - `src/lib/videoAnalysis/driverCompare.ts`: `segmentDefs` (SF→S1→…→SF), `segmentStats`
    (per-lap segment times with video windows; >25% off the driver's own median = suspect,
    kept out; top-5 mean of the fastest clean, best, median, sd), `storyCards` (ranked by |Δ|,
    template sentences, even within 0.02s), `buildCompareDrivers`: me + competitor from marks
    (`compareCarsFromManualSession`), **everyone else from `lastScan` replayed through
    `assignToField`** — `FieldAssignment.fieldCrossings` (new) is every crossing the matching
    gave anyone; a rival's lap is on the video clock by `predictSfStartTime`. Partial by
    nature (only what fell inside the scanned drivers' windows) and `trust: "assigned"`.
  - `DriverComparePanel` on the Done step above the lap compare: basis toggle, driver chips
    (confirmed rival pre-selected, ⚑ on assigned ones, lap counts), story cards (top 4),
    matrix (rows = sectors, cols = you + selected; cell = figure + Δ vs you, green/red), tap
    any figure → `SectorClipPlayer` with that driver's best clean lap through the sector and
    YOUR best as the ghost (your 2nd best when you are the one watched), plus their laps for
    that sector fastest-first with ⚑ rows struck out. Wide layout = sticky player column.
  - Verified: unit tests (`test:driver-compare`), `scripts/dev-driver-compare.mts` (the
    matrix as text for any job), Done-step tap screenshot on IMG_4480. That job's figures are
    junk — its marks predate the line renumbering — the plumbing is what was checked.
  - Layout (same evening, "the video should take up basically the whole screen… two videos,
    which I don't really understand"): the Done step is ONE player the width of the main
    column (sticky) with the compare as a 400/440px column beside it; the lap-vs-lap
    `LapComparePanel` and its second player came OFF the Done step (still on the run's Video
    section). Nothing tapped = the biggest-edge sector plays, from whoever owns it.
  - Not built: sector player half-speed control (SectorClipPlayer has none), heat-grid and
    track-map tabs (step 4), driven-line overlay (step 5), "scan another rival" for full
    rather than partial data on a third driver.
- 2026-08-28 (hairpin) — **A short line at a hairpin sees the same car twice; the picker now
  knows which pass is the corner.** "For sector four it got it wrong. It said 'on 2 of 2 your
  laps'… it was on a 180 hairpin, on the way coming back, past where the sector should be." His
  S4 on Test A3 is ~14px tall; the detector's strip is 30px wide across it, so the return leg
  registers too, keeps step with his timing every lap just like the real one, and the
  morning's "kept step ⇒ never fold off-line" exemption kept it alive — picked, when the
  outbound pass was the one not seen cleanly. Three changes:
  - **Direction** (`CrossingEvent.dir`, also on `TrackCrossing`): the sign the car ended on.
    Free — a crossing IS a sign flip. Saved with every candidate (`ManualScanCandidate.x/y/dir`).
  - **`settleLineShape`** (identify.ts), per line, last: a kept-step car beside the line is
    `shortLine` (shown + "lengthen the line" nudge) ONLY when no car ON the line kept step;
    otherwise it folds as off-line. Two kept-step cars on the line, opposite directions, within
    `HAIRPIN_SEC` (3s) are `hairpin`: shown, neither pre-picked, note "Two passes at a hairpin —
    tap the one on your sector", caption "one way / the other way at the hairpin".
  - **`manualJson.lastIdentify`** (`ManualIdentifyRecord`): every option the picker offered with
    every verdict, what was pre-picked, and (`chosen`) what went to the scan. The session that
    prompted this saved nothing — the fault was argued from a description.
  - Driven on IMG_4480 (not his footage — IMG_4483 is not on disk): every line unchanged from
    the morning; S4's two "yours" at 7.87/8.26 cross the SAME way 0.39s apart, so not a hairpin
    there (same car twice, or a twin) — still no pre-pick, still the driver's tap. Unit tests
    cover the hairpin, short-line, same-way, too-far, no-direction and rival cases.
- 2026-08-28 (the field) — **The picker learns where the field crosses each line, and beside
  the line is no longer across it.** "A car is detected crossing a line even when it doesn't
  meet up with it… the options are one that very clearly makes sense based on the time and one
  that doesn't. Why can't it figure that out?" Two answers, both in `identify.ts`:
  - **The field window** (`fieldWindowsFor`): every crossing in every window read, on every
    line, is asked whose timing it keeps step with (`ownersOf` — ALL drivers whose laps predict
    it on every other window; over three laps of a club heat two cars on matching lap times
    both fit, and that is kept, not resolved). Each answer is "this line comes N seconds into
    that driver's lap". Pooled per line and clustered (1.0s link), a line has the corner's
    cluster AND, on a fisheye, the other piece of track under the same pixels — on IMG_4480 S1
    had one at three seconds and one at sixteen, both with real drivers behind them. **Track
    order tells them apart**: the chain of clusters climbing line to line by ≥0.3s per line
    with the most drivers behind it is the field's lap (small DP; skipping a line is free).
    Window = cluster spread ± max(1.0s, 20%); needs 2 drivers (one is usually the driver
    themselves — 3 left most lines empty). Options outside fold as "field crosses at a–b s";
    a car that kept step every lap is never folded by it. Learnt only from crossings ON the
    line. Two dead ends on the way, both driven: a min–max span over every driver (windows of
    2–17s — the beside-the-line cluster), then an outlier rule + "unique owner or nothing"
    (every line empty — ties are the norm, not the edge).
  - **Off-line folds** (`foldReasonFor` → "off-line"): the line is where the driver said the
    corner is. The one exception is a car that kept step with them every lap: it stays, and the
    line gets "Your car crosses past the end of the S4 line on every lap read — lengthen the
    line in Lines" instead of the right answer hiding under Show more.
  - Driven on IMG_4480 / TFTR Fisheye, lap 12: S1 5→1 (3.90 alone; field 2.8–3.9), S2 6→3
    (5.30 picked), S3 7→1 (6.61 picked), S4 5→2 (7.87 and 8.26 both "yours" — the same car
    twice or a twin on a matching lap time; not touched). The detector's `extend` (0.35) is
    unchanged — the strip still reaches past the line, the picker just no longer believes it.
  - Not on disk: IMG_4483 (his Test A3 session with the 0.67/5/11 S1) — the drive above is the
    other recording of the same heat.
- 2026-08-28 (six options) — **The picker rules out what the timing can rule out, and picks
  where it is sure.** "It gives three options going into S1 — 0.67s, 5s and 11s. How would I
  ever be crossing that line at five or eleven seconds? That seems like something you could
  determine for yourself." He was right, and each check is now a word under the picture:
  - **Track order** (`orderFlags`): lines are numbered in the order the car meets them; each
    corner needs `MIN_SECTOR_GAP_SEC` (0.3s) after the one before, and the last needs it before
    the lap ends — with one gap per line still to come. Judged against ANCHORS: a line with
    exactly one car that kept step with the driver on every other lap read. Two such cars on a
    line (nose to tail) anchor nothing; anchors that contradict each other are all dropped. A
    first cut chained through every line and one missed detection made two other cars "S4",
    after which the real S1 was declared out of order — pulled. The driver's own taps narrow the
    rest live ("after your S2 tap"), and taps that contradict each other get a warning naming
    both, with "or the lines are numbered out of order — fix that in Lines".
  - **Beside the line**: the detector's band runs 0.35 past each end of the drawn line; a crossing
    more than 0.2 past an end is captioned "beside the line". A caption, not a fold — on the
    Boronia footage the driver's own car crossed the short S4 line just past its end every lap.
  - **Pre-picks** (`defaultPicks`): only the one car per line that kept step every lap. "The only
    car left" is not evidence — a lone unlabelled leftover at 0.87s was picked as S3 that way.
  - A picked car is never folded (the picks were hiding behind "Show more" and the driver was
    shown leftovers — which looked exactly like a stale build, and cost a needless dev-server
    restart before the `[scan] picker` console line told the truth).
  Driven on Boronia with the lines in track order: S2 6→3 with the pink car pre-picked (5.30s,
  on 2 of 2 laps), S3 7→3 pre-picked (6.61s), S1 5→2, S4 all shown with reasons because the
  real S4 crossing was not detected on that lap. With the lines numbered OUT of order the two
  pre-picks contradict and the warning says so. The same set must be in track order for the
  compare's cumulative splits anyway.
- 2026-08-28 (reverting lines) — **An unsaved drawing survives the page.** "I just created new
  lines that are accurate, and now they're not — it keeps reverting to an old one." The database
  was never wrong (every save he made is there, geometry checked); the drawing he had NOT yet
  saved lived only in React state, and each hot reload — code saved into the dev server he was
  using, a `next build` sharing its `.next` — remounted the flow and put the last saved set back.
  Reproduced the whole edit → save → reopen → reload path and the "+ New line set" path headless:
  no revert in either. Built: `draftLines` is mirrored to `localStorage`
  (`rc_lines_draft_<jobId>`, cleared on Save and Cancel) and restored once the video is back on
  screen, with a line saying so (and a warning when it was started on a different set).
  `scripts/dev-check-draft-restore.mjs` proves it: draw, reload, same coordinates back.
- 2026-08-28 (Justin) — **The picker asks the whole field's timing, and the scan refuses to
  write a car it could not follow.** Second real race session, competitor switched to Justin:
  the compare read "gained 8s in S3, lost 8s in S1". Replay: every mark written for Justin sat at
  a constant offset from **Sandy's** lap starts (±0.02s) and drifted 0.75s a lap against Justin's
  own — the driver had tapped Sandy's car for Justin at the picker (and Justin's start-line
  anchor, 72.84s, is Sandy's lap-1 finish to the frame). The field's timing knew and nothing
  asked it; the offset rule saw no cluster on Justin's rows and, by design, held nothing.

  Built, on "we should be able to use the median sector time per driver, or per race, to narrow
  the search — it should never be six options":
  - `collectCarOptions` reads the identify lap **and the two laps either side of it in the time
    order** (~55s of video instead of 18s). For every car on the identify lap, `movesWithFor`
    takes its offset from each driver's lap start and asks, on the other two windows, whether a
    crossing turned up where that driver's timing put it (±0.35s). The driver with the most hits
    is the answer; a tie that includes the asked-about driver says nothing (a rival nose to tail
    keeps step with both timings for a couple of laps — that is the picture's call). Each picture
    says "on 2 of 2 your laps" or "moves with Sandy"; cars that move with somebody else, or the
    colour rules out, are **folded** behind "Show N more the timing puts with other drivers" —
    never all of them. Driven on Boronia: S1 5→3, S2 6→4, S3 7→5, S4 5→4, the pink car labelled
    on every line it was seen on. A tap on a folded-class car names whose laps it keeps step with.
  - `flagImplausible` now also clusters **per driver and line**: enough rows to expect agreement
    (≥4) and no three within 0.35s → hold every one of them. The review says "Couldn't follow
    Justin's car at S1, S2… — nothing there repeats lap to lap; run 'Show me the cars' again."
  Not changed: the competitor's start-line anchor is still detected nearest, which is how it
  landed on Sandy's car — predicting it from the race start (own anchor − own fragment + their
  fragment) would be exact; candidate follow-up.
- 2026-08-28 (now what) — **The compare is on the Done step, and a line set asks before it
  moves under other sessions.** Two things the first real race session ran into after the
  marks were added.

  **"How do I analyse me vs Sandy?"** — there was no screen. The lap compare
  (`LapComparePanel`: total delta, lap A vs lap B with the second lap settable from another
  car, sector gain/loss cards, tap a sector for the ghosted clip) lived only inside a run's
  Video section, and an analysis started from Tools has no run; the Done step said "link this
  analysis to a run" with nothing to link it with, and there is no run for the Boronia race
  anyway. `LapComparePanel` now takes `jobId` directly (no run needed, no "Open session" link to
  itself, clips play from the footage the flow already has open via `clipUrl`), and the Done
  step renders it in place of the old preview box. Two defaults were wrong for a race and are
  fixed for the run's Video section too: the opening fragment (1.663s from the grid to the
  line) was the "best lap" — `compareCarsFromManualSession` now drops it with the scan's own
  `realLaps` rule — and the default pair is now the two quickest laps that CARRY sector
  splits, since a best lap with nothing marked can only say "whole-lap delta only". The
  driver-vs-driver matrix in `SECTOR_COMPARE_NORTH_STAR.md` is still not built.

  Then, on "optimise the comparison page for desktop": the job page takes `tools-wide` (the
  dashboard's 110rem measure and gutters), the Done step drops its phone-width cap, and
  `LapComparePanel layout="wide"` puts ONE big player first — the video's own shape
  (`SectorClipPlayer fit="window"` reads the aspect off the metadata and caps the box by window
  height, the marking flow's trick), sticky beside a 400–440px column of hero + cards. The cards
  drive it: the biggest sector plays by default, a tap swaps the clip, the playing card is
  outlined. Below lg the player simply sits first in the column. The run's Video section keeps
  the stacked layout.

  **"The lines still move — half a track width from where I put them."** A line set is
  shared by every session on that track that points at it, and a new session silently takes
  the track's most recently touched set. Redrawing lines for a clip filmed from a slightly
  different spot moved them under the earlier clips too, three times over. Worse, this
  session had been created under the **TFTR** track, so its "TFTR Fisheye" set — a TFTR
  camera set — now holds Boronia lines (redrawn 2026-08-27 23:55). Now: the profiles API
  returns how many sessions read each set, the Lines step shows it ("5 corners · 2
  sessions"), and **Save lines stops when the set is shared** and offers "Save as a new set
  for this video" (creates `<set> · <clip name>`, moves this session onto it, saves there) or
  "Update <set> for every session". The line geometry itself was checked and is sound: drawn,
  stored and read against the painted frame (`contentRect`), not the letterbox.
- 2026-08-28 (his run) — **The picker showed three pictures of six, and the whole scan was
  built on a white car.** Jordan ran the 19-of-19 build on the same footage himself and got 32
  ready / 45 held back / 3 not found. Replaying his saved scan (`lastScan`) showed why: on most
  lines, for BOTH roles, the car whose offset the scan learnt was grey/white (chroma 0.34/0.32),
  not the pink car (0.41/0.30) or Sandy's red one (0.44/0.26). The learnt offsets, the per-line
  colour references and the plausibility clusters all followed that car; the field then gave
  "his" S4 rows to Justin, which was very likely correct. Cause: the "Which one is your car?"
  strip was `overflow-x-auto` with the scrollbar hidden, and in the 320px side column three
  104px pictures do not fit — he saw two and a half of six and tapped what he could see. The
  graded run never met this because the rig fed the picker truth offsets. A wrong tap at that
  door is invisible to every rule after it; the door needed its own check.

  Built: the picker is a three-column grid (every car visible, "S2 · 8 cars"), and
  `collectCarOptions` also reads the start line on the driver's quickest four laps — half a
  second either side of a transponder fact, so the colour learnt there is this car's without
  anybody's tap. Measured on Boronia: at the start line the pink car reads 0.488/0.307 with a
  scatter of 0.003 and the rivals seen beside it sit 0.144 away; but the SAME car at the corners
  reads 0.41–0.45, i.e. 0.04–0.09 from that reference (nearer the camera at the line, more car
  and less tarmac in the blob), which is as far as Sandy's red car (0.07). So the start-line
  colour can tell a colourful car from a grey one — the exact tap that went wrong — and cannot
  tell pink from red, and the hint (`hintFor`) says only that: "different colour" when a picture
  is at least ¾ of the rivals' measured distance from the reference and never under 0.10;
  "looks like yours" only inside the reference's own tolerance, which after that shift is rare.
  A first cut used the reference's tolerance directly and stamped "different colour" under the
  pink car at S2, S3 and S5 — pulled before it was ever shown. A note under the pictures names
  any line whose tap the hint disagrees with. The review's "read on brightness alone" line was
  also reworded: it was about spotting movement, and beside "your car's colour told it apart"
  it read as a contradiction.
- 2026-08-28 (last) — **A slow lap is not a wrong lap.** `flagImplausible` gets a second
  opinion by segment: a row the lap-start-offset rule doubts is kept when its gap from the last
  TRUSTED corner before it on that lap (the lap start, or a corner the offset rule passed — never
  another doubted one, or a rival's chain would vouch for itself) matches that gap's largest
  cluster on the other laps, ±0.35s. A slow lap in traffic pushes every later corner away from
  its usual offset from the start while the corner-to-corner gaps barely move; a rival's crossing
  is off both ways. Replayed on the saved scan first (`dev-replay-plausibility.mts` now reads
  `lastScan`, held rows included): the held L12 S5 — 3ms from truth — is released, and the nine
  still held are all rows the field had named as rivals'. Then the blind scan:

  | | + A, B, C | + segment rule |
  |---|---|---|
  | Wrong car · false positives | 0 · 0 | **0 · 0** |
  | Real crossings found | 18 of 19 | **19 of 19** |
  | Held back that were yours | 1 | **0** |
  | Median · worst | 36 · 50ms | **33 · 50ms** · 10 of 19 within one frame |

  Every row now held back is a named rival (10) or an untracked flicker (1). Graded clone kept
  for replay: `cmtc5kkb60001vl0cr6y0swuf`; the earlier one deleted.
- 2026-08-28 (later) — **The scan keeps its evidence, rivals learn their own corners, and colour
  earns a say — per line.** Three follow-ons to the field matching, on "do a, b, c":

  **B — a scan saves what it saw.** `manualJson.lastScan` (`ManualScanRecord`) holds every row
  of the last automatic scan — found, held back and missing — with every candidate the window
  produced and each candidate's colour; a mark written from the detector carries its `source`
  and `candidates` too. `scripts/dev-replay-field.mts` is now a true replay (same inputs the
  review had), seconds instead of a 7½-minute decode. It is not bit-identical to the live pass:
  the live pass learns offsets from the pre-field rows, the replay from the saved (post-field)
  ones, and on a genuine near-tie the two can pick differently.

  **A — each rival learns their own offset** (`field.ts`, second pass): the timing-only first
  pass hands every rival some crossings; the offset those repeat at (largest cluster, ≥2 laps)
  is theirs, and the line is re-solved with it. On Boronia the rivals' S3 offsets came out
  7.97 / 8.05 / 8.55s against a pooled 7.86 — Paul's line into S3 is seven tenths later than
  ours, which is exactly the margin where "same offset as us" could not call it.

  **C — colour that is the car, learnt where the car is alone, per line.** `detector.ts` now
  keeps a per-window RGB background, updated only where nothing moves, and samples a blob's
  colour from the moving pixels that differ from it — the car, wherever in the smear it sits —
  instead of an 11-pixel patch at the smear's centre (mostly tarmac). Measured at the truth
  crossings: 293 of 294 candidates carry a colour; the pink car reads rf 0.406 / bf 0.302 with a
  median scatter of 0.009; the red car 0.436 / 0.262 — **0.050 apart, 5.4× the scatter**; the
  other cars 0.060 away. But the same car reads a different colour at different corners (S4 vs
  S5: 0.05, as much as pink-vs-red), so one reference learnt at the start line would mis-call
  our own S4. Hence per line: the first pass's assignments give each scanned driver their
  crossings at that line — that colour is the car THERE — and everyone else's say what "not this
  car" looks like there; only when those sit ≥2 scatters apart (`colourUsable`) does colour price
  a pairing (a slot pays for a candidate that clearly is not its driver's colour; a rival's slot
  pays for one that clearly IS ours) and move the burden of a claim (clearly not ours → given
  away wherever the matching put it; clearly ours → needs 0.6s of timing to lose). The
  start-line reference (`carColoursFromLapStarts`, per role, samples only where no other car
  crossed within 0.25s, with `separation` measured against those that did) still feeds the
  detector's own tiebreak, now per role — Sandy's windows are no longer judged against
  Jordan's paint. The review names the lines where colour had a say.

  Blind scan, wiped clone, same picks at the picker, graded against the truth set:

  | | field only (earlier tonight) | + A, B, C |
  |---|---|---|
  | Wrong car / moment written as fact | 0 | **0** |
  | False positives on the no-crossing row | 0 | **0** |
  | Real crossings found | 17 of 19 | **18 of 19** — L12 S4 now **2ms** from truth, swapped onto the right car |
  | Held back | 2 (both rivals) | 1 — L12 S5, which sits **3ms** from truth and is held by the plausibility rule because the lap was 0.4s slow |
  | Median · worst | 36 · 50ms | 36 · 50ms |
  | Named as somebody else's | 6 rows | 9 rows (Sandy's L2 S1/S2 now too), plus 2 swapped |

  The replay on the saved scan agrees with the truth set on every row it covers and additionally
  names Jordan's whole lap 2 (in the pack from the start) and L7 S4/S5 as Chris's / Justin's,
  offering alternatives that sit where a lap 0.6s slow would put them. No truth for those laps.

  Two honest limits. The plausibility rule (`flagImplausible`, ±0.35s from the line's own
  cluster) now holds back a crossing the field placed to 3ms — a slow lap in traffic looks "odd"
  by lap-start offset when it is not odd by segment time; the next change there is to judge by
  the gap from the previous found corner as well. And `dev-check-crossings.mjs` cannot grade
  corners on a race: its noise floor is the driver's own lap-to-lap variation at that corner
  (±0.3s in traffic), so its alternating ±300ms rows on S3–S5 are the driver, not the
  detector; it remains exact for start/finish. The truth set is the authority.

  Clone kept for replay: `cmtc4r84q0001vlq0ycnq57zg` (the graded run, with `lastScan`).
- 2026-08-28 (late) — **Whose car was that? — settled for the whole field at once.** Came out
  of a five-field survey (sports ball/player tracking, radar and air-traffic data association,
  identical-animal and cell tracking, traffic cameras and astronomy, hobby camera timers) of how
  other fields follow a small thing through noise; the ranked list lives in memory
  (`video-tracking-cross-field-research`). The one idea every field independently arrived at is
  the one built: stop deciding identity one crossing at a time. `findCrossings/field.ts` takes
  every candidate on a line, every driver in the race with their lap starts on the video clock
  (the two scanned drivers by the walk, the rest placed from the tone), one expected moment per
  driver per lap at that line, and solves it as a minimum-cost matching (Kuhn–Munkres): one
  candidate per slot, one slot per candidate, cost = how far apart, ±0.8s gate. A crossing the
  field gives to a rival is swapped for the candidate that fits this driver's own slot, or —
  when nothing does — kept but labelled *"the timing says that was Chris's car"* and held back.
  A rival must fit **0.3s better** than we do before anything is taken away: two cars a tenth
  apart are nose to tail and no timing can split one blob, so the detector's own pick stands.
  Hand marks are never touched. `reviewResults` takes `field`, `RunContext` carries it, the
  analyze flow builds it from `primary.drivers`; the review copy names the rival; the `[review]`
  console line carries `claimed-by`. `scripts/dev-replay-field.mts` asks the question of any
  job's saved marks.

  Blind scan on a wiped clone (`--clear-marks --first-crossing`, lines as nudged 08-27 22:12),
  graded against the by-eye truth set — the field named six S1 rows as rivals' (laps 7, 8, 10,
  12, 13, 14: Paul, Justin, Chris, Chris, Chris, Justin):

  | | 08-27 afternoon | now |
  |---|---|---|
  | Wrong car / moment written as fact | 0 | **0** |
  | False positive on the no-crossing row (L12 S1) | 1 | **0** — held, named as Chris's |
  | Real crossings found | 16 of 19 | **17 of 19** |
  | Held back | 3, all right | 2, both rivals (L12 S4/S5, Chris ~0.2–0.3s off his walk) |
  | Median error · worst | 21ms · 77ms | 36ms · **50ms** |

  The median moved the wrong way (within one frame 10 → 8); the lines were nudged between the
  two runs so it is not attributable, and it is not the detector's timing that changed — the
  field pass only chooses between candidates the detector produced. Two things it got right
  that a nearest-blob rule cannot: L12 S3 sits +268ms off the line's typical time and the truth
  says it is correct (+45ms — traffic); the margin left it alone. And S2 laps 9–14 all land
  within ±120ms of typical on the direct offset table.

  Rig notes: the learning pass came back "too close to call" on every line this time and went to
  the picture picker, so `dev-drive-scan.mjs` now takes `PICK_OFFSETS` (per-role offsets from the
  truth set) and taps the nearest option, as a driver would — the seeds it produced were 2.51 /
  3.72 / 7.99 / 11.85 / 15.32s. **Saving any `src/` file while a scan runs reloads the page and
  kills it** ("Reading the video failed part-way through") — one run lost to that.
  `dev-check-crossings.mjs` assumed the old "L1 start" numbering (it graded the gap between
  crossings n and n+1 against lap n+1); under a corrected `sf_finish` anchor that is lap n, and
  the script now chooses by anchor kind. Open: why L12 S4/S5 were held by the cluster rule
  rather than claimed by the field (Chris's slot within 0.32s; possibly took another candidate);
  and rivals' offsets are the pooled one — learning each rival's own offset from what the
  matching hands them (one more pass) is the next step if a rival's line differs from ours.
- 2026-08-28 (00:xx) — **A scan on the wrong video's lines, and what it still taught.** Before
  his correction landed, a clone of the IMG_4480 session was scanned on "CW V2" (headless,
  `dev-clone-job.mjs --profile`): 77 written, 23 held back, and six crossings judged on strips cut
  on those lines. On lines drawn for another camera position the S1 segment sat inside the racing
  line — both cars only clipped its top end — so the run says nothing about the detector and the
  clone was deleted. Two things survive it: (1) `dev-whose-car.mjs` named the two rival rows the
  scan wrote (You L7 S4 = Justin's green car, Sandy L2 S5 = Chris) before any strip was cut, and
  the strips agreed — run it first, always; (2) "Locked onto your car's colour" never printed on
  any run today, so the pink car's most distinctive property is doing nothing; a confident colour
  reference that refuses an obviously different car (not colour as a gate) is the open idea. The
  valid result for IMG_4480 remains the afternoon's: 0 rival rows written, median 21ms.
- 2026-08-27 (late) — **"The lines look slightly off where I drew them" — a session on the
  wrong line set, not a drawing bug.** Measured before touching anything (`dev-line-placement.mjs`
  reads every line's screen pixels in the editor and the viewer on the same frame: identical,
  desktop and phone; `dev-camera-drift.mjs` brute-force matches a static patch across the video:
  the camera moves ≤1px in five minutes). `dev-list-line-sets.mjs` then showed the track holding
  TWO sets — the original, nudged at 22:12, and "CW V2" drawn at 22:16 — with the session on the
  original. **Corrected by Jordan at 00:xx: V2 is the set he calibrated for the OTHER video
  (IMG_4483, a different camera position), so the IMG_4480 session was on the right set all
  along** — one track, two videos, two camera positions, two line sets, and nothing on screen said
  which was live. Built: the Sync and Mark
  headers name the set in use (`lineSetButton`); switching sets on the Lines step asks first;
  and the frame box wears a `ring-inset` instead of a border — the 1px border each side had made
  the box 2px off its aspect ratio, so the picture letterboxed by ~1px and lines normalised to the
  box landed ~2 source px off at the edges (Δ now 0.0 by measurement). Lines e2e still passes.
- 2026-08-27 (afternoon) — **The Sync step asks for a crossing, the walk owns the start line, and
  the field shares the tone.** Built on his "yep, do that" after the night's grade:

  1. **Sync asks "which time over the line is this?"** The chips are crossings — *1st · ends L1,
     2nd · ends L2 …* — and `visibleCrossings()` (`manualVideoAnalysis/sync.ts`) works the lap
     out: when lap 1 is a tone fragment (a race) the first crossing ENDS lap 1 and is stored as
     `sf_finish`; when lap 1 is timed loop to loop (practice) it STARTS lap 1, `sf_start`. The
     tone is never asked for. The anchor model needed no change — the screen had just never used
     the end-of-lap kind. Pinning a single crossing follows the same kind.
  2. **A detected start/finish crossing is believed only within 0.25s of the transponder walk**
     (`sfAnchorTime`, `SF_AGREE_SEC`); otherwise the walk is the lap start. The SF window is
     ±0.5s (was 0.8), and only agreeing crossings may teach the car's colour.
  3. **Found while re-grading — the shared-anchor shortcut was wrong for anything but "L1
     start".** `sameHeatTimeAtAnchorLap` assumed the field shared the anchor LAP ("everyone ends
     lap 1 together"), which is only true of lap 1's start; with the anchor now the end of Jordan's
     lap 1, Sandy was placed 0.5s late — the difference between their opening laps. Every driver
     other than the anchor's is now placed from the tone (`placedByAnotherDriver`): walk the
     anchor driver back to the tone on THEIR laps, forward on this driver's — the maths the
     off-video path always used. The sync test's "comp lap 3 at 112" became 111.5, the number the
     off-video test in the same file already expected.

  Blind scan on a wiped clone with the anchor re-labelled as the first crossing
  (`dev-clone-job.mjs --clear-marks --first-crossing`), graded against the truth set:

  | | night (old anchor) | now |
  |---|---|---|
  | Wrong car / moment written as fact | **4** | **0** |
  | Real crossings found | 19 of 19 | 16 of 19 |
  | Median error | 24 ms | **21 ms** · worst 77 ms |
  | Held back as suspect | 0 | 3 — and all three were RIGHT (L12 S4/S5 within 2 frames, Sandy L4 S5) |
  | False positive on the no-crossing row | 1 | 1 — his car passing just off the end of the 50px S1 line, right moment |

  The start-line check reads "matches your timing to 12ms". Colour was NOT locked on this run
  (the agree filter left no sample) and the result did not need it. **Traffic tuning (the ±2s
  window) was NOT done**: with nothing wrong written and the held-back rows correct there is no
  evidence for it yet — it goes in when a graded run shows a rival being written.

  **Rig, three hours' worth.** A headed Edge window on a desktop somebody is using gets
  minimised or covered; Chromium then throttles the page to about a frame a second, which the scan
  reports as "Too quick to read" at every speed and finally "couldn't be read fast enough". Same
  file, bare page, same minute: every frame at 33ms. The page-state probe found the window at
  −32000,−32000 (minimised). Separately, the shared dev server reloaded the page mid-scan each
  time another session saved a broken file (`LapComparisonColumnGrid.tsx`), which drops the
  attached video. `dev-drive-scan.mjs` is now **headless by default** — the branded Edge decodes
  HEVC headless; it was chrome-headless-shell that could not — logs one `[scan]` line per
  stretch (frames, media gap, per-frame draw/read/detect ms), one `[review]` line per crossing
  found/held/missing, a `[page]` state line every 5s, and bails within seconds on a reload.
  `dev-probe-frames.mjs` measures raw frame delivery on a bare page, headed or headless.
- 2026-08-27 (night) — **A ground truth by eye, and the first honest accuracy number on race
  footage.** Jordan: *"the product doesn't always want the average — it needs to be right every
  time. What if you drive the app and manually scrub to when my car crosses the line, then get the
  script to do it and compare."* Done as contact sheets (`scripts/dev-truth-sheets.mjs`): 48
  consecutive frames centred on where the TIMING says the car is due — never the detector's
  answer — then 16 frames at twice the zoom to place the crossing to a frame. 20 crossings over
  four laps (his 9 and 12, Sandy's 4 and 11), pink car = Jordan, red car = Sandy. Truth set in
  `scripts/truth/boronia-IMG_4480-2026-08-27.json`; grader `scripts/dev-grade-truth.mjs`.

  Blind scan (marks wiped, lines untouched) against it:

  | | |
  |---|---|
  | Real crossings found | **19 of 19** |
  | Within one frame (33ms) | 10 · within two frames 14 |
  | Median error, clean laps | **24 ms** · worst 77 ms |
  | Jordan's lap 12 | **all four corners = Chris Kalfoglou**, 0.8–1.1s early, written as fact; plus one false positive on a line his car never crossed |

  So: on a clean lap the detector is as good as a thumb, on a real race. The one bad lap is the
  case the picture picker exists for — and it got through the cluster rule because the lap start
  the scan used was a DETECTED start/finish crossing, not the transponder walk. Which leads to:

  **The anchor was 1.386s late — his first crossing of the loop, not the tone.** The Sync step
  says "set L1 start"; he scrubbed to his car crossing the line, which any driver would; but the
  transponder's lap 1 starts at the tone, one L1-time earlier. Every lap start in the app was
  late by that for every driver. Proof: with the anchor shifted −1.386s, the walk lands the pink
  car on SF at lap 9 within 11ms and the red car at Sandy's laps 4 and 11 within 9ms and 6ms; and
  the two cars crossing at the start become Justin (34ms) and Paul (30ms). Corners survived
  because their offsets are relative; the SF window (±0.8s round a late walk) has been catching
  whichever rival crosses ~1.4s after him — which is where "your car's colour" was sampled, and
  how a rival's lap start polluted lap 12.

  Fixes proposed, not built: (1) accept a detected SF crossing only within ~0.25s of the walk,
  else use the walk; (2) the Sync step should ask for *your first crossing of the line* (an
  end-of-lap-1 anchor the model already supports), not "L1 start". Also seen: S1 is 50px long
  and his wider line on lap 12 missed it entirely — the honest value there is "none", and the
  detector wrote a crossing anyway.

  Rig lesson: the first blind run starved because contact sheets were being cut on the same
  machine. A decode-bound scan needs the machine to itself.
- 2026-08-27 (evening) — **The lines were never the problem. Retracts the morning's "move S1–S3
  onto tarmac".** Jordan pushed back — *"that doesn't feel like the solution"* — and proposed
  judging movement instead of removing colour. That test already existed (`tracks.ts`), and the
  reason it had not held was three back doors that compound:

  1. No car-like path → silent fallback to raw frame-pair flickers with NO movement test.
  2. Colour as a gate, with a mostly-tarmac reference, discarded the real car on kerb lines and
     forced that fallback.
  3. The bootstrap then learned S1–S3's offsets from the flickers — the pictures showed empty
     kerbing because they were pictures of the wrong MOMENTS, not because the lines were bad.

  Built: colour demoted to a tiebreak (never removes a candidate); an untracked flicker is always
  held back, shown, never written; **camera-shake rejection** — an object must move differently
  from the whole frame, since a gust makes every bit of paint drift together and that looks MORE
  car-like than a car cornering; bootstrap learns from tracked candidates first; plausibility by
  **largest agreeing cluster** (median-and-spread dies once a third of laps are wrong); Sync offers
  every lap, lap 1 first (the tone — the only lap on which "everyone starts together" is true).

  Same file, same lines, marks cleared — graded against the transponder:

  | Line | Rival before | Rival after | Jordan after (cluster-held) |
  |---|---|---|---|
  | S1 | 1845 ms | **211 ms** | 339 ms |
  | S2 | 1813 ms | **120 ms** | 156 ms |
  | S3 | 877 ms | **81 ms** | 119 ms |
  | S4 | 46 ms | **31 ms** | 69 ms |
  | S5 | 51 ms | **41 ms** | 83 ms |

  **Open: Jordan's own car in traffic.** He started further back and raced in a pack; whole laps
  lock onto a named neighbour (lap 13: +1.3s at every corner) and the chain follows it. The
  cluster rule catches those but holds back about half his laps. Levers not yet pulled, as tuning
  calls for the founder: the ±2s search window (`BASE_WINDOW_SEC`) against ~0.5s real variance,
  and bounding the chain to the bootstrap offset. The picture picker is the identity tool.

  Corrections to the morning's entry: IMG_4480 is HEVC **1376×600**, not 4K (IMG_4483 is
  2606×1074); "decode-bound, ~1016ms between frames" was twelve orphaned Playwright browsers at
  48% CPU, not HEVC — both Edge and Chrome decode the file in 19ms; and the player only mounts on
  Sync/Mark, so any wait for a `<video>` on the Timing step waits forever.

  Tests: `npm run test:find-crossings` now also runs `tracks.test.ts` (shake, lone car, untracked
  never written) and the contaminated-line case in `refine.test.ts`, all from Boronia figures.
- 2026-08-27 (later) — **S1–S3 diagnosed: the lines are drawn on paint and kerbing.** Built the
  screen Jordan asked for — *"let it show the image of each detection and let you select which is
  yours"* — and it answered the question in one look. `identify.ts` reads one whole lap, keeps
  EVERY car that crossed each line instead of choosing between them, and `frameGrab.ts` cuts a
  picture around each with a ring on the exact detected point.

  On the Boronia race the pictures show: **S4's ring sits on a plainly visible green RC car. S1,
  S2 and S3's rings sit on empty painted lines and red/white kerbing — there is no car there at
  all.** So those three were never "following the wrong car"; they were firing on camera
  micro-shake over high-contrast paint, which is the failure `pickCrossing` already documents
  ("a band over kerbing, painted markings or a grass edge fires on camera micro-shake in EVERY
  frame"). It matches the transponder numbers exactly: S4/S5 46–122ms, S1–S3 643–1845ms.

  **The fix is line placement, not code: move S1, S2 and S3 onto plain tarmac.** Nothing else
  here will beat that, and the same rule belongs in the Lines step as guidance.

  Also built, both asked for by name:

  - **Pick your car from pictures**, on demand or whenever the bootstrap ties. Taps become seed
    offsets, kept PER DRIVER (`seedsByRole`) — one shared set would let whichever car was
    identified last decide where the other was searched for, which is the mistake being undone.
  - **A rival anchor.** `sync.anchorByRole` stores a driver's own tie point between the timing
    clock and the video clock, and the Sync step grew a *"whose crossing are you watching"*
    toggle. Jordan's premise was half right: one race anchor genuinely does place the whole field,
    because everyone leaves together and each then walks their own lap times — but that is an
    ASSUMPTION, it is false in practice sessions where drivers start whenever they like, and
    there was no way to say "that is when THEY went past". Now there is, and it wins for that
    driver wherever both exist.

  Three things driving it taught, none of which were visible from the code:

  1. **Headless Chromium cannot decode HEVC** — it hands the canvas black frames and every
     picture is a black square. Test the browser lane in Edge, or on an H.264 proxy
     (`ffmpeg -vf scale=1280:-2 -c:v libx264`); normalised lines and `bandFrac` both scale, so a
     proxy exercises the real wiring. It does NOT re-validate accuracy.
  2. **The read is decode-bound, not work-bound.** Measured: ~10ms of ROI work per frame against
     a ~1016ms gap between frames on software 4K HEVC. So reading all five lines in one pass
     costs almost nothing over reading one, and slimming the per-frame work would buy nothing.
  3. **`requestVideoFrameCallback` may never fire again on a PAUSED video.** The frame the seek
     landed on is presented once; a callback registered a moment later waits forever. The first
     version hung on "cutting the pictures" indefinitely. There is a wait ceiling now.

  And one lie the screen was telling, found only by driving it: a starved read reported *"nothing
  crossed this line"* — a different statement entirely, and false. It now says the video could
  not be read fast enough, and always shows frames read and effective fps.
- 2026-08-27 — **First race footage, and the first real failure.** Boronia, IMG_4480.MOV, a
  17-second lap with six cars on track — nothing like the one-car practice session everything was
  measured on. 96 crossings saved with no marking. Graded against LiveRC's own lap times with a
  check that needs no reference data and no watching: **a line is crossed once a lap, so the gap
  between one lap's crossing and the next lap's crossing of the same line must equal that lap's
  time.** Use this on every new video before trusting anything — `scripts/dev-check-crossings.mjs`.

  | Line | Jordan | Sandy Iavazzo |
  |---|---|---|
  | S1 | 884 ms | 1845 ms |
  | S2 | 691 ms | 1813 ms |
  | S3 | 643 ms | 877 ms |
  | **S4** | **122 ms** | **46 ms** |
  | **S5** | **48 ms** | **51 ms** |

  S4 and S5 hold practice-session quality on a new track under new light. S1–S3 do not, and their
  errors are **correlated within a lap** — on lap 7 all three are ~4s out together while S4/S5 sit
  where they always sit. Correlated error is the signature of following the wrong car, not of
  imprecision. Telling cars apart was the one thing built and never proven; a six-car race found
  the seam immediately. **Not yet diagnosed** — pull the frames it chose before changing anything.

  Four defects the same data exposed, all fixed, all provable from arithmetic alone:

  1. **A race's opening lap is not a lap.** The transponder times it from the start line, so it
     comes back as a fragment — 0.893s against a 17s median — and *sorting by lap time put it
     first*. "The fastest ten laps" spent its best slot on a lap that never existed, for every
     driver in the field. `realLaps` now drops anything under 60% of that driver's own median; no
     driver is ever 40% quicker than themselves, so nothing real is lost.
  2. **Two laps could claim one crossing.** Both fragments aimed at the same piece of video and
     both walked away holding identical timestamps, which reads as two confident detections rather
     than one counted twice. `dropDuplicates` leaves an honest gap instead: a gap can be filled
     later, a wrong time cannot be spotted from the numbers.
  3. **A lap could visit its corners out of order.** S4 before S3 on lap 7. The sequence itself is
     the proof — no reference data needed. `flagOutOfOrder` holds back whichever of the pair sits
     further from its own line's usual sector time, and keeps the other.
  4. **Nobody chose the rival.** `DriverRole` had two values, so every imported driver defaulted to
     "competitor" and a lookup for the rival answered with whoever the timing site listed first —
     five drivers in a slot meant for one. New `DriverSlot` adds "other"; the analyze flow grew a
     **Compare against** picker; legacy sessions normalise on read, keeping their existing first
     driver so no analysis silently changes who it is about.

  5. **The Mark step asked the driver to mark the rival's crossings** — Jordan's own finding, and
     the sharpest of the five: *"i didnt understand when it gave me the option to select when i
     crossed the sector line or my competitor, didnt really make sense"*. It is an unanswerable
     question. A driver can pick their own car out of a video; nobody can pick out a rival they
     have never seen among six identical cars. The queue is **your own car only** now — a rival's
     crossings come from their transponder lap times, which nothing else in the field matches.

  Tests: `npm run test:find-crossings` (new) covers 1–3 with the real Boronia figures.
- 2026-08-26 (later still) — **Marking is no longer required at all** (step 3): bootstrap from the
  footage, lap-time-scaled windows, bracketed re-scan of the gaps, colour identity (built, not yet
  proven), fastest-10 laps per driver. Verified with every hand mark deleted: 49/50 corners, all 15
  hand marks within 100ms, no questions asked. Jordan's two questions drove three of these:
  *"doesn't this fail when you make a big mistake and you're not within the range"* — windows now
  widen by exactly the time a lap lost, and anything still missing is searched for BETWEEN the
  corners either side of it, which cannot be out of range; and *"without colour will this be able
  to detect multiple cars"* — it never could, with colour or without. Colour was only ever a
  sensitivity channel (noticing movement), never an identity one, so dropping it cost nothing
  there; using it for identity is the new, still-unproven part.
- 2026-08-26 (later) — **Wired into the Mark step and driven end to end** (see step 3): browser
  decode lane, session bridge, "Find the rest" panel with a review before anything is written.
  Two browser findings recorded in step 3 (the `willReadFrequently` trap and frame starvation).
  Standing rig at `/debug/find-crossings`. The July session was snapshotted and restored — his
  15 hand marks and `localVideoName` are exactly as they were.
- 2026-08-26 — **Detector rebuilt in TypeScript and re-validated**, results in step 3. The
  truth data was recovered from Google Drive (`Documents/rc-autosnap-results/autosnap-me/`:
  `probe-data.json`, `loop-results-b22-t14.json`, `hand-marks.json`, `compare-summary.json`,
  `loop_eval_me.py`), so step 0's "locate or regenerate" item is closed. Four findings, each
  measured, none guessed — **do not re-litigate these:**
  1. **Read brightness, not colour, on any line over paint.** Colour is stored at quarter
     resolution and rebuilt on decode; across red-on-white kerb chevrons that rebuild wobbles
     every frame with a locked camera, and the recipe takes the LARGEST of the three channels,
     which amplifies exactly that error. Measured per band, colour ran 13× to 101× noisier than
     brightness, and S5's colour band was 99.65% saturated in every frame. Grey tarmac has no
     colour edge — which is why the two lines on tarmac worked from July and the four on kerbs
     never did. `calibrate.ts` decides per line by comparing the two channels frame by frame
     (a car moves both, so it scores ~1; chroma noise moves only colour, so it scores high), and
     takes a high quantile — so it works on a busy heat with traffic in every sampled frame.
     The founder ruling stands: **lines stay on kerbs**; the detector adapts, not the line.
  2. **The threshold is twice the band's measured noise floor, not a constant.** 14 and 9 were
     fitted with colour noise present. Every corner band measures a brightness noise floor of 1,
     so 9 is nine times the noise and goes blind to a distant car. A flat "+4" margin was tried
     and is wrong at the other end — start/finish degraded from 2.5 ms to 26 ms median. Doubling
     holds at both, and explains 14: the start/finish band's colour noise floor is 7.
  3. **Motion coherence is judged locally, over ~0.2s, never over the whole track.** The far
     corner's car is one clean 38-point track crossing within 16 ms of the hand mark, and scores
     0.37 straightness over its full 1.33s — because it is going round a corner, which is what a
     sector line is drawn across. Over a fifth of a second the same car is nearly straight.
     Judging globally rejected it outright.
  4. **Predict each corner from the corner before it, not from the start line.** On a lap where
     the driver lost ~1.5s early, every downstream prediction was 1.5s stale and one corner
     picked a candidate 3.16s from the truth. Adjacent-corner gaps vary by a few hundredths, so
     chaining shrinks the search from three seconds to a few tenths — and makes track order
     impossible to violate. `refine.ts`; it only ever re-picks among candidates the detector
     actually saw.
- 2026-08-25 (later) — **Upload rework built** after Jordan hit both walls: client-direct
  multipart blob upload (progress %, ~2GB cap) + presigned-redirect playback with CDN ranges.
  Verified by driving: 40MB upload → library → play → seek, zero errors.
- 2026-08-25 — Initial: full status audit (code + app drive on Jordan's account), library upload
  verified end to end, "black sessions" diagnosed as never-had-a-video + relink UX, missing
  autosnap truth data flagged, sequence laid out.
