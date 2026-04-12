import "server-only";

import { getOpenAiApiKey } from "@/lib/openaiServerEnv";
import { formatLocalCalendarDate } from "@/lib/engineerPhase5/localCalendarInTimeZone";
import { searchRunsForEngineerTool, type SearchRunsForEngineerResultRow } from "@/lib/engineerPhase5/engineerRunSearchTools";

const MODEL = "gpt-4o-mini";

/** Pre-computed run list for the user's question — not limited to latest-vs-previous. */
export type ResolvedRunScopeV1 = {
  version: 1;
  /** Short description of what was interpreted (for the model + debugging). */
  label: string;
  dateFrom: string | null;
  dateTo: string | null;
  textContains: string | null;
  runs: SearchRunsForEngineerResultRow[];
  truncated: boolean;
  /** When true, system prompt tells the model not to treat defaultDashboardContext as the full story. */
  preferOverDefaultPair: boolean;
};

type ExtractionJson = {
  kind?: string;
  date_from?: string | null;
  date_to?: string | null;
  text_contains?: string | null;
  label?: string | null;
};

function mustGetKey(): string {
  const k = getOpenAiApiKey();
  if (!k) throw new Error("OPENAI_API_KEY is not set");
  return k;
}

/**
 * Fast skip: greetings / tiny messages unlikely to need a run search.
 */
export function shouldAttemptResolveRunScope(lastUserMessage: string): boolean {
  const t = lastUserMessage.trim();
  if (t.length < 6) return false;
  const lower = t.toLowerCase();
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no)\.?$/i.test(t)) return false;

  // Likely temporal / scope / inventory language
  if (
    /\b(today|yesterday|tomorrow|week|weekend|month|year|runs?|sessions?|practice|qualifying|race|morning|afternoon|evening|night|last time|that day|those|all my|every|compare|summary|outline|changes|happened|when|three|four|five|multiple|positive|april|january|february|march|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})\b/i.test(
      lower
    )
  ) {
    return true;
  }
  if (t.length > 40) return true;
  return false;
}

async function extractSearchIntent(params: {
  message: string;
  timeZone: string;
  now: Date;
}): Promise<ExtractionJson | null> {
  const apiKey = mustGetKey();
  const localToday = formatLocalCalendarDate(params.now, params.timeZone);
  const localNowIso = params.now.toISOString();

  const system = `You classify RC car run-log questions and output ONLY valid JSON (no markdown).
The user keeps runs with timestamps; each run has laps, car, track, session type, notes.

Your job: decide if the message asks about WHICH runs in time (one or more sessions), so we should search their log.
Output JSON with this shape:
{
  "kind": "default" | "search",
  "date_from": string | null,
  "date_to": string | null,
  "text_contains": string | null,
  "label": string
}

Rules:
- kind "default": chit-chat, thanks, OR questions that only need the globally "latest" summary (e.g. "how am I doing lately" with no time window) — not listing runs for a day/period.
- kind "search": user refers to a time window, calendar period, "today", "yesterday", "last weekend", "last week", "in March", "on Tuesday", "those three sessions", "all runs at X track", OR asks to summarize/compare multiple runs / outline a day / "what happened when".
- For dates: use the user's local calendar in time zone ${params.timeZone}. Today there is ${localToday} (reference now UTC: ${localNowIso}).
- date_from/date_to are inclusive YYYY-MM-DD in that local calendar, or null if not applicable.
- "Today" → date_from and date_to both ${localToday}.
- "Yesterday" → single local calendar day before ${localToday} (compute mentally).
- Weekends / vague ranges: pick a reasonable date_from/date_to (still YYYY-MM-DD).
- text_contains: optional substring for car name, track name, or event if the user names one (e.g. "A800", club name); else null.
- label: one short English phrase describing the filter (for the user-facing assistant).

If unsure between default and search, prefer "search" when ANY time period or run count is implied.

Return ONLY the JSON object.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: params.message.slice(0, 3500) },
      ],
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return null;
  const text = (data.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content?.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as ExtractionJson;
  } catch {
    return null;
  }
}

/**
 * Resolve which runs the user means from natural language; returns null to keep default context only.
 */
export async function resolveRunScopeForEngineerChat(input: {
  userId: string;
  lastUserMessage: string;
  timeZone: string;
}): Promise<ResolvedRunScopeV1 | null> {
  const msg = input.lastUserMessage.trim();
  if (!shouldAttemptResolveRunScope(msg)) return null;

  let tz = input.timeZone.trim();
  if (!tz) tz = "UTC";

  const extracted = await extractSearchIntent({
    message: msg,
    timeZone: tz,
    now: new Date(),
  });
  if (!extracted || extracted.kind !== "search") return null;

  const dateFrom = typeof extracted.date_from === "string" && extracted.date_from.trim() ? extracted.date_from.trim() : null;
  const dateTo = typeof extracted.date_to === "string" && extracted.date_to.trim() ? extracted.date_to.trim() : null;
  const textContains =
    typeof extracted.text_contains === "string" && extracted.text_contains.trim()
      ? extracted.text_contains.trim()
      : null;

  if (!dateFrom && !dateTo && !textContains) return null;

  const result = await searchRunsForEngineerTool(input.userId, {
    owner_scope: "mine",
    date_from: dateFrom,
    date_to: dateTo,
    text_contains: textContains,
    max_results: 40,
    calendar_time_zone: dateFrom || dateTo ? tz : null,
  });

  if (!result.ok) return null;

  const chronological = [...result.runs].sort(
    (a, b) => new Date(a.sortIso).getTime() - new Date(b.sortIso).getTime()
  );

  if (chronological.length === 0) {
    return {
      version: 1,
      label: extracted.label?.trim() || "Your search",
      dateFrom,
      dateTo,
      textContains,
      runs: [],
      truncated: false,
      preferOverDefaultPair: true,
    };
  }

  const preferOverDefaultPair = chronological.length >= 2 || Boolean(dateFrom || dateTo);

  return {
    version: 1,
    label: extracted.label?.trim() || "Runs matching your question",
    dateFrom,
    dateTo,
    textContains,
    runs: chronological,
    truncated: result.truncated,
    preferOverDefaultPair,
  };
}
