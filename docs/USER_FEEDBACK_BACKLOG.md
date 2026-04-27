# User feedback backlog

Single place to track product notes from app usage (2026-04-27). Edit **Priority** when you decide order; check boxes in [Implementation checklist](#implementation-checklist) as work ships.

## Verbatim notes (original)

> Small create car button when logging a run  
> Create new setup button  
> Describe current skill level  
> Goals  
> Things you want in ai responses ie (make my car faster vs explain exactly why / what)  
> Lighter background / light / dark mode  
> Event timing url  
> 'Notes' is a different tab style than the rest in log run  
> Event practice url  
> Photo indicator of handling details  
> For all setups with much different droop values, group them as different measurement method and create aggregation for that  
> Big 'help fix my car' button  
> Progress for engineer questions to show feedback to user input  
> Need to be able to remove button selection from setup sheet 'c07rf' eg  
> Consistency decimal  
> Open run from dashboard brings to editor, not in sessions, open analysis brings to sessions but not specific run  
> Engineer summary within sessions needs to fit better on phone  
> Be able to Change 'to try' order  
> Time of day / event running still seems off, think based on utc  
> Sync to mylaps  
> Day debrief  
> Balance image top down  

## Backlog table

| ID | Verbatim (short) | Intent (how we read it) | Area | Size | Priority (draft — edit) | Status |
|----|------------------|-------------------------|------|------|-------------------------|--------|
| FB-01 | Small create car button when logging a run | From Log your run, add a compact affordance to create a new car without leaving the flow (today may be buried or full-page only). | Log run | M | 9 | Not started |
| FB-02 | Create new setup button | Explicit action to start a new setup document/snapshot from the relevant screen (likely log run or setup flow). | Log run / Setup | M | 10 | Not started |
| FB-03 | Describe current skill level | Profile (or onboarding) field: driver skill so the Engineer / copy can calibrate tone and depth. | Profile / Engineer | M | 6 | Not started |
| FB-04 | Goals | Profile or per-car goals (e.g. consistency vs lap time) to steer recommendations. | Profile / Engineer | M | 7 | Not started |
| FB-05 | Things you want in AI responses | User preference: outcome-first (“make my car faster”) vs explanatory (“why / what’s happening”) — store and pass into Engineer context. | Profile / Engineer | M | 8 | Not started |
| FB-06 | Lighter background / light / dark mode | Theme: lighter default surface colors and/or explicit light + dark theme toggle (not only system). | Theme | M–L | 14 | Not started |
| FB-07 | Event timing url | Race meeting: field or UX for event **timing** URL (distinct from practice). | Log run / Events | S–M | 11 | Not started |
| FB-08 | 'Notes' different tab style than rest in log run | **Notes** tab in Log your run should use the same tab/chip pattern as sibling tabs (e.g. Things to try). | Log run | S | 4 | Not started |
| FB-09 | Event practice url | Clear practice-day URL for events/testing (may overlap with existing practice URL in session). | Log run / Events | S–M | 12 | Not started |
| FB-10 | Photo indicator of handling details | Visual cue when handling-detail photos are attached vs empty. | Log run | S | 13 | Not started |
| FB-11 | Droop grouping / aggregation | When community setups use **very different droop** measurement methods, bucket separately and aggregate per method (avoid apples-to-oranges stats). | Aggregations | L | 19 | Not started |
| FB-12 | Big 'help fix my car' button | Prominent entry to Engineer or guided troubleshooting from dashboard or log run. | Dashboard / Engineer | M | 15 | Not started |
| FB-13 | Progress for engineer questions | Show step/progress in multi-step Engineer flows so user sees feedback on their answers. | Engineer | M | 16 | Not started |
| FB-14 | Remove button selection setup sheet (c07rf) | On calibrated setup sheets, allow **clearing** a selected option (e.g. code `c07rf`) back to unset — today may be sticky. | Setup sheet | S–M | 17 | Not started |
| FB-15 | Consistency decimal | Same number of decimal places / rounding rules across setup fields, tables, and exports. | Setup / UI | S–M | 5 | Not started |
| FB-16 | Open run vs open analysis navigation | Dashboard: **Open run** should land in session/run context as expected; **Open analysis** should open the right session **and** focus the specific run (fix mismatched deep links). | Dashboard / Nav | M | 1 | **Shipped** (see checklist) |
| FB-17 | Engineer summary in sessions on phone | Engineer summary block in sessions view: responsive layout so it fits small viewports without overflow/clipping. | Sessions / Engineer | M | 18 | Not started |
| FB-18 | Change 'to try' order | Reorder items in **Things to try** (dashboard persistent list and/or per-run list), not only add/delete. | Dashboard / Log run | M | 20 | Shipped (sortOrder + DnD) |
| FB-19 | Time of day / UTC | Session or event “time of day” still wrong — audit for UTC vs local handling in storage and display. | Data / Log run | M | 2 | Not started |
| FB-20 | Sync to MyLaps | Integration to pull or link MyLaps timing data. | Integrations | L | 21 | Not started |
| FB-21 | Day debrief | End-of-day or post-event debrief flow (summary, notes, Engineer hook — scope TBD). | Product | L | 22 | Not started |
| FB-22 | Balance image top down | Setup or help UI: balance diagram viewed from **top** (orientation / asset update). | Content / UI | M | 3 | Not started |

**Priority column:** Draft stack rank for discussion (1 = ship first). Reorder anytime; keep numbers unique per row.

**Size (rough):** S = small UI or single file; M = multi-file or API; L = new subsystem, integration, or aggregation pipeline.

## Draft stack rank (discussion only)

The **Priority (draft)** column in the table reflects this guess: navigation/time bugs first (FB-16, FB-19), small UI consistency (FB-08, FB-15), then profile/Engineer prefs (FB-03–05, FB-13), then larger features (FB-11, FB-20–21). Reorder the numbers anytime.

## Implementation checklist

Work through in **Priority** order from the table (after you fill it in). Check when merged.

- [ ] FB-01 Small create car from log run  
- [ ] FB-02 Create new setup button  
- [ ] FB-03 Skill level on profile  
- [ ] FB-04 Goals  
- [ ] FB-05 AI response style preference  
- [ ] FB-06 Lighter / light–dark theme  
- [ ] FB-07 Event timing URL  
- [ ] FB-08 Notes tab style match  
- [ ] FB-09 Event practice URL  
- [ ] FB-10 Handling-details photo indicator  
- [ ] FB-11 Droop method grouping + aggregations  
- [ ] FB-12 Help fix my car CTA  
- [ ] FB-13 Engineer question progress UI  
- [ ] FB-14 Clear setup sheet button selection  
- [ ] FB-15 Decimal consistency  
- [x] FB-16 Dashboard open run / open analysis deep links (`/runs/history?focusRun=<id>`; dashboard links updated 2026-04-27)  
- [ ] FB-17 Engineer summary mobile layout in sessions  
- [x] FB-18 Reorder Things to try (ActionItem `sortOrder` + drag on dashboard; `?list=try` / `do`)  
- [ ] FB-19 UTC / local time-of-day fix  
- [ ] FB-20 MyLaps sync  
- [ ] FB-21 Day debrief  
- [ ] FB-22 Balance image top-down  

## Related code (hints for implementers)

| ID | Starting points |
|----|-----------------|
| FB-08, FB-18 | `src/components/runs/NewRunForm.tsx` (Notes / Things to try tabs), `src/components/dashboard/ThingsToTrySection.tsx` |
| FB-16 | `src/components/dashboard/DashboardHome.tsx`, `src/app/runs/history/page.tsx` (`focusRun` query), `src/components/runs/RunHistoryTable.tsx` |
| FB-14 | `src/components/setup-documents/SetupCalibrationEditorClient.tsx` |
| FB-11 | `src/lib/setupAggregations/`, rebuild via `POST /api/setup-aggregations/rebuild` per `AGENTS.md` |

Do not treat `content/vehicle-dynamics/` or `src/lib/engineerPhase5/parameterEffects/catalog.ts` as part of this backlog unless an item explicitly targets KB text.
