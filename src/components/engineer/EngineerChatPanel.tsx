"use client";



import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArrowUp, ChevronDown, MessageSquarePlus } from "lucide-react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

import { parseChoiceChipsFromReply } from "@/lib/engineerPhase5/engineerChoiceChips";

import {
  formatAnchorParam,
  formatGeneralAnchorParam,
  parseAnchorParam,
  parseThreadFocusAnchor,
  type EngineerAnchorKind,
  type EngineerChatAnchor,
} from "@/lib/engineerPhase5/engineerAnchor";

import {
  readStoredGeneralCarId,
  writeStoredGeneralCarId,
} from "@/lib/engineerGeneralCarStorage";

import {
  buildEventAnchorCandidate,
  buildRunAnchorCandidate,
  buildSetupAnchorCandidate,
  mergeAndSortCandidates,
  type AnchorCandidate,
} from "@/lib/engineerPhase5/anchorCandidates";

import {
  ENGINEER_STARTER_BOARD_COUNT,
  selectEngineerStarterQuestions,
  type EngineerStarterQuestion,
} from "@/lib/engineerStarterQuestions";

import { EngineerAnchorPicker } from "@/components/engineer/EngineerAnchorPicker";

import { EngineerStarterQuestions } from "@/components/engineer/EngineerStarterQuestions";

import { EngineerSubjectBar } from "@/components/engineer/EngineerSubjectBar";

import { EngineerMessageRatingRow } from "@/components/engineer/EngineerMessageRatingRow";

import { EngineerThinkingIndicator } from "@/components/engineer/EngineerThinkingIndicator";

import { Button } from "@/components/ui/Button";

import { EngineerMarkdown } from "@/components/ui/EngineerMarkdown";

import { Eyebrow } from "@/components/ui/panel";

import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { useSession } from "next-auth/react";
import {
  DemoEngineerEmptyState,
  DemoEngineerReadingNote,
} from "@/components/demo/DemoEngineerReadingNote";


import { RelativeTime } from "@/components/ui/RelativeTime";



type ChatMessage = {

  role: "user" | "assistant";

  content: string;

  messageId?: string;

  ratingContext?: {

    question?: string;

    answer?: string;

    runId?: string | null;

    compareRunId?: string | null;

    kbSections?: string[];

  };

};



type ThreadSummary = {

  id: string;

  title: string;

  preview: string | null;

  /** A plain-text taste of the ENGINEER’s last answer. Only the first few threads carry one. */

  answerPreview?: string | null;

  updatedAt: string;

};



type EngineerChatFeedback = {

  threadId: string;

  assistantMessageId: string;

  ratingContext: ChatMessage["ratingContext"];

};



export type EngineerQueuedChatPrompt = { id: number; text: string };



// History starts collapsed to the most recent few conversations; the rest live
// behind a "Show all" toggle so the panel doesn't scroll into a wall of threads.
const HISTORY_COLLAPSED_COUNT = 4;

// How many of those rows show a line of the answer under the title (founder call 2026-08-20).
// A list of titles is a filing cabinet; three previews make it a page you can read. The rest
// stay one-liners — previewing everything is the wall of text the collapse exists to avoid.
// Kept in step with PREVIEW_THREAD_COUNT in /api/engineer/threads, which only fetches this many.
const HISTORY_PREVIEW_COUNT = 3;



async function readSseStream(

  res: Response,

  handlers: {

    onToken?: (text: string) => void;

    onStatus?: (phase: string) => void;

  }

): Promise<{

  reply: string;

  resolvedFocus: { runId: string; compareRunId: string | null } | null;

  anchorLabel: string | null;

  feedback: EngineerChatFeedback | null;

}> {

  const reader = res.body?.getReader();

  if (!reader) throw new Error("Stream had no body");

  const decoder = new TextDecoder();

  let buffer = "";

  let reply = "";

  let resolvedFocus: { runId: string; compareRunId: string | null } | null = null;

  let anchorLabel: string | null = null;

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

      if (event === "status" && typeof data.phase === "string") {

        handlers.onStatus?.(data.phase);

      } else if (event === "token" && typeof data.t === "string") {

        reply += data.t;

        handlers.onToken?.(data.t);

      } else if (event === "done") {

        if (typeof data.reply === "string" && data.reply.trim()) reply = data.reply;

        resolvedFocus =

          data.resolvedFocus && typeof data.resolvedFocus === "object"

            ? (data.resolvedFocus as { runId: string; compareRunId: string | null })

            : null;

        const anchorEcho = data.anchor as { label?: unknown } | null | undefined;

        anchorLabel = typeof anchorEcho?.label === "string" ? anchorEcho.label : null;

        if (data.feedback && typeof data.feedback === "object") {

          const fb = data.feedback as Record<string, unknown>;

          if (typeof fb.threadId === "string" && typeof fb.assistantMessageId === "string") {

            feedback = {

              threadId: fb.threadId,

              assistantMessageId: fb.assistantMessageId,

              ratingContext:

                fb.ratingContext && typeof fb.ratingContext === "object"

                  ? (fb.ratingContext as ChatMessage["ratingContext"])

                  : undefined,

            };

          }

        }

      } else if (event === "error") {

        throw new Error(typeof data.message === "string" ? data.message : "Engineer chat failed");

      }

    }

  }



  return { reply, resolvedFocus, anchorLabel, feedback };

}



