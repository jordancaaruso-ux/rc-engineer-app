import test from "node:test";
import assert from "node:assert/strict";

import { describePostedDay, resolveScanStatus } from "@/lib/lapImport/scanStatusCopy";
import type { LapDiscoveryStatus } from "@/lib/lapWatch/lapDiscoveryStatus";

function st(partial: Partial<LapDiscoveryStatus> & Pick<LapDiscoveryStatus, "code">): LapDiscoveryStatus {
  return {
    sources: ["liverc"],
    postedCount: 0,
    matchedCount: 0,
    timingPages: [{ source: "liverc", url: "https://borrccc.liverc.com/practice/" }],
    sessionsToday: [],
    ...partial,
  };
}

function ask(status: LapDiscoveryStatus | null, over: Partial<Parameters<typeof resolveScanStatus>[0]> = {}) {
  return resolveScanStatus({
    status,
    scanMessage: null,
    totalCandidates: 0,
    unimportedCount: 0,
    candidateCount: 0,
    olderCount: 0,
    importedCount: 0,
    ...over,
  });
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const kinds = (s: ReturnType<typeof ask>) => (s?.actions ?? []).map((a) => a.kind);

test("a list to show says nothing at all", () => {
  assert.equal(ask(st({ code: "no_match" }), { candidateCount: 3 }), null);
});

test("no identity: asks for both halves, name and transponder", () => {
  const s = ask(st({ code: "no_identity" }));
  assert.match(s!.detail!, /driver name and transponder number/);
  assert.ok(kinds(s).includes("settings"));
});

test("no match today: leads with 'might not be uploaded yet', not with your name", () => {
  const s = ask(st({ code: "no_match", postedCount: 14, postedDayIso: today() }));
  assert.match(s!.title, /^14 sessions posted today/);
  assert.match(s!.detail!, /^Yours might not be uploaded yet/);
  assert.deepEqual(kinds(s), ["settings", "timingPage"]);
});

test("no match, one session: counts in the singular", () => {
  const s = ask(st({ code: "no_match", postedCount: 1, postedDayIso: today() }));
  assert.match(s!.title, /^1 session posted today/);
});

test("the day's list is days old: says nothing is up today, and blames nobody's name", () => {
  // Bendigo, scanned on a Thursday, answering with Monday's sessions. Said as "posted today,
  // none yours" this reads as an accusation about a name that is probably fine.
  const s = ask(st({ code: "no_match", postedCount: 31, postedDayIso: "2020-01-06" }));
  assert.match(s!.title, /Nothing posted at this track yet today/);
  // Day formatting follows the viewer's own locale, so assert the day is named, not its order.
  assert.match(s!.detail!, /most recent sessions here are from Mon, (6 Jan|Jan 6)/);
  assert.match(s!.detail!, /31 of them, none matched you/);
  assert.doesNotMatch(s!.detail!, /Settings/);
  assert.deepEqual(kinds(s), ["retry", "timingPage"]);
});

test("an older day with nothing counted still doesn't invent a count", () => {
  const s = ask(st({ code: "no_match", postedCount: 0, postedDayIso: "2020-01-06" }));
  assert.doesNotMatch(s!.detail!, /0 of them/);
});

test("results with no transponder column ask for the name, not the number", () => {
  const s = ask(
    st({
      code: "no_match",
      sources: ["speedhive"],
      postedCount: 22,
      postedDayIso: today(),
      transponderNotPublished: true,
    })
  );
  assert.match(s!.detail!, /without transponder numbers/);
  assert.match(s!.detail!, /name you appear under/);
});

test("nothing posted: never mentions your name or transponder", () => {
  const s = ask(st({ code: "nothing_posted" }));
  assert.match(s!.title, /Nothing posted at this track yet/);
  assert.doesNotMatch(s!.detail!, /name|transponder/i);
  assert.deepEqual(kinds(s), ["retry", "timingPage"]);
});

test("unreachable: names the site, offers a way round it", () => {
  const s = ask(st({ code: "unreachable", sources: ["speedhive"] }));
  assert.match(s!.title, /Couldn't reach MYLAPS/);
  assert.deepEqual(kinds(s), ["retry", "timingPage", "paste"]);
});

test("unreachable across both sites names both", () => {
  const s = ask(st({ code: "unreachable", sources: ["liverc", "speedhive"] }));
  assert.match(s!.title, /LiveRC and MYLAPS/);
});

test("all imported: points at the list below rather than dead-ending", () => {
  const s = ask(st({ code: "all_imported", matchedCount: 6 }), { importedCount: 6 });
  assert.match(s!.detail!, /6 sessions found for you here are already in/);
  assert.match(s!.detail!, /below if you want one again/);
});

test("all imported, exactly one: reads as English, not as a template", () => {
  const s = ask(st({ code: "all_imported", matchedCount: 1 }), { importedCount: 1 });
  assert.match(s!.detail!, /1 session .* is already in/);
  assert.match(s!.detail!, /It's below if you want it again/);
});

test("no timing page on the track: sends you to the track, not to Settings", () => {
  const s = ask(st({ code: "no_timing_page", timingPages: [] }));
  assert.deepEqual(kinds(s), ["track", "paste"]);
  assert.doesNotMatch(s!.title, /name/i);
});

test("invalid saved link is a track problem too", () => {
  const s = ask(st({ code: "invalid_url", timingPages: [] }));
  assert.deepEqual(kinds(s), ["track", "paste"]);
});

test("one door per site, even when several pages were scanned", () => {
  const s = ask(
    st({
      code: "no_match",
      postedDayIso: today(),
      postedCount: 4,
      timingPages: [
        { source: "liverc", url: "https://x.liverc.com/practice/" },
        { source: "liverc", url: "https://x.liverc.com/results/" },
        { source: "speedhive", url: "https://speedhive.mylaps.com/practice/1" },
      ],
    })
  );
  assert.deepEqual(kinds(s), ["settings", "timingPage", "timingPage"]);
});

test("no structured state: an older day's backlog still explains itself", () => {
  const s = ask(null, { olderCount: 4 });
  assert.match(s!.title, /No sessions from today yet/);
  assert.match(s!.detail!, /4 older sessions available below/);
});

test("no structured state: a server sentence is passed through untouched", () => {
  const s = ask(null, { scanMessage: "MyRCM lists sessions by class and round — pick the one you raced." });
  assert.match(s!.title, /MyRCM lists sessions/);
  assert.deepEqual(kinds(s), []);
});

test("every state ends in something pressable, except a passed-through sentence", () => {
  const codes = [
    "no_identity",
    "no_match",
    "nothing_posted",
    "unreachable",
    "all_imported",
    "no_timing_page",
    "invalid_url",
  ] as const;
  for (const code of codes) {
    const s = ask(st({ code, postedDayIso: today() }));
    assert.ok(kinds(s).length > 0, `${code} offered no action`);
    assert.ok(s!.title.trim().length > 0, `${code} had no title`);
  }
});

test("no state and no message still says something", () => {
  const s = ask(null);
  assert.match(s!.title, /No new sessions to import/);
});

test("describePostedDay: today is today, and junk is not a day", () => {
  assert.equal(describePostedDay(today())?.isToday, true);
  assert.equal(describePostedDay("2020-01-06")?.isToday, false);
  assert.equal(describePostedDay("not-a-date"), null);
  assert.equal(describePostedDay(null), null);
  assert.equal(describePostedDay(""), null);
});
