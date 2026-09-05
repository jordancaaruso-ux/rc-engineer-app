/**
 * dev-demo-race-day.ts — DEV ONLY. Stage the demo account as an ACTIVE RACE DAY for marketing
 * screenshots (founder call 2026-09-04: "every page should be like it's an active race day with
 * plenty of runs to analyze").
 *
 *   npm run demo:race-day -- --confirm-host=<db host>     # refuses without the matching host
 *   npm run demo:race-day -- --confirm-host=... --dry-run
 *
 * Meant for scratch-dev (`ep-muddy-unit`). It reshapes the demo copy in place; the public demo on
 * production is untouched unless you point .env.local at it, which the host guard makes you say.
 *
 * What it does, in order:
 *   1. Drops the outings AFTER the 2026 QLD State Titles (two Boronia club days + a TFTR test day,
 *      20 runs) and the three Engineer threads anchored on them. Without this they land in the
 *      future once the Titles are moved onto today.
 *   2. Makes the Titles a three-day meeting that ENDS on Saturday: Thu/Fri practice, Sat quali
 *      and mains. The Sunday runs (warm-up, A1, A2) are re-timed onto Saturday afternoon, and the
 *      two pairs of split-import runs that share one timestamp are spread apart.
 *   3. Sets the meeting's class and its LiveRC links (the field sessions already come from
 *      brccc.liverc.com), fixes the one snapshot whose tyre delta reads "[object Object]", and
 *      gives the demo driver the founder's time zone so "today" is the same day on both.
 *   4. Swaps every rival name in the imported fields for an invented one — LiveRC results are
 *      public, but these shots go on the website. Applied wherever a name can surface: session
 *      payloads and field stats, lap sets, run notes, Engineer answers.
 *   5. Slides the whole season (the same uniform shift `demo:refresh` uses) so that Saturday of
 *      the Titles is TODAY in Melbourne, then settles thread dates the same way the seed does.
 *
 * Re-runnable: step 5 re-anchors from wherever the season currently sits, so running it again
 * tomorrow moves race day to tomorrow. Steps 1–4 are no-ops the second time.
 */
import { prisma } from "@/lib/prisma";
import { buildScrubber, deepScrub } from "@/lib/demo/anonymize";
import { demoCatalogUserId } from "@/lib/demo/demoAccess";
import { applyDemoDateShift, settleDemoThreadDates } from "@/lib/demo/applyDemoDateShift";

const DEMO = demoCatalogUserId();
const TIME_ZONE = "Australia/Melbourne";
const TITLES_NAME = "2026 QLD State Titles";
const MIN = 60_000;

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const dryRun = args.includes("--dry-run");

/** Real LiveRC names seen in the demo's imported fields → invented replacements. */
const RIVAL_NAMES: Array<[string, string]> = [
  ["MICHAEL STONE", "MARCUS REID"],
  ["DAVID CALWELL", "DANIEL KEARNEY"],
  ["TYE MOYLAN", "TYSON HALE"],
  ["MICHAEL WILLOUGHBY", "MITCHELL WARNER"],
  ["COOPER WEBSTER", "CALLUM WEBB"],
  ["MARCUS ASKELL", "MASON ASHFORD"],
  ["CRISTIAN SILVA", "CRUZ SANTOS"],
  ["JUSTIN VERGUNST", "JARED VANCE"],
  ["RHYS MARSHALL", "RILEY MARSDEN"],
  ["PETER BECKETT", "PATRICK BENNETT"],
  ["LACHLAN PEARSON", "LIAM PARKER"],
  ["LUKE WATSON", "LEVI WALLACE"],
  ["SAMUEL MUFFETT", "SAM MORGAN"],
  ["TIMOTHY HILYEAR", "THOMAS HOLLAND"],
  ["TIM HILYEAR", "THOMAS HOLLAND"],
  ["STEPHEN SPIERS", "STEVEN SPENCER"],
  ["CHRIS KALFOGLOU", "CHRIS KOSTAS"],
  ["TIM BOUNDY", "TOBY BRENNAN"],
  ["CHRIS PEET", "CHRIS PRIOR"],
  ["LOGAN RINTOUL", "BRODIE HARTLEY"],
  ["PAUL SIMS", "PAUL SUTTON"],
  ["MARK WALLIN", "MARK WHITLOCK"],
  ["JACK OBERSTAR", "JACK OSBORNE"],
  ["TOM DE NARDIS", "TOM DELANEY"],
  ["ADAM ZIEBART", "ADAM ZELLER"],
  ["MICHAEL POWELL", "MICHAEL PRESTON"],
  ["ALEX ILIEVSKI", "ALEX IVANOV"],
  ["MATTHEW NOBBS", "MATTHEW NORRIS"],
  ["RYAN WITHERS", "RYAN WESTON"],
  ["CARTER SIMS", "CARTER SUTTON"],
  ["DAVE LANGAN", "DAVE LOWRY"],
  ["ONE TRAN", "OWEN TRAN"],
  ["SIMON CAMILLERI", "SIMON CALDER"],
  ["ANDREW BUDGE", "ANDREW BURKE"],
  // First names that appear on their own in the driver's notes.
  ["Logan", "Brodie"],
];

