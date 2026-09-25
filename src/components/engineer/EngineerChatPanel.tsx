"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, ChevronDown, MessageSquarePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { EngineerMessageRatingRow } from "@/components/engineer/EngineerMessageRatingRow";
import { EngineerNextQuestions } from "@/components/engineer/EngineerNextQuestions";
import { OTHER_OPTIONS_QUESTION } from "@/lib/engineer/nextQuestions";
import { EngineerRangePicker, type EngineerRangeOptions } from "@/components/engineer/EngineerRangePicker";
import { EngineerRunPicker } from "@/components/engineer/EngineerRunPicker";
import { EngineerStarterQuestions } from "@/components/engineer/EngineerStarterQuestions";
import { EngineerSubjectBar } from "@/components/engineer/EngineerSubjectBar";
import { EngineerThinkingIndicator } from "@/components/engineer/EngineerThinkingIndicator";
import { EngineerSheetChanges } from "@/components/engineer/EngineerSheetChanges";
import { Button } from "@/components/ui/Button";
import { EngineerMarkdown } from "@/components/ui/EngineerMarkdown";
import { Eyebrow } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import {
  buildRunCandidate,
  sortCandidates,
  type RunCandidate,
  type RunCandidateRow,
} from "@/lib/engineer/runCandidates";
import {
  RANGE_URL_KEYS,
  describeRangeScope,
  eventScope,
  rangeScopeFromSearchParams,
  rangeScopeToQuery,
  sameRangeScope,
  trackScope,
  writeRangeScopeToSearchParams,
  type EngineerRangeScope,
} from "@/lib/engineer/rangeScope";
import { matchNamedScope } from "@/lib/engineer/nameMatch";
import {
  ENGINEER_STARTER_BOARD_COUNT,
  selectEngineerStarterQuestions,
  starterQuestionText,
  type EngineerStarterQuestion,
} from "@/lib/engineerStarterQuestions";
import { useUnits } from "@/components/providers/UnitsProvider";
import { hideUnfinishedLink, readSheetLinks, type SheetLinkTarget, type SheetLinks } from "@/lib/engineer/sheetLinks";

/**
 * The Engineer chat: the conversation card and the history card, the subject bar, the starter
 * questions, the composer, and ratings.
 *
 * The brain behind it is the 2026-08-13 rebuild (docs/ENGINEER_NORTH_STAR.md): one chat route,
 * the knowledge base, a short prompt, the driver's own recent runs, and nothing else. The LOOK is
 * the page as it stood on 2026-09-01 (founder call 2026-09-03: "revert the appearance, keep the
 * mind") — two cards, the drifting rail of starter questions on a phone and the board of six on a
 * desktop, the composer that a starter fills but never sends, and the subject bar with three
 * states the brain actually honours: Auto (your latest run), a pinned run, General (no run).
 *
 * What did not come back: setup pins, event pins and compare pairs (the brain reads none of
 * them), the follow-up choice chips (the reply no longer carries them), and the trivia in the
 * thinking bubble.
 */

type RatingContext = {
  question?: string;
  answer?: string;
  runId?: string | null;
  compareRunId?: string | null;
  nextQuestions?: string[];
  sheetLinks?: SheetLinks;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  messageId?: string;
  ratingContext?: RatingContext;
  /** The follow-up buttons the Engineer picked for this answer. */
  nextQuestions?: string[];
  /** What each setup-change link in this answer opens (sheetLinks.ts). */
  sheetLinks?: SheetLinks;
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((q): q is string => typeof q === "string" && q.trim().length > 0) : [];
}

type ThreadSummary = {
  id: string;
  title: string;
  preview: string | null;
  /** A plain-text taste of the ENGINEER's last answer. Only the first few threads carry one. */
  answerPreview?: string | null;
  updatedAt: string;
};

type EngineerChatFeedback = {
  threadId: string;
  assistantMessageId: string;
  ratingContext?: RatingContext;
};

export type EngineerQueuedChatPrompt = { id: number; text: string };

// History starts collapsed to the most recent few conversations; the rest live
// behind a "Show all" toggle so the card doesn't scroll into a wall of threads.
const HISTORY_COLLAPSED_COUNT = 4;
/** The top few history rows read as previews (question + a taste of the answer). */
const HISTORY_PREVIEW_COUNT = 3;