function mapApiMessages(
  raw: Array<{
    id?: string;
    role?: string;
    content?: string;
    ratingContext?: ChatMessage["ratingContext"];
  }>
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
      });
    } else {
      out.push({ role, content });
    }
  }
  return out;
}



export function EngineerChatPanel({

  queuedPrompt = null,

  onQueuedPromptConsumed,

  ratingsEnabled = false,

}: {

  queuedPrompt?: EngineerQueuedChatPrompt | null;

  onQueuedPromptConsumed?: () => void;

  ratingsEnabled?: boolean;

} = {}) {

  /*
   * A demo session reads answered conversations and asks nothing (founder call 2026-08-25).
   * Read here rather than passed as a prop: this panel is reached from the Engineer page AND
   * lazily from elsewhere, and threading a flag through every caller to say something the
   * session already knows is how one of those callers ends up forgetting.
   */
  const isDemoSession = useSession().data?.user?.isDemo === true;

  const router = useRouter();

  const pathname = usePathname();

  const searchParams = useSearchParams();

  const runIdFromUrl = searchParams.get("runId")?.trim() || null;

  const compareRunIdFromUrl = searchParams.get("compareRunId")?.trim() || null;

  const threadIdFromUrl = searchParams.get("threadId")?.trim() || null;

  // Pinned channel (`?pin=run:<id>` + optional `?pin2=run:<id>` compare). The legacy
  // runId/compareRunId params stay the Auto channel so every existing deep link keeps
  // working; a pin wins over them server-side.
  const pinFromUrl = parseAnchorParam(searchParams.get("pin"));

  const pin2FromUrl = parseAnchorParam(searchParams.get("pin2"));

  // Run + saved setup combo ("would this sheet have helped here?") rides on a run pin.
  const pinSetupFromUrl = parseAnchorParam(searchParams.get("pinSetup"));

  const pinnedAnchor: EngineerChatAnchor | null = !pinFromUrl
    ? null
    : pinFromUrl.kind === "general"
      ? { kind: "general", carId: pinFromUrl.carId, pinned: true }
      : {
          kind: pinFromUrl.kind,
          id: pinFromUrl.id,
          compareRunId:
            pinFromUrl.kind === "run" && pin2FromUrl?.kind === "run" && pin2FromUrl.id !== pinFromUrl.id
              ? pin2FromUrl.id
              : null,
          setupId:
            pinFromUrl.kind === "run" && pinSetupFromUrl?.kind === "setup" ? pinSetupFromUrl.id : null,
          pinned: true,
        };

  // General mode (founder interview 2026-07-30): theory-only subject — the data anchor
  // states below don't apply, and the bar's General segment is lit instead.
  const generalMode = pinnedAnchor?.kind === "general";
  const generalCarId = pinnedAnchor?.kind === "general" ? pinnedAnchor.carId : null;
  const dataAnchor = pinnedAnchor && pinnedAnchor.kind !== "general" ? pinnedAnchor : null;



  const [chatBusy, setChatBusy] = useState(false);

  const [statusPhase, setStatusPhase] = useState<string | null>(null);

  const [chatErr, setChatErr] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [input, setInput] = useState("");

  const [threadId, setThreadId] = useState<string | null>(null);

  const [threads, setThreads] = useState<ThreadSummary[]>([]);

  const [threadsLoading, setThreadsLoading] = useState(true);

  const [threadsErr, setThreadsErr] = useState<string | null>(null);

  const [loadingThread, setLoadingThread] = useState(false);

  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);

  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Phone-only disclosure for the whole history card (lg keeps the rail open).
  // `null` = untouched, in which case it follows the thread: open while there is no
  // conversation on screen (otherwise the phone page is two short cards and a lot of
  // nothing), shut once there is one.
  const [historyOpen, setHistoryOpen] = useState<boolean | null>(null);

  const [candidates, setCandidates] = useState<AnchorCandidate[]>([]);

  const [candidatesLoading, setCandidatesLoading] = useState(true);

  const [candidatesErr, setCandidatesErr] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);

  // The General segment's car quick-ask — deterministic chips, no model round-trip.
  const [cars, setCars] = useState<Array<{ id: string; name: string }>>([]);

  // Chip label for a pinned entity that isn't in the recent-candidates window —
  // restored threads carry a frozen label, and the server echoes one per reply.
  const [pinLabelFallback, setPinLabelFallback] = useState<string | null>(null);

  // Mode system fully retired 2026-07-29 (one mode): the Engineer answers the same way
  // in every situation, so the old `?mode=quick` URL hint is no longer sent.

  const messagesRef = useRef<ChatMessage[]>([]);

  const lastQueuedId = useRef<number | null>(null);

  const onQueuedConsumedRef = useRef(onQueuedPromptConsumed);

  const initialUrlThreadLoaded = useRef<string | null>(null);

  // A tapped starter question lands here and leaves the caret at the end, so the
  // driver can keep typing the detail that makes the answer good.
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {

    onQueuedConsumedRef.current = onQueuedPromptConsumed;

  }, [onQueuedPromptConsumed]);



  useEffect(() => {

    messagesRef.current = messages;

  }, [messages]);



  const syncThreadToUrl = useCallback(

    (id: string | null) => {

      const sp = new URLSearchParams(searchParams.toString());

      if (id) sp.set("threadId", id);

      else sp.delete("threadId");

      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });

    },

    [pathname, router, searchParams]

  );



  function applyResolvedFocus(resolved: { runId: string; compareRunId: string | null } | null) {

    if (!resolved?.runId) return;

    // A user pin owns the chip — the model's evidence-gathering must not flip it.
    if (searchParams.get("pin")) return;

    const sp = new URLSearchParams(searchParams.toString());

    sp.set("runId", resolved.runId);

    if (resolved.compareRunId) sp.set("compareRunId", resolved.compareRunId);

    else sp.delete("compareRunId");

    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });

  }

  const refreshCandidates = useCallback(async () => {
    try {
      const res = await fetch("/api/engineer/anchor-candidates");
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        runs?: Array<Parameters<typeof buildRunAnchorCandidate>[0]>;
        setups?: Array<Parameters<typeof buildSetupAnchorCandidate>[0]>;
        events?: Array<Parameters<typeof buildEventAnchorCandidate>[0]>;
      };
      if (!res.ok) throw new Error(data.error ?? `Failed to load runs (${res.status})`);
      setCandidates(
        mergeAndSortCandidates([
          (Array.isArray(data.runs) ? data.runs : []).map(buildRunAnchorCandidate),
          (Array.isArray(data.setups) ? data.setups : []).map(buildSetupAnchorCandidate),
          (Array.isArray(data.events) ? data.events : []).map(buildEventAnchorCandidate),
        ])
      );
      setCandidatesErr(null);
    } catch (e) {
      setCandidatesErr(e instanceof Error ? e.message : "Could not load recent runs");
    } finally {
      setCandidatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCandidates();
  }, [refreshCandidates]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/cars");
        const data = (await res.json().catch(() => ({}))) as {
          cars?: Array<{ id?: string; name?: string }>;
        };
        if (!res.ok || cancelled) return;
        setCars(
          (Array.isArray(data.cars) ? data.cars : []).flatMap((c) =>
            typeof c.id === "string" && typeof c.name === "string" ? [{ id: c.id, name: c.name }] : []
          )
        );
      } catch {
        // Car chips just won't render — General still works as pure theory.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Coming back from logging a run should surface the "new run logged — switch?"
  // affordance without needing to send a message first.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshCandidates();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshCandidates]);

  const candidateById = useCallback(
    (kind: EngineerAnchorKind, id: string | null) =>
      id ? candidates.find((c) => c.kind === kind && c.id === id) ?? null : null,
    [candidates]
  );

  /** One URL write for the whole pin state; pinning supersedes the Auto params. */
  const writePinParams = useCallback(
    (
      primary: { kind: EngineerAnchorKind; id: string } | null,
      compareRunId: string | null,
      setupId: string | null = null
    ) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (primary) {
        sp.set("pin", formatAnchorParam(primary.kind, primary.id));
        sp.delete("runId");
        sp.delete("compareRunId");
      } else {
        sp.delete("pin");
      }
      if (primary && compareRunId) sp.set("pin2", formatAnchorParam("run", compareRunId));
      else sp.delete("pin2");
      if (primary?.kind === "run" && setupId) sp.set("pinSetup", formatAnchorParam("setup", setupId));
      else sp.delete("pinSetup");
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  /** One URL write into (or within) General mode — theory subject, optional car scope. */
  const writeGeneralPin = useCallback(
    (carId: string | null) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("pin", formatGeneralAnchorParam(carId));
      sp.delete("pin2");
      sp.delete("pinSetup");
      sp.delete("runId");
      sp.delete("compareRunId");
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );



  const refreshThreads = useCallback(async () => {

    setThreadsErr(null);

    try {

      const res = await fetch("/api/engineer/threads?limit=30");

      const data = (await res.json().catch(() => ({}))) as {

        error?: string;

        threads?: ThreadSummary[];

      };

      if (!res.ok) throw new Error(data.error ?? `Failed to load history (${res.status})`);

      setThreads(Array.isArray(data.threads) ? data.threads : []);

    } catch (e) {

      setThreadsErr(e instanceof Error ? e.message : "Could not load chat history");

    } finally {

      setThreadsLoading(false);

    }

  }, []);



  const loadThread = useCallback(

    async (id: string) => {

      initialUrlThreadLoaded.current = id;

      // Picking a chat on a phone shuts the history card behind it — otherwise you pick a
      // conversation and stay looking at the list you picked it from.
      setHistoryOpen(false);

      setLoadingThread(true);

      setChatErr(null);

      try {

        const res = await fetch(`/api/engineer/threads/${encodeURIComponent(id)}/messages`);

        const data = (await res.json().catch(() => ({}))) as {

          error?: string;

          thread?: {

            primaryRunId?: string | null;

            compareRunId?: string | null;

            focusAnchor?: unknown;

          };

          messages?: Array<{

            id?: string;

            role?: string;

            content?: string;

            ratingContext?: ChatMessage["ratingContext"];

          }>;

        };

        if (!res.ok) throw new Error(data.error ?? `Failed to load conversation (${res.status})`);

        const mapped = mapApiMessages(Array.isArray(data.messages) ? data.messages : []);

        setThreadId(id);

        // Restore the thread's standing focus with the threadId in ONE url write —
        // a pinned anchor comes back pinned; a plain run focus comes back as Auto.
        {
          const sp = new URLSearchParams(searchParams.toString());
          sp.set("threadId", id);
          const restored = parseThreadFocusAnchor(data.thread?.focusAnchor);
          if (restored?.kind === "general") {
            // A general thread comes back in general mode with its own car scope —
            // the thread's anchor beats the remembered default.
            sp.set("pin", formatGeneralAnchorParam(restored.carId));
            sp.delete("pin2");
            sp.delete("pinSetup");
            sp.delete("runId");
            sp.delete("compareRunId");
            setPinLabelFallback(restored.label);
          } else if (restored?.pinned) {
            sp.set("pin", formatAnchorParam(restored.kind, restored.id));
            if (restored.kind === "run" && restored.compareRunId) {
              sp.set("pin2", formatAnchorParam("run", restored.compareRunId));
            } else {
              sp.delete("pin2");
            }
            if (restored.kind === "run" && restored.setupId) {
              sp.set("pinSetup", formatAnchorParam("setup", restored.setupId));
            } else {
              sp.delete("pinSetup");
            }
            sp.delete("runId");
            sp.delete("compareRunId");
            setPinLabelFallback(restored.label);
          } else {
            sp.delete("pinSetup");
            sp.delete("pin");
            sp.delete("pin2");
            const primaryRunId = data.thread?.primaryRunId ?? restored?.id ?? null;
            if (primaryRunId) sp.set("runId", primaryRunId);
            else sp.delete("runId");
            const compareRunId = data.thread?.compareRunId ?? null;
            if (compareRunId) sp.set("compareRunId", compareRunId);
            else sp.delete("compareRunId");
          }
          router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
        }

        setMessages(mapped);

        messagesRef.current = mapped;

      } catch (e) {

        setChatErr(e instanceof Error ? e.message : "Could not load conversation");

      } finally {

        setLoadingThread(false);

      }

    },

    [pathname, router, searchParams]

  );



  const startNewChat = useCallback(() => {

    initialUrlThreadLoaded.current = null;

    setThreadId(null);

    setMessages([]);

    messagesRef.current = [];

    setChatErr(null);

    setInput("");

    setPinLabelFallback(null);

    setPickerOpen(false);

    // Fresh conversation starts on Auto: latest run — drop the old focus entirely.
    {
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete("threadId");
      sp.delete("pin");
      sp.delete("pin2");
      sp.delete("pinSetup");
      sp.delete("runId");
      sp.delete("compareRunId");
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    }

  }, [pathname, router, searchParams]);



  useEffect(() => {

    void refreshThreads();

  }, [refreshThreads]);



  useEffect(() => {

    if (!threadIdFromUrl) {

      initialUrlThreadLoaded.current = null;

      return;

    }

    if (initialUrlThreadLoaded.current === threadIdFromUrl) return;

    initialUrlThreadLoaded.current = threadIdFromUrl;

    void loadThread(threadIdFromUrl);

  }, [threadIdFromUrl, loadThread]);



  async function submitConversation(apiMessages: ChatMessage[]) {

    setChatBusy(true);

    setStatusPhase("preparing");

    setChatErr(null);

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {

      const res = await fetch("/api/engineer/chat", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({

          messages: apiMessages,

          stream: true,

          ...(threadId ? { threadId } : {}),

          ...(pinnedAnchor ? { anchor: pinnedAnchor } : {}),

          ...(runIdFromUrl ? { runId: runIdFromUrl } : {}),

          ...(compareRunIdFromUrl ? { compareRunId: compareRunIdFromUrl } : {}),

          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,

        }),

      });



      if (res.headers.get("content-type")?.includes("text/event-stream") && res.ok && res.body) {

        let pendingTokens = "";

        // Once the answer starts, the status line is done for this turn. A completion can
        // stream a preamble and *then* call a tool, which restarts the status events — without
        // this the spinner would pop back in underneath prose that's already on screen.
        let sawToken = false;

        let flushRaf: number | null = null;

        const flushTokens = () => {

          flushRaf = null;

          if (!pendingTokens) return;

          const chunk = pendingTokens;

          pendingTokens = "";

          setStatusPhase(null);

          setMessages((prev) => {

            const copy = [...prev];

            const last = copy[copy.length - 1];

            if (last?.role === "assistant") {

              copy[copy.length - 1] = { ...last, content: last.content + chunk };

            }

            messagesRef.current = copy;

            return copy;

          });

        };

        const { reply, resolvedFocus, anchorLabel, feedback } = await readSseStream(res, {

          onStatus: (phase) => {

            if (!sawToken) setStatusPhase(phase);

          },

          onToken: (token) => {

            // Set here, not in the rAF flush, so a status frame arriving in the same task
            // can't slip in ahead of the first token.
            sawToken = true;

            pendingTokens += token;

            if (flushRaf == null) {

              flushRaf = requestAnimationFrame(flushTokens);

            }

          },

        });

        if (flushRaf != null) cancelAnimationFrame(flushRaf);

        if (pendingTokens) {

          const chunk = pendingTokens;

          pendingTokens = "";

          setStatusPhase(null);

          setMessages((prev) => {

            const copy = [...prev];

            const last = copy[copy.length - 1];

            if (last?.role === "assistant") {

              copy[copy.length - 1] = { ...last, content: last.content + chunk };

            }

            messagesRef.current = copy;

            return copy;

          });

        }

        applyResolvedFocus(resolvedFocus);

        if (anchorLabel) setPinLabelFallback(anchorLabel);

        if (feedback?.threadId) {

          setThreadId(feedback.threadId);

          syncThreadToUrl(feedback.threadId);

        }

        setMessages((prev) => {

          const copy = [...prev];

          const last = copy[copy.length - 1];

          if (last?.role === "assistant") {

            copy[copy.length - 1] = {

              role: "assistant",

              content: reply || last.content || "—",

              messageId: feedback?.assistantMessageId,

              ratingContext: feedback?.ratingContext,

            };

          }

          messagesRef.current = copy;

          return copy;

        });

        void refreshThreads();

        return;

      }



      const data = (await res.json().catch(() => ({}))) as {

        error?: string;

        debug?: string;

        reply?: string;

        resolvedFocus?: { runId: string; compareRunId: string | null } | null;

        anchor?: { label?: string | null } | null;

        feedback?: EngineerChatFeedback | null;

      };

      if (!res.ok) {

        setMessages((prev) => prev.slice(0, -1));

        const base =

          data.error?.trim() ||

          (res.status === 502 || res.status === 503

            ? `Server unavailable (${res.status})`

            : `Request failed (HTTP ${res.status})`);

        const extra = data.debug?.trim()

          ? `\n\n--- Debug (dev / DEBUG_ENGINEER_CHAT) ---\n${data.debug.slice(0, 6000)}`

          : "";

        setChatErr(base + extra);

        return;

      }

      applyResolvedFocus(data.resolvedFocus ?? null);

      if (typeof data.anchor?.label === "string") setPinLabelFallback(data.anchor.label);

      if (data.feedback?.threadId) {

        setThreadId(data.feedback.threadId);

        syncThreadToUrl(data.feedback.threadId);

      }

      const reply = data.reply ?? "";

      setMessages((prev) => {

        const withoutEmpty = prev.slice(0, -1);

        const withAssistant = [

          ...withoutEmpty,

          {

            role: "assistant" as const,

            content: reply || "—",

            messageId: data.feedback?.assistantMessageId,

            ratingContext: data.feedback?.ratingContext,

          },

        ];

        messagesRef.current = withAssistant;

        return withAssistant;

      });

      void refreshThreads();

    } catch (e) {

      setMessages((prev) => (prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev));

      const msg = e instanceof Error ? e.message : "Network error — check connection and try again.";

      setChatErr(`Could not reach server: ${msg}`);

    } finally {

      setChatBusy(false);

      setStatusPhase(null);

    }

  }



  useEffect(() => {

    if (!queuedPrompt) return;

    if (lastQueuedId.current === queuedPrompt.id) return;

    lastQueuedId.current = queuedPrompt.id;

    const text = queuedPrompt.text.trim();

    onQueuedConsumedRef.current?.();

    if (!text) return;



    const displayNext = [...messagesRef.current, { role: "user" as const, content: text }];

    messagesRef.current = displayNext;

    setMessages(displayNext);

    void submitConversation(displayNext.slice(-8));

  }, [queuedPrompt?.id, queuedPrompt?.text]);



  async function sendText(text: string) {

    if (!text || chatBusy || loadingThread) return;

    const displayNext: ChatMessage[] = [...messagesRef.current, { role: "user", content: text }];

    messagesRef.current = displayNext;

    setMessages(displayNext);

    await submitConversation(displayNext.slice(-8));

  }



  async function sendMessage() {

    const text = input.trim();

    if (!text) return;

    setInput("");

    await sendText(text);

  }



  async function deleteThread(id: string, title: string) {

    const ok = window.confirm(`Delete "${title}"?\n\nThis removes the conversation permanently.`);

    if (!ok) return;

    setDeletingThreadId(id);

    setThreadsErr(null);

    try {

      const res = await fetch(`/api/engineer/threads/${encodeURIComponent(id)}`, { method: "DELETE" });

      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) throw new Error(data.error ?? `Delete failed (${res.status})`);

      setThreads((prev) => prev.filter((t) => t.id !== id));

      if (threadId === id) startNewChat();

    } catch (e) {

      setThreadsErr(e instanceof Error ? e.message : "Could not delete conversation");

    } finally {

      setDeletingThreadId(null);

    }

  }



  const panelBusy = chatBusy || loadingThread;

  const showNewChat = Boolean(threadId || messages.length > 0);

  // ── Subject bar state ────────────────────────────────────────────────────────
  const latestRunCandidate = candidates.find((c) => c.kind === "run") ?? null;
  const pinnedPrimaryCandidate = dataAnchor
    ? candidateById(dataAnchor.kind, dataAnchor.id)
    : null;
  const pinnedCompareCandidate = dataAnchor?.compareRunId
    ? candidateById("run", dataAnchor.compareRunId)
    : null;
  const pinnedSetupCandidate = dataAnchor?.setupId
    ? candidateById("setup", dataAnchor.setupId)
    : null;
  const pinnedChip = dataAnchor
    ? {
        label: [
          pinnedPrimaryCandidate?.chipLabel ??
            pinLabelFallback ??
            ({ run: "Run", setup: "Saved setup", event: "Event" } as const)[dataAnchor.kind],
          dataAnchor.setupId ? `+ ${pinnedSetupCandidate?.chipLabel ?? "saved setup"}` : null,
        ]
          .filter(Boolean)
          .join(" "),
        compareLabel: dataAnchor.compareRunId
          ? pinnedCompareCandidate?.chipLabel ?? "earlier run"
          : null,
        // Setup/event pins arrive via deep links — badge the kind so the data segment
        // says what it is holding without a separate segment for each.
        kindBadge:
          dataAnchor.kind === "setup" ? "Setup" : dataAnchor.kind === "event" ? "Event" : null,
      }
    : null;
  const autoFocusCandidate = runIdFromUrl ? candidateById("run", runIdFromUrl) : latestRunCandidate;
  // Also shown (muted) inside the unlit data segment while General is lit, as the
  // "what tapping back returns to" hint — so it is computed regardless of pin state.
  const autoLabel = autoFocusCandidate?.chipLabel ?? (runIdFromUrl ? "Run in focus" : null);
  const generalCarName = generalMode
    ? cars.find((c) => c.id === generalCarId)?.name ??
      (pinLabelFallback?.startsWith("General · ") ? pinLabelFallback.slice("General · ".length) : null)
    : null;
  // Auto never jumps to a newly logged run mid-thread — it holds and offers.
  const switchOffer =
    !pinnedAnchor &&
    runIdFromUrl &&
    latestRunCandidate &&
    latestRunCandidate.id !== runIdFromUrl &&
    (!autoFocusCandidate || latestRunCandidate.sortIso > autoFocusCandidate.sortIso)
      ? { label: latestRunCandidate.chipLabel }
      : null;

  // ── Starter questions ────────────────────────────────────────────────────────
  // Written prompts so an empty box isn't the first thing a driver meets. They
  // exist only on an empty thread: once the Engineer has answered it emits its
  // own follow-up chips, and two chip systems on one screen is a mess.
  //
  // The subject decides which show. A run has to genuinely be the subject for the
  // "read this run" family — General mode and a setup/event pin both mean there
  // is no run to read, and offering the question anyway is a dead end.
  const runInFocus =
    !generalMode && (dataAnchor?.kind === "run" || (!dataAnchor && autoFocusCandidate != null));
  // Held back until the candidate list lands, so the chips don't reshuffle under
  // a thumb when the run family becomes eligible a moment later.
  const startersVisible = messages.length === 0 && !candidatesLoading;
  const starterQuestions = useMemo(
    () =>
      startersVisible
        ? selectEngineerStarterQuestions({ runInFocus, hasHistory: latestRunCandidate != null })
        : [],
    [startersVisible, runInFocus, latestRunCandidate],
  );

  // The composer ships as `rows={1}` with a `max-h-28` cap, which was fine while
  // every message was typed a character at a time. A tapped starter question
  // arrives ~90 characters at once and the second line was clipped in half, so
  // the box grows to fit what's in it — capped by the same CSS max-height.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const fillFromStarter = (question: EngineerStarterQuestion) => {
    // Fills, never sends: a mis-tap costs nothing, and it can't spend a request
    // from the monthly cap. The driver adds which corner, which round, then sends.
    setInput(question.text);
    const el = composerRef.current;
    if (!el) return;
    el.focus();
    const end = question.text.length;
    el.setSelectionRange(end, end);
  };

  const enterGeneral = () => {
    setPinLabelFallback(null);
    setPickerOpen(false);
    writeGeneralPin(readStoredGeneralCarId());
  };
  const pickGeneralCar = (carId: string | null) => {
    writeStoredGeneralCarId(carId);
    setPinLabelFallback(null);
    writeGeneralPin(carId);
  };
  const leaveGeneral = () => {
    setPinLabelFallback(null);
    writePinParams(null, null);
  };
  const pickPrimary = (c: AnchorCandidate) => {
    setPinLabelFallback(c.chipLabel);
    writePinParams({ kind: c.kind, id: c.id }, null);
    setPickerOpen(false);
  };
  const pickCompare = (c: AnchorCandidate) => {
    if (pinnedAnchor?.kind !== "run") return;
    writePinParams({ kind: "run", id: pinnedAnchor.id }, c.id, pinnedAnchor.setupId);
    setPickerOpen(false);
  };
  const pickSetupCombo = (c: AnchorCandidate) => {
    if (pinnedAnchor?.kind !== "run" || c.kind !== "setup") return;
    writePinParams({ kind: "run", id: pinnedAnchor.id }, pinnedAnchor.compareRunId, c.id);
    setPickerOpen(false);
  };
  const clearPin = () => {
    setPinLabelFallback(null);
    writePinParams(null, null);
  };
  const switchAutoToLatest = () => {
    if (!latestRunCandidate) return;
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("runId", latestRunCandidate.id);
    sp.delete("compareRunId");
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };
  // ─────────────────────────────────────────────────────────────────────────────

  const historyShown = historyOpen ?? messages.length === 0;

  const canCollapseHistory = threads.length > HISTORY_COLLAPSED_COUNT;

  // Collapsed view shows the most recent few, but always keeps the active
  // conversation visible so its highlight isn't hidden behind "Show all".
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
     * TWO CARDS since 2026-08-18, where there used to be one panel with an internal divider:
     * the conversation is one card, past conversations are their own. Same geometry at lg —
     * history still sits in a 19rem left column, it just has its own border and stops at its
     * own content instead of stretching the chat's full height.
     *
     * Phone: chat card, then a history card that starts SHUT (a count row you tap). The old
     * single card ran the thread list underneath the composer, so the page never ended on the
     * thing you came for.
     *
     * DOM order is chat → history; the lg grid puts history back on the left.
     */
    <div className="flex flex-col gap-3 lg:grid lg:h-[min(76dvh,48rem)] lg:grid-cols-[19rem_1fr] lg:gap-3">

      <SurfaceCard
        variant="panel"
        overflowHidden={false}
        className={cn(
          "lg:col-start-2 lg:row-start-1 lg:min-h-0",
          /* A demo visitor with nothing open has an empty card here: no transcript, and no
             composer, because neither belongs in a demo. On a phone that rendered as a blank
             rounded pill floating above the history — a card with no contents at all. At lg it
             still holds the empty state, so it only hides below that. */
          isDemoSession && messages.length === 0 && "hidden lg:block",
        )}
        /* Row 1 is `1fr` so that before the first question the empty track still absorbs the
           slack and the composer sits at the bottom — the way every chat app resolves an empty
           thread. `h-full` re-pins the height the outer grid used to own directly. */
        contentClassName="p-0 flex flex-col lg:grid lg:h-full lg:min-h-0 lg:grid-rows-[1fr_auto]"
      >

      {messages.length > 0 ? (

        /* `lg:max-h-none` is the point of this whole pass: a hard 340px scroll-well is right on a
           phone and absurd on a 1440px monitor, where it left the bottom 45% of the screen empty.
           At lg the grid row owns the height instead. */
        <div className="max-h-[min(42vh,340px)] overflow-y-auto border-b border-border/80 px-3 py-2.5 space-y-2 lg:row-start-1 lg:max-h-none lg:min-h-0 lg:border-b-0 lg:px-5 lg:py-4">

          {messages.map((m, idx) => {

            const parsed = m.role === "assistant" ? parseChoiceChipsFromReply(m.content) : null;

            const displayContent = parsed ? parsed.text : m.content;

            const showChoices =

              m.role === "assistant" &&

              idx === messages.length - 1 &&

              !panelBusy &&

              (parsed?.choices?.length ?? 0) > 0;

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

              {m.role === "assistant" && displayContent ? (

                <EngineerMarkdown>{displayContent}</EngineerMarkdown>

              ) : m.role === "assistant" && chatBusy && idx === messages.length - 1 ? (

                <EngineerThinkingIndicator statusPhase={statusPhase} />

              ) : (

                <div className="whitespace-pre-wrap break-words">

                  {displayContent || (m.role === "assistant" ? "—" : "")}

                </div>

              )}

              {showChoices ? (

                <div className="mt-2 flex flex-wrap gap-1.5">

                  {parsed!.choices!.map((choice) => (

                    <button

                      key={choice}

                      type="button"

                      onClick={() => void sendText(choice)}

                      className="tap-active rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-foreground transition hover:border-primary-ink/60 hover:bg-muted/70"

                    >

                      {choice}

                    </button>

                  ))}

                </div>

              ) : null}

              {ratingsEnabled && m.role === "assistant" && m.messageId ? (

                <EngineerMessageRatingRow

                  messageId={m.messageId}

                  disabled={chatBusy}

                  initialContext={m.ratingContext}

                />

              ) : null}

            </div>

            );

          })}

        </div>

      ) : null}



      {chatErr ? (

        <div className="text-xs text-destructive px-3 pt-2 space-y-1">

          <div className="ui-title text-[11px]">Error</div>

          <pre className="whitespace-pre-wrap break-words font-sans text-[11px] leading-snug opacity-95">

            {chatErr}

          </pre>

        </div>

      ) : null}



      {/*
        * Desktop-only empty state. On a phone the composer is the first thing under the subject
        * bar, so an empty thread reads as "ready" without being told. At lg the transcript owns a
        * full-height grid row, and with no conversation loaded that row is a large blank panel —
        * so it says what belongs there. `hidden lg:flex` is what keeps this off the phone.
        */}
      {messages.length === 0 ? (
        isDemoSession ? (
          <DemoEngineerEmptyState />
        ) : (
          <div className="hidden lg:row-start-1 lg:flex lg:min-h-0 lg:flex-col lg:items-center lg:justify-center lg:gap-2 lg:px-8 lg:text-center">
            <p className="text-sm font-medium text-foreground">Ask the Engineer about your car.</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              It reads the runs, setups and conditions you&rsquo;ve logged. Start with one of these,
              or type your own.
            </p>
            {/* The board owns this row at lg; the rail below is `lg:hidden`, so the
                same list is never on screen twice. */}
            <EngineerStarterQuestions
              variant="board"
              questions={starterQuestions.slice(0, ENGINEER_STARTER_BOARD_COUNT)}
              disabled={panelBusy}
              onPick={fillFromStarter}
              className="mt-2"
            />
          </div>
        )
      ) : null}

      <div
        className={cn(
          "p-3 space-y-2 lg:row-start-2 lg:border-t lg:border-border/80 lg:px-5 lg:py-4",
          /* With nothing open, a demo has neither a composer nor a reading note to put here, and
             the bare row still drew its padding and its top border — an empty grey band ruled off
             under the empty state. */
          isDemoSession && messages.length === 0 && "hidden",
        )}
      >

        {/*
          Everything below is the ASKING half of this panel — what the chat is about, what to ask,
          and the box to ask it in. A demo session cannot ask (founder call 2026-08-25: the demo
          shows answered questions and nothing else), so none of it is rendered rather than being
          rendered disabled. The subject bar and anchor picker go with the composer deliberately:
          both are controls for steering a conversation that is never going to happen, and a
          picker that changes the focus of a chat you cannot send is worse than no picker.
        */}
        {isDemoSession ? (
          // Only under a conversation the visitor has actually read — the empty state carries its
          // own copy and its own door, and both at once reads as the same sentence twice.
          messages.length > 0 ? <DemoEngineerReadingNote /> : null
        ) : (
        <>
        <EngineerSubjectBar
          mode={generalMode ? "general" : "data"}
          pinned={pinnedChip}
          autoLabel={autoLabel}
          switchOffer={switchOffer}
          generalCarName={generalCarName}
          cars={cars}
          selectedGeneralCarId={generalCarId}
          disabled={panelBusy}
          onOpenPicker={() => setPickerOpen((v) => !v)}
          onClearPin={clearPin}
          onSwitch={switchAutoToLatest}
          onSelectData={leaveGeneral}
          onSelectGeneral={enterGeneral}
          onPickGeneralCar={pickGeneralCar}
        />

        {/* Reads as a sentence top to bottom: what I'm asking about → things worth
            asking → the box. Phone only; the desktop board above owns lg, and
            wrapping three rows of chips at 390px pushes the composer under the
            bottom dock. */}
        <EngineerStarterQuestions
          variant="rail"
          questions={starterQuestions}
          disabled={panelBusy}
          onPick={fillFromStarter}
          className="lg:hidden"
        />

        {pickerOpen && !generalMode ? (
          <EngineerAnchorPicker
            candidates={candidates}
            loading={candidatesLoading}
            error={candidatesErr}
            pinnedPrimaryRunId={dataAnchor?.kind === "run" ? dataAnchor.id : null}
            disabled={panelBusy}
            onPickPrimary={pickPrimary}
            onPickCompare={pickCompare}
            onPickSetupCombo={pickSetupCombo}
            onClose={() => setPickerOpen(false)}
          />
        ) : null}

        {/*
          Demo walkthrough stop 6 — the one stop that releases the scrim, so the textarea and
          send button inside the cutout are usable. `/api/engineer/chat` is the only path in
          the demo write allowlist, and the route already caps a demo visitor at two live
          questions a day.
        */}
        <div className="flex items-end gap-2" data-tour="engineer-composer">

          <textarea

            ref={composerRef}

            value={input}

            onChange={(e) => setInput(e.target.value)}

            onKeyDown={(e) => {

              if (e.key === "Enter" && !e.shiftKey) {

                e.preventDefault();

                void sendMessage();

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

            onClick={() => void sendMessage()}

            disabled={panelBusy || !input.trim()}

            aria-label="Send"

            className="shrink-0 min-h-9 min-w-9 p-0"

          >

            <ArrowUp className="size-4" strokeWidth={2.5} aria-hidden />

          </Button>

        </div>
        </>
        )}

      </div>



      </SurfaceCard>

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

        <div
          id="engineer-history-list"
          className={cn("mt-2", historyShown ? "block" : "hidden lg:block")}
        >

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

                      onClick={() => void loadThread(t.id)}

                      disabled={panelBusy || deletingThreadId === t.id}

                      className={cn(

                        "tap-active min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left",

                        (panelBusy || deletingThreadId === t.id) && "opacity-60"

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
                          <span aria-hidden className="mr-1 text-primary-ink">✦</span>
                          {t.answerPreview}
                        </p>
                      ) : null}

                      <div className="mt-0.5">
                        <RelativeTime iso={t.updatedAt} fallback="…" display="relative" />
                      </div>

                    </button>

                    {/* Not for a demo visitor. Middleware refuses the DELETE anyway, but offering
                        it at all puts a destructive control against every row of someone else's
                        season — on the one page whose banner says the demo is read-only. */}
                    {isDemoSession ? null : (
                    <button

                      type="button"

                      onClick={() => void deleteThread(t.id, t.title)}

                      disabled={panelBusy || deletingThreadId === t.id}

                      aria-label={`Delete ${t.title}`}

                      className={cn(

                        /* Full-height target, label at the TOP: on a preview row the button is
                           three lines tall, and a centred "Delete" floated alongside the
                           answer as if it belonged to it. */
                        "tap-active flex shrink-0 items-start rounded-lg px-2.5 pt-2.5 text-[11px] text-muted-foreground transition hover:text-destructive hover:bg-destructive/10",

                        (panelBusy || deletingThreadId === t.id) && "opacity-60 pointer-events-none"

                      )}

                    >

                      {deletingThreadId === t.id ? "…" : "Delete"}

                    </button>
                    )}

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

              {historyExpanded

                ? "Show fewer"

                : `Show all ${threads.length} conversations`}

            </button>

          ) : null}

          </>

        )}

        </div>

      </SurfaceCard>

    </div>

  );

}


