/**
 * The Engineer's one tool: LiveRC's practice page for a day at the subject's track, on request
 * (founder call 2026-09-22: "it's fine for the engineer to call it upon request … you could be
 * asking midday, and then it's going to have to get it anyway").
 *
 * Why a tool and not a block: a race result the driver was in is already stored whole, so it
 * rides on the wire in the LAPS block. Other people's PRACTICE is not stored — the app reads
 * it from LiveRC when someone asks (practiceField.ts, on a press, never on a timer) — and a
 * question asked at lunchtime needs the morning that has happened, not last night's copy.
 *
 * The result text opens with "DRIVER DATA" on purpose: the prompt's never-invent-a-number
 * sentence names DRIVER DATA as the logged data the Engineer may use, and a tool result is
 * exactly that. Facts, no instructions, like every other block.
 *
 * Pure: the definition and the renderer have no server imports. The executor is in tools.ts.
 */
import { trackClockTime } from "@/lib/lapImport/trackClock";
import type { PracticeFieldDriver } from "@/lib/practiceField/practiceField";

export const LIVERC_PRACTICE_TOOL_NAME = "read_liverc_practice_day";

/** OpenAI function-tool definition, Chat Completions shape (openai.ts flattens it for Responses). */
export const LIVERC_PRACTICE_TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: LIVERC_PRACTICE_TOOL_NAME,
    description:
      "Reads LiveRC's practice page for one day at the track in DRIVER DATA: every driver who practised that day, their class and transponder, and for each of their sessions the track's clock, the lap count and the fastest lap. One request to LiveRC, a few seconds. DRIVER DATA already holds the driver's own laps and every race result they were in; this adds what everyone else did in practice through that day.",
    parameters: {
      type: "object",
      properties: {
        day: { type: "string", description: "The day to read, YYYY-MM-DD, the track's own date." },
      },
      required: ["day"],
      additionalProperties: false,
    },
    strict: true,
  },
};

export function parsePracticeDayArg(argumentsJson: string): string | null {
  try {
    const parsed = JSON.parse(argumentsJson) as { day?: unknown };
    const day = typeof parsed.day === "string" ? parsed.day.trim() : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? day : null;
  } catch {
    return null;
  }
}

const fmt = (v: number): string => v.toFixed(2);

/**
 * The session's time as the track's timing screen showed it. LiveRC lists practice in the track's
 * own time with no zone, and the parser stores those digits as-if-UTC (trackClock.ts), so they are
 * read back as they are — the same reading the app's practice list uses. Reading them in a zone
 * shifted Adelaide's 08:58 practice to 18:28, and the Engineer told a driver about an afternoon
 * practice that never happened (2026-09-23).
 */
function clockOf(iso: string | null, sessionUrl: string): string | null {
  const at = trackClockTime({ iso, timingSource: "liverc", sourceUrl: sessionUrl });
  return at ? at.toISOString().slice(11, 16) : null;
}

function classKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The tool's answer as text. `myClass` is the class the driver logged for the run, when known:
 * that class is listed first. Drivers within a class run fastest-first by their best lap of
 * the day; a driver's sessions run earliest-first.
 */
export function renderLivercPracticeDay(params: {
  trackName: string;
  dayYmd: string;
  drivers: readonly PracticeFieldDriver[];
  myClass: string | null;
}): string {
  const head = `DRIVER DATA — LIVERC PRACTICE at ${params.trackName}, ${params.dayYmd}, read from LiveRC just now.`;
  if (params.drivers.length === 0) {
    return `${head} Nobody's practice is listed for that day: either nobody practised on the timing loop, or LiveRC has no practice page for it.`;
  }
  const sessionsTotal = params.drivers.reduce((n, d) => n + (d.sessions?.length ?? 0), 0);
  const byClass = new Map<string, PracticeFieldDriver[]>();
  for (const d of params.drivers) {
    const k = d.className?.trim() || "no class given";
    if (!byClass.has(k)) byClass.set(k, []);
    byClass.get(k)!.push(d);
  }
  const mine = classKey(params.myClass);
  const classes = [...byClass.keys()].sort((a, b) => {
    const am = mine !== "" && (classKey(a) === mine || classKey(a).includes(mine) || mine.includes(classKey(a)));
    const bm = mine !== "" && (classKey(b) === mine || classKey(b).includes(mine) || mine.includes(classKey(b)));
    if (am !== bm) return am ? -1 : 1;
    return byClass.get(b)!.length - byClass.get(a)!.length || a.localeCompare(b);
  });

  const lines: string[] = [];
  for (const cls of classes) {
    const drivers = [...byClass.get(cls)!].sort(
      (a, b) => (a.bestLapSeconds ?? Infinity) - (b.bestLapSeconds ?? Infinity) || (a.siteName ?? "").localeCompare(b.siteName ?? "")
    );
    lines.push(`${cls} — ${drivers.length} driver${drivers.length === 1 ? "" : "s"}`);
    for (const d of drivers) {
      const who = [d.siteName ?? (d.transponder ? `chip ${d.transponder}` : "unnamed"), d.isViewer ? "(you)" : null]
        .filter(Boolean)
        .join(" ");
      const sessions = [...(d.sessions ?? [])]
        .sort((a, b) => Date.parse(a.sessionCompletedAtIso ?? "") - Date.parse(b.sessionCompletedAtIso ?? ""))
        .map((s) =>
          [
            clockOf(s.sessionCompletedAtIso, s.sessionUrl) ?? "time unknown",
            s.lapCount != null ? `${s.lapCount} laps` : null,
            s.bestLapSeconds != null ? `fastest ${fmt(s.bestLapSeconds)}` : "no fastest lap",
          ]
            .filter(Boolean)
            .join(" ")
        );
      lines.push(`  ${who}: ${sessions.join(" · ") || "no sessions"}`);
    }
    lines.push("");
  }
  return [
    `${head} ${params.drivers.length} driver${params.drivers.length === 1 ? "" : "s"}, ${sessionsTotal} session${sessionsTotal === 1 ? "" : "s"}. By class${mine ? ", your own class first" : ""}; drivers by their fastest lap of the day; each driver's sessions earliest first as the track's clock, laps, fastest lap. "(you)" is your own chip or LiveRC name. Every session on LiveRC's page is here, whoever drove it.`,
    "",
    ...lines,
  ]
    .join("\n")
    .trimEnd();
}