async function readSseStream(
  res: Response,
  handlers: {
    onToken?: (text: string) => void;
    onStatus?: (phase: string) => void;
    /** The setup-change links this answer may use, before its first word (sheetLinks.ts). */
    onLinks?: (links: SheetLinks) => void;
  }
): Promise<{ reply: string; nextQuestions: string[]; sheetLinks: SheetLinks; feedback: EngineerChatFeedback | null }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Stream had no body");
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  let nextQuestions: string[] = [];
  let sheetLinks: SheetLinks = {};
  let feedback: EngineerChatFeedback | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const lines = chunk.split("\n");
      let event = "message";
      let dataLine = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataLine = line.slice(5).trim();
      }
      if (!dataLine) continue;
      const data = JSON.parse(dataLine) as Record<string, unknown>;
      if (event === "token" && typeof data.t === "string") {
        reply += data.t;
        handlers.onToken?.(data.t);
      } else if (event === "status" && typeof data.phase === "string") {
        handlers.onStatus?.(data.phase);
      } else if (event === "links") {
        handlers.onLinks?.(readSheetLinks(data.links));
      } else if (event === "done") {
        if (typeof data.reply === "string" && data.reply.trim()) reply = data.reply;
        nextQuestions = stringList(data.nextQuestions);
        sheetLinks = readSheetLinks(data.sheetLinks);
        if (data.feedback && typeof data.feedback === "object") {
          const fb = data.feedback as Record<string, unknown>;
          if (typeof fb.threadId === "string" && typeof fb.assistantMessageId === "string") {
            feedback = {
              threadId: fb.threadId,
              assistantMessageId: fb.assistantMessageId,
              ratingContext:
                fb.ratingContext && typeof fb.ratingContext === "object"
                  ? (fb.ratingContext as RatingContext)
                  : undefined,
            };
          }
        }
      } else if (event === "error") {
        throw new Error(typeof data.message === "string" ? data.message : "Engineer chat failed");
      }
    }
  }

  return { reply, nextQuestions, sheetLinks, feedback };
}

function mapApiMessages(
  raw: Array<{ id?: string; role?: string; content?: string; ratingContext?: RatingContext }>
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of raw) {
    const role: ChatMessage["role"] = m.role === "assistant" ? "assistant" : "user";
    const content = typeof m.content === "string" ? m.content : "";
    if (!content.trim()) continue;
    if (role === "assistant") {
      out.push({
        role,
        content,
        messageId: typeof m.id === "string" ? m.id : undefined,
        ratingContext: m.ratingContext,
        nextQuestions: stringList(m.ratingContext?.nextQuestions),
        sheetLinks: readSheetLinks(m.ratingContext?.sheetLinks),
      });
    } else {
      out.push({ role, content });
    }
  }
  return out;
}

/**
 * The subject lives in the URL, so a link from a run page opens the Engineer already pinned
 * (`?pin=run:<id>`, and the older `?runId=<id>` that the lap-analysis compare still sends), and
 * a reload keeps it. `?mode=general` is General; `?mode=range&track=…&from=…&to=…` is a range
 * of runs (rangeScope.ts). Nothing in the URL is Auto.
 */
type Subject = { pinnedRunId: string | null; general: boolean; range: EngineerRangeScope | null };
const AUTO: Subject = { pinnedRunId: null, general: false, range: null };

function readSubject(searchParams: URLSearchParams): Subject {
  if (searchParams.get("mode") === "general") return { pinnedRunId: null, general: true, range: null };
  const range = rangeScopeFromSearchParams(searchParams);
  if (range) return { pinnedRunId: null, general: false, range };
  const pin = searchParams.get("pin")?.trim() ?? "";
  if (pin.startsWith("run:")) {
    const id = pin.slice("run:".length).trim();
    if (id) return { pinnedRunId: id, general: false, range: null };
  }
  const runId = searchParams.get("runId")?.trim() ?? "";
  return { pinnedRunId: runId || null, general: false, range: null };
}

