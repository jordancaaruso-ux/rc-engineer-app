/**
 * Run: `npm run test:engineer-history`.
 *
 * The LAPS block's figures are what the Engineer quotes when a driver asks "was that actually
 * faster?", so every number under a driver's laps must be the arithmetic it claims to be. The
 * laps in the later tests are the founder's own SA State Titles heats (12 Sep 2026), where round 06
 * went wrong: a short opening lap read as a best, a 0.91 that is 0.68, a lost first lap nobody saw.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lapsFigures,
  lapsRivalNames,
  renderLapsBlock,
  MAX_LAPS_SESSIONS,
  type LapsSession,
} from "@/lib/engineer/lapsBlock";

const laps = (...xs: number[]): number[] => xs;

test("figures: best, top5, median, first five → last five, spread", () => {
  // Eleven laps: first five around 17.6, last five around 17.9, one binned lap in the middle.
  const f = lapsFigures(laps(17.6, 17.5, 17.7, 17.6, 17.6, 25.0, 17.8, 17.9, 17.8, 18.0, 17.9));
  assert.ok(f);
  assert.equal(f.best, 17.5);
  assert.equal(f.top5.toFixed(3), ((17.5 + 17.6 + 17.6 + 17.6 + 17.7) / 5).toFixed(3));
  // sorted: 17.5 17.6 17.6 17.6 17.7 17.8 17.8 17.9 17.9 18.0 25.0 → the sixth, 17.8
  assert.equal(f.median.toFixed(2), "17.80");
  // first five 17.6 17.5 17.7 17.6 17.6 → 17.6; last five 17.9 17.8 18.0 17.9 → with 17.8 → 17.9
  assert.equal(f.firstFive?.toFixed(2), "17.60");
  assert.equal(f.lastFive?.toFixed(2), "17.90");
  assert.equal(f.lastFiveVsFirstFive?.toFixed(2), "0.30");
  assert.equal(f.slowInFirstFive, 0);
  assert.equal(f.slowInLastFive, 0);
  // p10 = rank 2 (17.6), p90 = rank 10 (18.0)
  assert.equal(f.spread?.toFixed(2), "0.40");
  // The 25.0 is a slow lap: in the total and the lap count, out of the average without slow laps.
  assert.deepEqual(f.slowLaps, [25.0]);
  assert.equal(f.cleanAverage?.toFixed(3), ((17.6 + 17.5 + 17.7 + 17.6 + 17.6 + 17.8 + 17.9 + 17.8 + 18.0 + 17.9) / 10).toFixed(3));
  assert.equal(f.lapCount, 11);
  assert.equal(f.total.toFixed(2), "202.40");
});

test("figures: a five with slow laps in it says how many", () => {
  // Tim Hilyear, the founder's last SA heat: three slow laps in his last five.
  const tim = lapsFigures(laps(18.53, 18.67, 17.89, 18.07, 18.2, 18.0, 18.1, 18.3, 18.25, 18.1, 18.12, 18.4, 18.28, 20.05, 18.23, 21.13, 20.2));
  assert.ok(tim);
  assert.deepEqual(tim.slowLaps, [20.05, 21.13, 20.2]);
  assert.equal(tim.lastFive?.toFixed(2), "20.05");
  assert.equal(tim.slowInLastFive, 3);
  assert.equal(tim.slowInFirstFive, 0);
  const out = renderLapsBlock([{ label: "Heat", className: null, clock: "17:48", dateYmd: "2026-09-12", drivers: [{ name: "TIM", isMe: false, laps: tim ? [18.53, 18.67, 17.89, 18.07, 18.2, 18.0, 18.1, 18.3, 18.25, 18.1, 18.12, 18.4, 18.28, 20.05, 18.23, 21.13, 20.2] : [] }, { name: "ME", isMe: true, laps: [18, 18] }] }], "x");
  assert.ok((out ?? "").includes("first five 18.20 → last five 20.05 (3 slow) (+1.85)"));
});

test("figures: a race's opening lap from the grid is listed but left out of the figures", () => {
  // 7.11 in an 18-second class: the run from the grid to the line, as LiveRC prints it.
  const f = lapsFigures(laps(7.11, 19.3, 17.76, 17.66, 18.26, 17.98, 17.85, 17.69, 17.96, 18.04, 18.02, 18.0));
  assert.ok(f);
  assert.equal(f.best, 17.66);
  assert.equal(f.shortLaps, 1);
  assert.equal(f.lapCount, 12, "the timing site counts it");
  assert.deepEqual(f.slowLaps, [19.3]);
  // The eleven real laps: first five 19.3 17.76 17.66 18.26 17.98 → 17.98 (one slow); last five 17.69 17.96 18.04 18.02 18.00 → 18.00.
  assert.equal(f.lastFiveVsFirstFive?.toFixed(2), "0.02");
  assert.equal(f.slowInFirstFive, 1);
  assert.equal(lapsFigures(laps(17.5, 17.6, 17.7))?.shortLaps, 0);
});

test("figures: a best the RIVALS table would not believe is a short lap here too", () => {
  // Rhys Marshall, SA heat one: a 16.17 opening lap, then 17.98 and nothing under 18.06.
  const rhys = laps(16.17, 18.66, 17.98, 19.0, 18.11, 18.37, 18.64, 18.82, 18.06, 19.01, 18.83, 18.64, 18.77, 18.77, 18.73, 18.64, 18.98);
  const f = lapsFigures(rhys);
  assert.ok(f);
  assert.equal(f.best, 17.98);
  assert.equal(f.shortLaps, 1);
  assert.equal(f.top5.toFixed(2), "18.23");
  // His six-lap heat with two crash laps: 18.66 is a real lap. Measured against the best five it
  // looked impossible (the crashes sat in the five); against his next-best lap it is 0.21 quicker.
  const messy = lapsFigures(laps(19.27, 21.8, 19.6, 18.87, 18.66, 22.38));
  assert.equal(messy?.best, 18.66);
  assert.equal(messy?.shortLaps, 0);
  assert.deepEqual(messy?.slowLaps, [21.8, 22.38]);
  // A warm-up practice run: every lap a different speed, none of them a cut.
  const practice = lapsFigures(laps(18.51, 18.05, 19.52, 19.41, 17.83, 33.66, 20.49));
  assert.equal(practice?.best, 17.83);
  assert.equal(practice?.shortLaps, 0);
  // Two laps, the second a crash: nothing to judge the first against, so it stands.
  assert.equal(lapsFigures(laps(18.51, 24.55))?.shortLaps, 0);
});

test("figures: under ten laps there is no first/last five; under five no spread; none for no laps", () => {
  const nine = lapsFigures(laps(17, 17, 17, 17, 17, 17, 17, 17, 17));
  assert.equal(nine?.lastFiveVsFirstFive, null);
  assert.equal(nine?.firstFive, null);
  assert.equal(nine?.spread, 0);
  const four = lapsFigures(laps(17, 17, 17, 17));
  assert.equal(four?.spread, null);
  assert.equal(lapsFigures([]), null);
  assert.equal(lapsFigures([NaN, 0, -1]), null);
});

function session(over: Partial<LapsSession> & { drivers: LapsSession["drivers"] }): LapsSession {
  return { label: "Heat 2", className: "ISTC 13.5t", clock: "10:42", dateYmd: "2026-09-12", ...over };
}

test("render: finishing order worked out from laps and time, with places and gaps", () => {
  const out = renderLapsBlock(
    [
      session({
        clock: "09:37",
        label: "Practice",
        className: null,
        drivers: [{ name: "you", isMe: true, laps: laps(17.72, 17.6, 17.65) }],
      }),
      session({
        drivers: [
          // "You" first, as LiveRC's parser stores it — not the finishing order.
          { name: "Jordan Caruso", isMe: true, laps: laps(17.51, 17.39, 17.44) },
          { name: "Timothy Hilyear", isMe: false, laps: laps(17.4, 17.3, 17.5) },
          { name: "Slow Coach", isMe: false, laps: laps(19.0, 19.0) },
        ],
      }),
    ],
    "on 12 Sep 2026 at Radio Racing Cars SA"
  );
  assert.ok(out);
  assert.match(out, /^LAPS — every lap of every driver in the timed sessions you were in, on 12 Sep 2026 at Radio Racing Cars SA\./);
  const lines = out.split("\n");
  const practice = lines.findIndex((l) => l.startsWith("09:37  Practice  (1 driver)"));
  const heat = lines.findIndex((l) => l.startsWith("10:42  Heat 2 · ISTC 13.5t  (3 drivers, in finishing order)"));
  assert.ok(practice > 0 && heat > practice, "sessions in the order given, practice first");
  assert.equal(lines[practice + 1], "  you · 3 laps 0:52.97: 17.72 17.60 17.65", "a practice page's one driver is plain 'you'");
  assert.equal(lines[heat + 1], "  P1 Timothy Hilyear · 3 laps 0:52.20: 17.40 17.30 17.50");
  assert.match(lines[heat + 2], /^ {6}best 17\.30 · top5 17\.40 · median 17\.40 · average 17\.40$/);
  assert.equal(lines[heat + 3], "  P2 Jordan Caruso (you) · 3 laps 0:52.34, +0.14: 17.51 17.39 17.44");
  assert.equal(lines[heat + 5], "  P3 Slow Coach · 2 laps 0:38.00, 1 lap down: 19.00 19.00");
  assert.match(out, /A session with one driver is a practice session/);
  assert.doesNotMatch(out, /could not be told apart/);
  assert.doesNotMatch(out, /2026-09-12  10:42/, "one day: no date on the session line");
});

test("render: a race with a lap from the grid gets no places", () => {
  const out = renderLapsBlock(
    [
      session({
        drivers: [
          { name: "Jordan Caruso", isMe: true, laps: laps(7.11, 19.3, 17.76, 17.66, 18.26, 17.98) },
          { name: "Rhys Marshall", isMe: false, laps: laps(16.17, 18.66, 17.98, 19.0, 18.11, 18.37) },
        ],
      }),
    ],
    "x"
  );
  assert.ok(out);
  assert.match(out, /\(2 drivers, no places: a short lap on the sheet\)/);
  assert.doesNotMatch(out, /^ {2}P\d/m);
  assert.match(out, /1 short lap left out/);
});

test("render: a sheet with nobody matched says so; two days print their dates", () => {
  const out = renderLapsBlock(
    [
      session({
        dateYmd: "2026-09-11",
        drivers: [
          { name: "A", isMe: false, laps: laps(17, 17) },
          { name: "B", isMe: false, laps: laps(18, 18) },
        ],
      }),
      session({ dateYmd: "2026-09-12", drivers: [{ name: "Me", isMe: true, laps: laps(17, 17) }] }),
    ],
    "across the meeting"
  );
  assert.ok(out);
  assert.match(out, /could not be told apart by name or chip/);
  assert.match(out, /^2026-09-11  10:42  Heat 2/m);
  assert.match(out, /^2026-09-12  10:42  Heat 2/m);
});

test("render: nothing to show → null; sessions with no laps are skipped", () => {
  assert.equal(renderLapsBlock([], "x"), null);
  assert.equal(renderLapsBlock([session({ drivers: [{ name: "A", isMe: true, laps: [] }] })], "x"), null);
});

test("render: over the session cap the earliest are dropped and counted", () => {
  const many = Array.from({ length: MAX_LAPS_SESSIONS + 3 }, (_, i) =>
    session({ clock: `${String(8 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`, drivers: [{ name: "Me", isMe: true, laps: laps(17, 17) }] })
  );
  const out = renderLapsBlock(many, "x");
  assert.ok(out);
  assert.match(out, /The 3 earliest sessions are not shown\./);
  assert.doesNotMatch(out, /^08:00  /m);
  assert.match(out, /^08:45  /m);
});

test("render: the other drivers against their own day — the track's movement", () => {
  // Three drivers, three races: everyone 0.10 quicker in the second, 0.10 slower in the third.
  // Full races (ten laps each): a short heat is not counted.
  const d = (_name: string, base: number) => laps(...Array.from({ length: 10 }, () => base));
  const out = renderLapsBlock(
    [0, -0.1, 0.1].map((shift, i) =>
      session({
        clock: `1${i}:00`,
        drivers: [
          { name: "Me", isMe: true, laps: d("Me", 17.5) },
          { name: "A", isMe: false, laps: d("A", 18 + shift) },
          { name: "B", isMe: false, laps: d("B", 18.4 + shift) },
          { name: "C", isMe: false, laps: d("C", 18.8 + shift) },
        ],
      })
    ),
    "x"
  );
  assert.ok(out);
  assert.match(out, /^10:00 .*the other drivers against their own day \+0\.00 \(3 drivers\)$/m);
  assert.match(out, /^11:00 .*the other drivers against their own day −0\.10 \(3 drivers\)$/m);
  assert.match(out, /^12:00 .*the other drivers against their own day \+0\.10 \(3 drivers\)$/m);
  assert.match(out, /"The other drivers against their own day"/);
});

test("render: you against a named driver, lap by lap, with the sums done", () => {
  // SA, the last heat: Jordan's 19.86 first lap and 19.51 on lap 13; Tim's late trouble.
  const jordan = laps(19.86, 18.19, 18.12, 18.26, 17.95, 17.94, 18.15, 18.04, 18.04, 18.03, 18.16, 18.21, 19.51, 18.45, 18.45, 18.8, 18.3);
  const tim = laps(18.53, 18.67, 17.89, 18.07, 18.2, 18.0, 18.1, 18.3, 18.25, 18.1, 18.12, 18.4, 18.28, 20.05, 18.23, 21.13, 20.2);
  const sessions = [
    session({
      clock: "17:48",
      drivers: [
        { name: "JORDAN CARUSO", isMe: true, laps: jordan },
        { name: "TIMOTHY HILYEAR", isMe: false, laps: tim },
      ],
    }),
  ];
  assert.deepEqual(lapsRivalNames(sessions), ["TIMOTHY HILYEAR"]);
  const out = renderLapsBlock(sessions, "x", { rival: { name: "TIMOTHY HILYEAR", word: "tim" } });
  assert.ok(out);
  assert.match(out, /^ {2}P1 JORDAN CARUSO \(you\) · 17 laps 5:12\.46: /m);
  assert.match(out, /^ {2}P2 TIMOTHY HILYEAR · 17 laps 5:16\.52, \+4\.06: /m);
  assert.match(out, /^YOU AGAINST TIMOTHY HILYEAR \("tim" in the question\), LAP BY LAP — the 1 session you both drove/m);
  assert.match(out, /^ {2}your lap minus theirs: \+1\.33 −0\.48 \+0\.23 /m, "lap 1 is where he lost 1.33");
  assert.match(out, /^ {2}running total: {9}\+1\.33 \+0\.85 \+1\.08 /m);
  assert.match(out, / −4\.06$/m, "the running total ends at the race gap");
});

test("render: no named driver, no lap-by-lap section", () => {
  const out = renderLapsBlock(
    [session({ drivers: [{ name: "Me", isMe: true, laps: laps(17, 17) }, { name: "Them", isMe: false, laps: laps(18, 18) }] })],
    "x"
  );
  assert.ok(out);
  assert.doesNotMatch(out, /LAP BY LAP/);
});