/** Local wall-clock (Melbourne, +10 in winter/spring) → UTC. */
function melbourne(ymd: string, hm: string): Date {
  return new Date(`${ymd}T${hm}:00+10:00`);
}

function ymdIn(tz: string, d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`Database host: ${dbHost}${dryRun ? "  (dry run)" : ""}`);
  if (argValue("confirm-host") !== dbHost) {
    console.error(`Refusing to run: pass --confirm-host=${dbHost} to confirm you mean THIS database.`);
    process.exit(1);
  }

  const titles = await prisma.event.findFirst({ where: { userId: DEMO, name: TITLES_NAME }, select: { id: true, startDate: true, endDate: true } });
  if (!titles) throw new Error(`Demo has no "${TITLES_NAME}" event — reseed first (npm run demo:seed).`);
  const titlesRuns = await prisma.run.findMany({
    where: { userId: DEMO, eventId: titles.id },
    orderBy: { sortAt: "asc" },
    select: { id: true, sortAt: true, meetingSessionType: true, notes: true, setupSnapshotId: true },
  });
  if (titlesRuns.length === 0) throw new Error("The Titles event has no runs.");
  console.log(`Titles: ${titlesRuns.length} runs, ${titlesRuns[0].sortAt.toISOString()} → ${titlesRuns.at(-1)!.sortAt.toISOString()}`);

  // ── 1. Drop everything after the Titles ─────────────────────────────────────
  const lastTitlesAt = titlesRuns.at(-1)!.sortAt;
  const later = await prisma.run.findMany({ where: { userId: DEMO, sortAt: { gt: lastTitlesAt } }, select: { id: true, eventId: true } });
  const laterEventIds = [...new Set(later.map((r) => r.eventId).filter((e): e is string => !!e))];
  const laterThreads = await prisma.engineerChatThread.findMany({ where: { userId: DEMO, primaryRunId: { in: later.map((r) => r.id) } }, select: { id: true } });
  console.log(`After the Titles: ${later.length} runs, ${laterEventIds.length} events, ${laterThreads.length} anchored threads → dropped`);
  if (!dryRun && later.length > 0) {
    await prisma.engineerChatThread.deleteMany({ where: { id: { in: laterThreads.map((t) => t.id) } } });
    await prisma.run.deleteMany({ where: { id: { in: later.map((r) => r.id) } } });
    await prisma.event.deleteMany({ where: { id: { in: laterEventIds }, userId: DEMO } });
  }

  // ── 2. Saturday is race day ───────────────────────────────────────────────────
  // Anchor on the first QUALIFYING run: its local calendar day is "Saturday", wherever the
  // season currently sits. Everything below is expressed relative to that day.
  const firstQuali = titlesRuns.find((r) => r.meetingSessionType === "QUALIFYING") ?? titlesRuns[0];
  const satYmd = ymdIn(TIME_ZONE, firstQuali.sortAt);
  const dayBefore = (ymd: string, n: number) => ymdIn(TIME_ZONE, new Date(melbourne(ymd, "12:00").getTime() - n * 864e5));
  const thuYmd = dayBefore(satYmd, 2);
  console.log(`Saturday of the Titles is currently ${satYmd} (${TIME_ZONE})`);

  // Runs that need a new slot, found by the note they carry (ids differ between seeds).
  const retime: Array<{ note: string; hm: string; type?: "PRACTICE" | "RACE" }> = [
    { note: "4.4 front spring better", hm: "06:40" }, // split-import twin of the 05:57 practice
    { note: "Pretty loose, still quick", hm: "14:00" }, // Sunday warm-up → Saturday afternoon
    { note: "More rear grip, went with 7.9v", hm: "15:05" }, // A1
    { note: "Little easier I think", hm: "15:50" }, // A2
  ];
  for (const r of retime) {
    const run = titlesRuns.find((x) => (x.notes ?? "").startsWith(r.note));
    if (!run) { console.warn(`  ! no Titles run starts with "${r.note}" — skipped`); continue; }
    const at = melbourne(satYmd, r.hm);
    console.log(`  ${run.id} "${r.note}" → ${satYmd} ${r.hm}`);
    if (!dryRun) await prisma.run.update({ where: { id: run.id }, data: { sortAt: at, createdAt: at, sessionCompletedAt: new Date(at.getTime() + 6 * MIN) } });
  }
  // Every Titles run: the timing stamp and the "logged" stamp sit a few minutes after the run,
  // not a day later. `loggingCompletedAt` is the first instant the run page prints.
  if (!dryRun) {
    const fresh = await prisma.run.findMany({ where: { userId: DEMO, eventId: titles.id }, select: { id: true, sortAt: true } });
    for (const r of fresh) await prisma.run.update({ where: { id: r.id }, data: { sessionCompletedAt: new Date(r.sortAt.getTime() + 6 * MIN), loggingCompletedAt: new Date(r.sortAt.getTime() + 9 * MIN) } });
  }
  // The meeting: Thu → Sat, so Saturday is "Day 3 of 3".
  const startDate = melbourne(thuYmd, "17:30");
  const endDate = melbourne(satYmd, "17:30");
  console.log(`  event ${thuYmd} → ${satYmd}, class ISTC 13.5, LiveRC links set`);
  if (!dryRun) {
    await prisma.event.update({
      where: { id: titles.id },
      data: {
        startDate,
        endDate,
        raceClass: "ISTC 13.5",
        practiceSourceUrl: "https://brccc.liverc.com/practice/?p=session_list",
        resultsSourceUrl: "https://brccc.liverc.com/results/",
      },
    });
  }

  // ── 3. Small repairs ───────────────────────────────────────────────────────────
  const snaps = await prisma.setupSnapshot.findMany({ where: { userId: DEMO }, select: { id: true, setupDeltaJson: true, data: true } });
  let repaired = 0;
  for (const s of snaps) {
    const delta = s.setupDeltaJson as Record<string, unknown> | null;
    if (!delta || delta.tires !== "[object Object]") continue;
    const tires = (s.data as Record<string, unknown> | null)?.tires ?? null;
    console.log(`  snapshot ${s.id}: tyre delta "[object Object]" → ${JSON.stringify(tires)}`);
    if (!dryRun) await prisma.setupSnapshot.update({ where: { id: s.id }, data: { setupDeltaJson: { ...delta, tires } as object } });
    repaired++;
  }
  if (!dryRun) await prisma.user.update({ where: { id: DEMO }, data: { timeZone: TIME_ZONE } });
  console.log(`  ${repaired} tyre delta(s) repaired; demo time zone = ${TIME_ZONE}`);

  // ── 4. Rival names ────────────────────────────────────────────────────────────
  const scrub = buildScrubber(RIVAL_NAMES.map(([from, to]) => ({ from, to })), { transponders: false });
  const scrubJson = <T,>(v: T): T => (v == null ? v : deepScrub(v, scrub));
  let touched = 0;
  const founderScrub = buildScrubber(
    [{ from: "Jordan Caruso", to: "Nic Swole" }, { from: "jordan caruso", to: "nic swole" }, { from: "Caruso", to: "Swole" }, { from: "Jordan", to: "Nic" }, ...RIVAL_NAMES.map(([from, to]) => ({ from, to }))],
    { transponders: false },
  );
  const sessions = await prisma.importedLapTimeSession.findMany({ where: { userId: DEMO }, select: { id: true, parsedPayload: true, fieldStatsJson: true, eventDetectionSessionLabel: true } });
  for (const s of sessions) {
    const parsedPayload = scrubJson(s.parsedPayload);
    const fieldStatsJson = scrubJson(s.fieldStatsJson);
    // The session's saved title is what the lap-analysis library prints; the seed never scrubbed it.
    const eventDetectionSessionLabel = s.eventDetectionSessionLabel == null ? s.eventDetectionSessionLabel : founderScrub(s.eventDetectionSessionLabel);
    if (JSON.stringify(parsedPayload) === JSON.stringify(s.parsedPayload) && JSON.stringify(fieldStatsJson) === JSON.stringify(s.fieldStatsJson) && eventDetectionSessionLabel === s.eventDetectionSessionLabel) continue;
    touched++;
    if (!dryRun) await prisma.importedLapTimeSession.update({ where: { id: s.id }, data: { parsedPayload: parsedPayload as object, fieldStatsJson: fieldStatsJson as object, eventDetectionSessionLabel } });
  }
  // Lap sets carry three name columns; the seed scrubbed only one of them, so the founder's own
  // name was still the title of every row on the lap-analysis library. Scrub all three, and the
  // founder's name along with the rivals'.
  const lapSets = await prisma.runImportedLapSet.findMany({ where: { run: { userId: DEMO } }, select: { id: true, driverName: true, displayName: true, normalizedName: true } });
  for (const l of lapSets) {
    const next = { driverName: founderScrub(l.driverName), displayName: l.displayName == null ? l.displayName : founderScrub(l.displayName), normalizedName: l.normalizedName == null ? l.normalizedName : founderScrub(l.normalizedName) };
    if (next.driverName === l.driverName && next.displayName === l.displayName && next.normalizedName === l.normalizedName) continue;
    touched++;
    if (!dryRun) await prisma.runImportedLapSet.update({ where: { id: l.id }, data: next });
  }
  const runs = await prisma.run.findMany({ where: { userId: DEMO }, select: { id: true, notes: true, driverNotes: true, lapSession: true, engineerSummaryJson: true, handlingAssessmentJson: true } });
  for (const r of runs) {
    const next = {
      notes: r.notes == null ? r.notes : scrub(r.notes),
      driverNotes: r.driverNotes == null ? r.driverNotes : scrub(r.driverNotes),
      lapSession: scrubJson(r.lapSession),
      engineerSummaryJson: scrubJson(r.engineerSummaryJson),
      handlingAssessmentJson: scrubJson(r.handlingAssessmentJson),
    };
    if (JSON.stringify(next) === JSON.stringify({ notes: r.notes, driverNotes: r.driverNotes, lapSession: r.lapSession, engineerSummaryJson: r.engineerSummaryJson, handlingAssessmentJson: r.handlingAssessmentJson })) continue;
    touched++;
    if (!dryRun) await prisma.run.update({ where: { id: r.id }, data: next as object });
  }
  const messages = await prisma.engineerChatMessage.findMany({ where: { thread: { userId: DEMO } }, select: { id: true, content: true } });
  for (const m of messages) {
    const next = scrub(m.content);
    if (next === m.content) continue;
    touched++;
    if (!dryRun) await prisma.engineerChatMessage.update({ where: { id: m.id }, data: { content: next } });
  }
  console.log(`  rival names: ${touched} rows rewritten`);

  // ── 5. Saturday → today ───────────────────────────────────────────────────────
  const now = new Date();
  const todayYmd = ymdIn(TIME_ZONE, now);
  const deltaMs = melbourne(todayYmd, "12:00").getTime() - melbourne(satYmd, "12:00").getTime();
  console.log(`Shift: ${satYmd} → ${todayYmd} (${Math.round(deltaMs / 864e5)} days)`);
  if (!dryRun && deltaMs !== 0) {
    const rows = await applyDemoDateShift({ deltaMs, userId: DEMO });
    console.log("  rows shifted:", JSON.stringify(rows));
    const settled = await settleDemoThreadDates({ lagHours: 2 });
    console.log("  threads settled:", JSON.stringify(settled));
  }

  // ── 6. Nothing in the future ──────────────────────────────────────────────────
  // The thread settle pushes a conversation two hours past the run it is about; on race day
  // that can land after "now" and render as "in 1 hour". Pull any such thread back to just now.
  const nowAgain = new Date();
  const futureThreads = await prisma.engineerChatThread.findMany({ where: { userId: DEMO, updatedAt: { gt: nowAgain } }, select: { id: true } });
  for (const [i, t] of futureThreads.entries()) {
    const at = new Date(nowAgain.getTime() - (20 + i * 15) * MIN);
    console.log(`  thread ${t.id} was in the future → ${at.toISOString()}`);
    if (dryRun) continue;
    await prisma.engineerChatThread.update({ where: { id: t.id }, data: { createdAt: at, updatedAt: at } });
    const msgs = await prisma.engineerChatMessage.findMany({ where: { threadId: t.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
    for (const [j, m] of msgs.entries()) await prisma.engineerChatMessage.update({ where: { id: m.id }, data: { createdAt: new Date(at.getTime() + j * 30_000) } });
  }

  // A run's setup was "saved" when the run was — the seed carried the founder's real save times,
  // which can sit days after the run and, once shifted, land in the future ("On the car now ·
  // 06/09/2026"). Snapshots shared by several runs take the earliest.
  const snapRuns = await prisma.run.findMany({ where: { userId: DEMO }, orderBy: { sortAt: "asc" }, select: { sortAt: true, setupSnapshotId: true } });
  const firstUse = new Map<string, Date>();
  for (const r of snapRuns) if (!firstUse.has(r.setupSnapshotId!)) firstUse.set(r.setupSnapshotId!, r.sortAt);
  if (!dryRun) for (const [id, at] of firstUse) await prisma.setupSnapshot.update({ where: { id }, data: { createdAt: at } });
  console.log(`  ${firstUse.size} run snapshots dated to their run`);
  // The run page prints the timing import's own stamp ahead of the run's, and the seed carried the
  // founder's real import times (a race imported two days after it ran shows "6 Sept" on a 4 Sept
  // run). Pin every lap set to the run it belongs to.
  const lapSetRuns = await prisma.run.findMany({ where: { userId: DEMO }, select: { id: true, sortAt: true, loggingCompletedAt: true, importedLapSets: { select: { id: true } } } });
  let pinned = 0;
  for (const r of lapSetRuns) {
    if (r.loggingCompletedAt && !dryRun) await prisma.run.update({ where: { id: r.id }, data: { loggingCompletedAt: new Date(r.sortAt.getTime() + 9 * MIN) } });
    for (const l of r.importedLapSets) {
      pinned++;
      if (!dryRun) await prisma.runImportedLapSet.update({ where: { id: l.id }, data: { sessionCompletedAt: new Date(r.sortAt.getTime() + 6 * MIN), createdAt: new Date(r.sortAt.getTime() + 8 * MIN) } });
    }
  }
  console.log(`  ${pinned} lap sets pinned to their run`);
  // Anything else still in the future (imports "added" next month, setups saved in October) is
  // pulled back to just before now, newest last, so nothing on any list post-dates today.
  const clampMany = async (label: string, rows: Array<{ id: string; at: Date }>, write: (id: string, at: Date) => Promise<unknown>) => {
    const future = rows.filter((r) => r.at.getTime() > nowAgain.getTime()).sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const [i, r] of future.entries()) if (!dryRun) await write(r.id, new Date(nowAgain.getTime() - (future.length - i) * 7 * MIN - 60 * MIN));
    if (future.length) console.log(`  ${label}: ${future.length} future-dated row(s) pulled back`);
  };
  await clampMany("imports", (await prisma.importedLapTimeSession.findMany({ where: { userId: DEMO }, select: { id: true, createdAt: true } })).map((r) => ({ id: r.id, at: r.createdAt })), (id, at) => prisma.importedLapTimeSession.update({ where: { id }, data: { createdAt: at, updatedAt: at } }));
  await clampMany("setups", (await prisma.setupSnapshot.findMany({ where: { userId: DEMO }, select: { id: true, createdAt: true } })).map((r) => ({ id: r.id, at: r.createdAt })), (id, at) => prisma.setupSnapshot.update({ where: { id }, data: { createdAt: at } }));
  await clampMany("tyre sets", (await prisma.tireSet.findMany({ where: { userId: DEMO }, select: { id: true, createdAt: true } })).map((r) => ({ id: r.id, at: r.createdAt })), (id, at) => prisma.tireSet.update({ where: { id }, data: { createdAt: at } }));
  await clampMany("action items", (await prisma.actionItem.findMany({ where: { userId: DEMO }, select: { id: true, createdAt: true } })).map((r) => ({ id: r.id, at: r.createdAt })), (id, at) => prisma.actionItem.update({ where: { id }, data: { createdAt: at, updatedAt: at } }));

  // ── 7. Case-only setup "changes" ──────────────────────────────────────────────
  // A few snapshots were saved with lower-cased presets ("STD" → "std") and stringified numbers.
  // The dashboard's Last-change line reads the case flip as a real change. Where a run's setup
  // agrees with the previous run's ignoring case and number-vs-string, copy the earlier value.
  const seq = await prisma.run.findMany({ where: { userId: DEMO }, orderBy: [{ carId: "asc" }, { sortAt: "asc" }], select: { id: true, carId: true, setupSnapshotId: true, setupSnapshot: { select: { id: true, data: true } } } });
  let normalised = 0;
  const canon = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim().toLowerCase() : JSON.stringify(v)?.toLowerCase());
  for (let i = 1; i < seq.length; i++) {
    const prev = seq[i - 1], cur = seq[i];
    if (prev.carId !== cur.carId || !prev.setupSnapshot || !cur.setupSnapshot || prev.setupSnapshotId === cur.setupSnapshotId) continue;
    const a = prev.setupSnapshot.data as Record<string, unknown>;
    const b = { ...(cur.setupSnapshot.data as Record<string, unknown>) };
    let changed = false;
    for (const k of Object.keys(b)) {
      if (!(k in a) || JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
      if (canon(a[k]) === canon(b[k])) { b[k] = a[k]; changed = true; }
    }
    if (!changed) continue;
    normalised++;
    if (!dryRun) await prisma.setupSnapshot.update({ where: { id: cur.setupSnapshot.id }, data: { data: b as object } });
  }
  console.log(`  ${normalised} snapshot(s) had case-only or type-only differences from the run before — normalised`);

  const newest = await prisma.run.findFirst({ where: { userId: DEMO }, orderBy: { sortAt: "desc" }, select: { sortAt: true } });
  console.log(`\nDone. Newest demo run: ${newest?.sortAt.toISOString()} (${newest ? ymdIn(TIME_ZONE, newest.sortAt) : "-"} ${TIME_ZONE}); today is ${todayYmd}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