export function EngineerChatPanel({
  queuedPrompt = null,
  onQueuedPromptConsumed,
  ratingsEnabled = false,
  hasRuns = false,
}: {
  queuedPrompt?: EngineerQueuedChatPrompt | null;
  onQueuedPromptConsumed?: () => void;
  ratingsEnabled?: boolean;
  /**
   * The driver has logged at least one run. With a run in focus (Auto or pinned) the run-family
   * starter questions make sense; in General they don't, because no run is attached.
   */
  hasRuns?: boolean;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const units = useUnits();
  const { pinnedRunId, general: generalMode, range: rangeScope } = readSubject(searchParams);
  // Stable identity for effects and the send callback: the URL re-parses to a new object
  // every render, but the same query string is the same range.
  const rangeQuery = rangeScope ? rangeScopeToQuery(rangeScope) : null;

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsErr, setThreadsErr] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  // null = not touched: open while there is no conversation, shut once one is on screen.
  const [historyOpen, setHistoryOpen] = useState<boolean | null>(null);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [statusPhase, setStatusPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [candidates, setCandidates] = useState<RunCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [candidatesErr, setCandidatesErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The range picker and what it offers. Options load the first time the picker opens or a
  // range is already in the URL; the count for the URL's range rides on the same fetch.
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [rangeOptions, setRangeOptions] = useState<EngineerRangeOptions | null>(null);
  const [rangeOptionsErr, setRangeOptionsErr] = useState<string | null>(null);
  const [rangeCount, setRangeCount] = useState<number | null>(null);
  // The setup-change link the driver tapped (sheetLinks.ts): the two runs whose boxes are on show.
  const [sheetTarget, setSheetTarget] = useState<SheetLinkTarget | null>(null);
  const openSheetLink = useCallback((_handle: string, target: SheetLinkTarget) => setSheetTarget(target), []);
  const closeSheetLink = useCallback(() => setSheetTarget(null), []);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // The transcript follows the newest words as they arrive. `stickToBottom` drops to false the
  // moment the driver scrolls up to re-read an earlier answer, and comes back the moment they
  // return to the foot of the thread (or send anything), so following never fights a deliberate
  // scroll back.
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const transcriptInnerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const consumedPromptIdRef = useRef<number | null>(null);

  const panelBusy = sending || loadingThread;
  const showNewChat = Boolean(threadId || messages.length > 0);

  const refreshThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/engineer/threads?limit=30");
      if (!res.ok) throw new Error("Could not load past conversations");
      const data = (await res.json()) as { threads?: ThreadSummary[] };
      if (Array.isArray(data.threads)) setThreads(data.threads);
      setThreadsErr(null);
    } catch (e) {
      // History is a convenience — it never blocks the chat, it just says so.
      setThreadsErr(e instanceof Error ? e.message : "Could not load past conversations");
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  // The runs the bar can name and pin. Loaded once: the Auto label needs the newest one, the
  // picker needs the list, and a pinned run needs its label.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/engineer/run-candidates");
        const data = (await res.json().catch(() => ({}))) as { error?: string; runs?: RunCandidateRow[] };
        if (!res.ok) throw new Error(data.error ?? `Failed to load runs (${res.status})`);
        if (cancelled) return;
        setCandidates(sortCandidates((data.runs ?? []).map(buildRunCandidate)));
        setCandidatesErr(null);
      } catch (e) {
        if (!cancelled) setCandidatesErr(e instanceof Error ? e.message : "Failed to load runs");
      } finally {
        if (!cancelled) setCandidatesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The meetings, tracks and cars the pickers offer, and how many runs the URL's filter holds
  // — one route. Fetched on load: the run picker lists meetings, and a meeting or track named
  // in a question is matched against this list before the question is sent (nameMatch.ts).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = rangeQuery != null ? `?count=1${rangeQuery ? `&${rangeQuery}` : ""}` : "";
        const res = await fetch(`/api/engineer/range-options${qs}`);
        const data = (await res.json().catch(() => ({}))) as Partial<EngineerRangeOptions> & {
          error?: string;
          count?: number | null;
        };
        if (!res.ok) throw new Error(data.error ?? `Failed to load tracks (${res.status})`);
        if (cancelled) return;
        setRangeOptions({
          events: data.events ?? [],
          tracks: data.tracks ?? [],
          cars: data.cars ?? [],
          first: data.first ?? null,
          last: data.last ?? null,
        });
        setRangeCount(typeof data.count === "number" ? data.count : null);
        setRangeOptionsErr(null);
      } catch (e) {
        if (!cancelled) setRangeOptionsErr(e instanceof Error ? e.message : "Failed to load tracks");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rangeQuery]);

  const hasMessages = messages.length > 0;

  useEffect(() => {
    const el = transcriptRef.current;
    const inner = transcriptInnerRef.current;
    if (!el || !inner) return;

    /*
     * Direction, not distance, is what tells a driver's scroll apart from ours. Measuring "am I
     * near the bottom?" on every scroll event looked right and wasn't: our own jump to the foot
     * lands, the next tokens make the thread taller before the event is handled, and the panel
     * concludes the driver has scrolled away from an answer it moved itself. Following stopped
     * one reply in. Our jumps only ever move down, so only an upward move gives up the follow.
     */
    let lastTop = el.scrollTop;
    const onScroll = () => {
      const top = el.scrollTop;
      const movedUp = top < lastTop;
      lastTop = top;
      if (movedUp) stickToBottom.current = false;
      else if (el.scrollHeight - top - el.clientHeight < 48) stickToBottom.current = true;
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    // Tokens land a few at a time and the markdown re-lays out after them, so the height of the
    // content — not the message count — is what tells us there is more thread to follow.
    const ro = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    el.scrollTop = el.scrollHeight;
    lastTop = el.scrollTop;

    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [hasMessages]);

  // The composer ships as `rows={1}` with a `max-h-28` cap, which was fine while every message
  // was typed a character at a time. A tapped starter question arrives ~90 characters at once
  // and the second line was clipped in half, so the box grows to fit what's in it — capped by
  // the same CSS max-height.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // ── The subject: written to the URL, read back from it ─────────────────────────────────────
  const writeSubject = useCallback(
    (next: Subject) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete("pin");
      sp.delete("runId");
      sp.delete("compareRunId");
      sp.delete("mode");
      for (const key of RANGE_URL_KEYS) sp.delete(key);
      if (next.general) sp.set("mode", "general");
      else if (next.range) writeRangeScopeToSearchParams(sp, next.range);
      else if (next.pinnedRunId) sp.set("pin", `run:${next.pinnedRunId}`);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );
  const pinRun = (c: RunCandidate) => {
    setPickerOpen(false);
    writeSubject({ ...AUTO, pinnedRunId: c.id });
  };
  const clearPin = () => writeSubject(AUTO);
  const enterGeneral = () => {
    setPickerOpen(false);
    setRangePickerOpen(false);
    writeSubject({ ...AUTO, general: true });
  };
  const leaveGeneral = () => writeSubject(AUTO);
  const openRangePicker = () => {
    setPickerOpen(false);
    setRangePickerOpen((v) => !v);
  };
  const applyRange = (scope: EngineerRangeScope) => {
    setRangePickerOpen(false);
    writeSubject({ ...AUTO, range: scope });
  };
  const clearRange = () => {
    setRangePickerOpen(false);
    writeSubject(AUTO);
  };

  const latestRun = candidates[0] ?? null;
  const autoLabel = latestRun?.chipLabel ?? null;
  // A pinned run outside the recent window (a deep link to an old run) still reads as pinned.
  const pinnedLabel = pinnedRunId
    ? candidates.find((c) => c.id === pinnedRunId)?.chipLabel ?? "Run"
    : null;
  const rangeLabel = rangeScope
    ? describeRangeScope(rangeScope, {
        events: rangeOptions?.events ?? [],
        tracks: rangeOptions?.tracks ?? [],
        cars: rangeOptions?.cars ?? [],
        count: rangeCount,
      })
    : null;

  /**
   * A meeting or track NAMED in the question becomes the filter for it (founder call
   * 2026-09-14: "if I say 'search sa state titles' can it not just look for that by itself").
   * Plain matching against the driver's own names, typos forgiven — never in General, which
   * is the driver saying "nothing from my logs". The bar switches to show what was attached.
   */
  const scopeNamedIn = useCallback(
    (question: string): EngineerRangeScope | null => {
      if (generalMode || !rangeOptions) return null;
      const hit = matchNamedScope(question, { events: rangeOptions.events, tracks: rangeOptions.tracks });
      if (!hit) return null;
      return hit.kind === "event" ? eventScope(hit.id) : trackScope(hit.id);
    },
    [generalMode, rangeOptions]
  );
  // ───────────────────────────────────────────────────────────────────────────────────────────

  const openThread = useCallback(async (id: string) => {
    setLoadingThread(true);
    setError(null);
    try {
      const res = await fetch(`/api/engineer/threads/${encodeURIComponent(id)}/messages`);
      if (!res.ok) throw new Error("Could not load that conversation");
      const data = (await res.json()) as {
        messages?: Array<{ id?: string; role?: string; content?: string; ratingContext?: RatingContext }>;
      };
      setThreadId(id);
      stickToBottom.current = true;
      setMessages(mapApiMessages(data.messages ?? []));
      // Opening a conversation on a phone is leaving the list: shut it so the chat is what's
      // on screen. Untouched at lg, where the list is always open.
      setHistoryOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that conversation");
    } finally {
      setLoadingThread(false);
    }
  }, []);

  const deleteThread = useCallback(
    async (id: string, title: string) => {
      const ok = window.confirm(`Delete "${title}"?\n\nThis removes the conversation permanently.`);
      if (!ok) return;
      setDeletingThreadId(id);
      setThreadsErr(null);
      try {
        const res = await fetch(`/api/engineer/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Could not delete that conversation");
        if (threadId === id) {
          setThreadId(null);
          setMessages([]);
        }
      } catch (e) {
        setThreadsErr(e instanceof Error ? e.message : "Could not delete that conversation");
      } finally {
        setDeletingThreadId(null);
        void refreshThreads();
      }
    },
    [refreshThreads, threadId]
  );

  const startNewChat = useCallback(() => {
    setThreadId(null);
    stickToBottom.current = true;
    setMessages([]);
    setError(null);
    setInput("");
    setHistoryOpen(null);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || sending) return;
      setError(null);
      setSending(true);
      setStatusPhase(null);
      stickToBottom.current = true;
      setInput("");
      setPickerOpen(false);
      setRangePickerOpen(false);

      // A meeting or track named in the question wins over whatever the bar showed, and the
      // bar follows so nothing is attached silently.
      const named = scopeNamedIn(question);
      const scopeToSend = named && !sameRangeScope(named, rangeScope) ? named : rangeScope;
      if (named && !sameRangeScope(named, rangeScope)) writeSubject({ ...AUTO, range: named });

      const history = [...messages, { role: "user" as const, content: question }];
      setMessages([...history, { role: "assistant", content: "" }]);

      const applyAssistant = (updater: (prev: ChatMessage) => ChatMessage) => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") next[next.length - 1] = updater(last);
          return next;
        });
      };

      try {
        const res = await fetch("/api/engineer/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((m) => ({ role: m.role, content: m.content })),
            threadId: threadId ?? undefined,
            stream: true,
            // The subject bar, on the wire: General attaches no run; a filter names the runs
            // to read (rangeScope.ts); a pin names the run; Auto sends nothing and the route
            // reads the latest run itself.
            ...(generalMode
              ? { mode: "general" }
              : scopeToSend
                ? { scope: scopeToSend }
                : pinnedRunId
                  ? { runId: pinnedRunId }
                  : {}),
          }),
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const { reply, nextQuestions, sheetLinks, feedback } = await readSseStream(res, {
          onStatus: (phase) => setStatusPhase(phase),
          onToken: (t) => applyAssistant((prev) => ({ ...prev, content: prev.content + t })),
          // Live while the answer is still arriving; the finished answer keeps the ones it used.
          onLinks: (links) => applyAssistant((prev) => ({ ...prev, sheetLinks: links })),
        });
        applyAssistant((prev) => ({
          ...prev,
          content: reply || prev.content,
          messageId: feedback?.assistantMessageId,
          ratingContext: feedback?.ratingContext,
          nextQuestions,
          sheetLinks: Object.keys(sheetLinks).length > 0 ? sheetLinks : prev.sheetLinks,
        }));
        if (feedback?.threadId) setThreadId(feedback.threadId);
        void refreshThreads();
      } catch (e) {
        // Drop the empty assistant bubble and put the question back in the composer.
        setMessages((prev) =>
          prev[prev.length - 1]?.role === "assistant" && !prev[prev.length - 1].content
            ? prev.slice(0, -1)
            : prev
        );
        setInput(question);
        setError(e instanceof Error ? e.message : "Engineer chat failed");
      } finally {
        setSending(false);
        setStatusPhase(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rangeScope is re-parsed each render; rangeQuery is its identity
    [generalMode, messages, pinnedRunId, rangeQuery, refreshThreads, scopeNamedIn, sending, threadId, writeSubject]
  );

  // A `?prompt=` handoff (dashboard cards) lands in the composer and sends itself once.
  useEffect(() => {
    if (!queuedPrompt || consumedPromptIdRef.current === queuedPrompt.id) return;
    consumedPromptIdRef.current = queuedPrompt.id;
    onQueuedPromptConsumed?.();
    void send(queuedPrompt.text);
  }, [onQueuedPromptConsumed, queuedPrompt, send]);

  // Starter questions only exist on an empty thread (engineerStarterQuestions.ts). The run
  // family needs a run in focus — Auto or pinned, never General.
  const startersVisible = messages.length === 0;
  const rangeInFocus = !generalMode && rangeScope != null && hasRuns;
  const runInFocus = !generalMode && !rangeInFocus && hasRuns;
  const starterQuestions = useMemo(
    () =>
      startersVisible
        ? selectEngineerStarterQuestions({ runInFocus, hasHistory: hasRuns, rangeInFocus })
        : [],
    [startersVisible, runInFocus, rangeInFocus, hasRuns]
  );

  const fillFromStarter = (question: EngineerStarterQuestion) => {
    // Fills, never sends: a mis-tap costs nothing, and it can't spend a request from the
    // monthly cap. The driver adds which corner, which round, then sends.
    const text = starterQuestionText(question, units);
    setInput(text);
    const el = composerRef.current;
    if (!el) return;
    el.focus();
    const end = text.length;
    el.setSelectionRange(end, end);
  };

  const historyShown = historyOpen ?? messages.length === 0;
  const canCollapseHistory = threads.length > HISTORY_COLLAPSED_COUNT;

  // Collapsed view shows the most recent few, but always keeps the active conversation visible
  // so its highlight isn't hidden behind "Show all".
  const visibleThreads =
    historyExpanded || !canCollapseHistory
      ? threads
      : (() => {
          const head = threads.slice(0, HISTORY_COLLAPSED_COUNT);
          if (threadId && !head.some((t) => t.id === threadId)) {
            const active = threads.find((t) => t.id === threadId);
            if (active) return [...head, active];
          }
          return head;
        })();

  return (
    /*
     * TWO CARDS (2026-08-18): the conversation is one card, past conversations are their own.
     * At lg history sits in a 19rem left column with its own border and stops at its own
     * content instead of stretching the chat's full height.
     *
     * Phone: chat card, then a history card that starts SHUT (a count row you tap), so the page
     * ends on the thing you came for. DOM order is chat → history; the lg grid puts history back
     * on the left.
     */
    <div className="flex flex-col gap-3 lg:grid lg:h-[min(76dvh,48rem)] lg:grid-cols-[19rem_1fr] lg:gap-3">
      <SurfaceCard
        variant="panel"
        overflowHidden={false}
        className="lg:col-start-2 lg:row-start-1 lg:min-h-0"
        /* Row 1 is `1fr` so that before the first question the empty track still absorbs the
           slack and the composer sits at the bottom — the way every chat app resolves an empty
           thread. `h-full` re-pins the height the outer grid owns. */
        contentClassName="p-0 flex flex-col lg:grid lg:h-full lg:min-h-0 lg:grid-rows-[1fr_auto]"
      >
        {messages.length > 0 ? (
          /* A hard 340px scroll-well is right on a phone and absurd on a 1440px monitor; at lg
             the grid row owns the height instead. */
          <div
            ref={transcriptRef}
            data-testid="engineer-transcript"
            className="max-h-[min(42vh,340px)] overflow-y-auto border-b border-border/80 px-3 py-2.5 lg:row-start-1 lg:max-h-none lg:min-h-0 lg:border-b-0 lg:px-5 lg:py-4"
          >
            {/* The inner box is what the ResizeObserver watches: a scroll container never reports
                its own content growing, so the following would stop the moment tokens arrived. */}
            <div ref={transcriptInnerRef} className="space-y-2">
              {messages.map((m, idx) => {
                const pending = m.role === "assistant" && !m.content && sending && idx === messages.length - 1;
                return (
                  <div
                    key={m.messageId ?? `${m.role}-${idx}`}
                    className={cn(
                      "text-sm leading-relaxed rounded-lg px-3 py-2 border",
                      m.role === "user"
                        ? "border-border/60 bg-muted/40 text-foreground mr-6"
                        : "border-border/70 bg-background/30 ml-6 text-foreground/95"
                    )}
                  >
                    <div className="text-[10px] ui-title text-muted-foreground mb-1">
                      {m.role === "user" ? "You" : "Engineer"}
                    </div>
                    {m.role === "assistant" && m.content ? (
                      <EngineerMarkdown sheetLinks={m.sheetLinks} onOpenSheetLink={openSheetLink}>
                        {/* A link still arriving shows its words, not its brackets (sheetLinks.ts). */}
                        {sending && idx === messages.length - 1 ? hideUnfinishedLink(m.content) : m.content}
                      </EngineerMarkdown>
                    ) : pending ? (
                      <EngineerThinkingIndicator statusPhase={statusPhase} />
                    ) : (
                      <div className="whitespace-pre-wrap break-words">
                        {m.content || (m.role === "assistant" ? "—" : "")}
                      </div>
                    )}
                    {/* Follow-up buttons ride the newest answer only (founder, 2026-09-24). */}
                    {m.role === "assistant" && m.content && idx === messages.length - 1 && !sending ? (
                      <EngineerNextQuestions
                        questions={m.nextQuestions ?? []}
                        offerOtherOptions={messages[idx - 1]?.content !== OTHER_OPTIONS_QUESTION}
                        disabled={panelBusy}
                        onAsk={(q) => void send(q)}
                      />
                    ) : null}
                    {ratingsEnabled && m.role === "assistant" && m.messageId ? (
                      <EngineerMessageRatingRow
                        messageId={m.messageId}
                        disabled={sending}
                        initialContext={m.ratingContext}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : loadingThread ? (
          <p className="px-3 py-2.5 text-sm text-muted-foreground lg:row-start-1 lg:px-5 lg:py-4">
            Loading conversation…
          </p>
        ) : null}

        {error ? (
          <div className="text-xs text-destructive px-3 pt-2 space-y-1">
            <div className="ui-title text-[11px]">Error</div>
            <pre className="whitespace-pre-wrap break-words font-sans text-[11px] leading-snug opacity-95">
              {error}
            </pre>
          </div>
        ) : null}

        {/*
         * Desktop-only empty state. On a phone the composer is the first thing in the card, so an
         * empty thread reads as "ready" without being told. At lg the transcript owns a
         * full-height grid row, and with no conversation loaded that row is a large blank panel —
         * so it says what belongs there. `hidden lg:flex` is what keeps this off the phone.
         */}
        {messages.length === 0 && !loadingThread ? (
          <div className="hidden lg:row-start-1 lg:flex lg:min-h-0 lg:flex-col lg:items-center lg:justify-center lg:gap-2 lg:px-8 lg:text-center">
            <p className="text-sm font-medium text-foreground">Ask the Engineer about your car.</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              It reads the runs, setups and conditions you&rsquo;ve logged. Start with one of these,
              or type your own.
            </p>
            {/* The board owns this row at lg; the rail below is `lg:hidden`, so the same list is
                never on screen twice. */}
            <EngineerStarterQuestions
              variant="board"
              questions={starterQuestions.slice(0, ENGINEER_STARTER_BOARD_COUNT)}
              disabled={panelBusy}
              onPick={fillFromStarter}
              className="mt-2"
            />
          </div>
        ) : null}

        <div className="p-3 space-y-2 lg:row-start-2 lg:border-t lg:border-border/80 lg:px-5 lg:py-4">
          {/* Reads as a sentence top to bottom: what I'm asking about → things worth asking →
              the box. */}
          <EngineerSubjectBar
            mode={generalMode ? "general" : rangeScope ? "range" : "data"}
            pinnedLabel={pinnedLabel}
            autoLabel={autoLabel}
            rangeLabel={rangeLabel}
            disabled={panelBusy}
            onOpenPicker={() => {
              setRangePickerOpen(false);
              setPickerOpen((v) => !v);
            }}
            onClearPin={clearPin}
            onSelectData={leaveGeneral}
            onOpenRangePicker={openRangePicker}
            onClearRange={clearRange}
            onSelectGeneral={enterGeneral}
          />

          {/* Phone only; the desktop board above owns lg, and wrapping three rows of chips at
              390px pushes the composer under the bottom dock. */}
          <EngineerStarterQuestions
            variant="rail"
            questions={starterQuestions}
            disabled={panelBusy}
            onPick={fillFromStarter}
            className="lg:hidden"
          />

          {rangePickerOpen ? (
            <EngineerRangePicker
              options={rangeOptions}
              loading={rangeOptions == null && rangeOptionsErr == null}
              error={rangeOptionsErr}
              scope={rangeScope}
              disabled={panelBusy}
              onApply={applyRange}
              onClose={() => setRangePickerOpen(false)}
            />
          ) : null}

          {pickerOpen && !generalMode && !rangeScope ? (
            <EngineerRunPicker
              candidates={candidates}
              events={rangeOptions?.events ?? []}
              loading={candidatesLoading}
              error={candidatesErr}
              pinnedRunId={pinnedRunId}
              disabled={panelBusy}
              onPick={pinRun}
              onPickEvent={(e) => {
                setPickerOpen(false);
                writeSubject({ ...AUTO, range: eventScope(e.id) });
              }}
              onClose={() => setPickerOpen(false)}
            />
          ) : null}

          {/* A div, not a form: the demo tour listens on this anchor and watches the Send button
              and Enter-without-Shift, so it stays correct if the composer is restyled. */}
          <div className="flex items-end gap-2" data-tour="engineer-composer">
            <textarea
              ref={composerRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              className="flex-1 min-h-9 max-h-28 resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              placeholder="Ask the Engineer…"
              disabled={panelBusy}
              aria-label="Message to engineer"
            />
            {showNewChat ? (
              <Button
                type="button"
                variant="outline"
                onClick={startNewChat}
                disabled={panelBusy}
                aria-label="New chat"
                className="shrink-0 min-h-9 gap-1.5 px-2.5"
              >
                <MessageSquarePlus className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                <span className="hidden min-[400px]:inline">New chat</span>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="primary"
              onClick={() => void send(input)}
              disabled={panelBusy || !input.trim()}
              aria-label="Send"
              className="shrink-0 min-h-9 min-w-9 p-0"
            >
              <ArrowUp className="size-4" strokeWidth={2.5} aria-hidden />
            </Button>
          </div>
        </div>
      </SurfaceCard>

      <EngineerSheetChanges
        target={sheetTarget}
        onClose={closeSheetLink}
        onTell={(message) => void send(message)}
        disabled={panelBusy}
      />

      {/* The history card. At lg it is the left column and always open; on a phone it is a
          closed row you tap, so the chat card is the last thing before the dock. `self-start`
          keeps it at its own height instead of stretching to the chat's 76dvh. */}
      <SurfaceCard
        variant="panel"
        overflowHidden={false}
        className="lg:col-start-1 lg:row-start-1 lg:max-h-full lg:self-start lg:overflow-y-auto"
        contentClassName="p-0 px-3 py-3 md:px-4 lg:px-4"
      >
        <button
          type="button"
          onClick={() => setHistoryOpen(!historyShown)}
          aria-expanded={historyShown}
          aria-controls="engineer-history-list"
          /* Inert at lg — the list is always on screen there, so the row is just a heading. */
          className="tap-active -mx-1 flex w-full items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left lg:pointer-events-none"
        >
          <Eyebrow>{threads.length > 0 ? `History · ${threads.length}` : "History"}</Eyebrow>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform lg:hidden",
              historyShown && "rotate-180"
            )}
            strokeWidth={2}
            aria-hidden
          />
        </button>

        <div id="engineer-history-list" className={cn("mt-2", historyShown ? "block" : "hidden lg:block")}>
          {threadsLoading ? (
            <p className="text-[11px] text-muted-foreground">Loading conversations…</p>
          ) : threadsErr ? (
            <p className="text-[11px] text-destructive">{threadsErr}</p>
          ) : threads.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No past conversations yet.</p>
          ) : (
            <>
              <ul className="space-y-1">
                {visibleThreads.map((t, threadIndex) => {
                  const active = t.id === threadId;
                  // The top few read as previews; the tail stays a one-line list. Indexed off the
                  // rendered order, so "Show all" never turns a preview into a plain row.
                  const showPreview = threadIndex < HISTORY_PREVIEW_COUNT && Boolean(t.answerPreview);
                  const rowBusy = panelBusy || deletingThreadId === t.id;
                  return (
                    <li key={t.id}>
                      <div
                        className={cn(
                          "group flex items-stretch gap-1 rounded-lg border transition",
                          active
                            ? "border-border bg-muted/50"
                            : "border-transparent hover:border-border/70 hover:bg-muted/30"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => void openThread(t.id)}
                          disabled={rowBusy}
                          className={cn(
                            "tap-active min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left",
                            rowBusy && "opacity-60"
                          )}
                        >
                          <div
                            className={cn(
                              "text-sm text-foreground",
                              /* The question wraps to two lines on a preview row — it IS the
                                 headline there — and stays clipped to one in the compact list. */
                              showPreview ? "line-clamp-2 font-medium leading-snug" : "truncate"
                            )}
                          >
                            {t.title}
                          </div>
                          {showPreview ? (
                            <p className="mt-1 line-clamp-2 text-[12px] leading-[1.45] text-muted-foreground">
                              <span aria-hidden className="mr-1 text-primary">✦</span>
                              {t.answerPreview}
                            </p>
                          ) : null}
                          <div className="mt-0.5">
                            <RelativeTime iso={t.updatedAt} fallback="…" display="relative" />
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteThread(t.id, t.title)}
                          disabled={rowBusy}
                          aria-label={`Delete ${t.title}`}
                          className={cn(
                            /* Full-height target, label at the TOP: on a preview row the button is
                               three lines tall, and a centred "Delete" floated alongside the
                               answer as if it belonged to it. */
                            "tap-active flex shrink-0 items-start rounded-lg px-2.5 pt-2.5 text-[11px] text-muted-foreground transition hover:text-destructive hover:bg-destructive/10",
                            rowBusy && "opacity-60 pointer-events-none"
                          )}
                        >
                          {deletingThreadId === t.id ? "…" : "Delete"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {canCollapseHistory ? (
                <button
                  type="button"
                  onClick={() => setHistoryExpanded((v) => !v)}
                  className="tap-active mt-2 w-full rounded-lg border border-transparent px-3 py-1.5 text-left text-[11px] font-medium text-muted-foreground transition hover:border-border/70 hover:bg-muted/30 hover:text-foreground"
                >
                  {historyExpanded ? "Show fewer" : `Show all ${threads.length} conversations`}
                </button>
              ) : null}
            </>
          )}
        </div>
      </SurfaceCard>
    </div>
  );
}
