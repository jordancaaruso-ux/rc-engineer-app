"use client";



import { useCallback, useEffect, useRef, useState } from "react";

import { ArrowUp, MessageSquarePlus } from "lucide-react";

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

import { EngineerAnchorPicker } from "@/components/engineer/EngineerAnchorPicker";

import { EngineerSubjectBar } from "@/components/engineer/EngineerSubjectBar";

import { EngineerMessageRatingRow } from "@/components/engineer/EngineerMessageRatingRow";

import { EngineerThinkingIndicator } from "@/components/engineer/EngineerThinkingIndicator";

import { Button } from "@/components/ui/Button";

import { EngineerMarkdown } from "@/components/ui/EngineerMarkdown";

import { Eyebrow } from "@/components/ui/panel";


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

    <div className="flex flex-col">

      {messages.length > 0 ? (

        <div className="max-h-[min(42vh,340px)] overflow-y-auto border-b border-border/80 px-3 py-2.5 space-y-2">

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

                      className="tap-active rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-foreground transition hover:border-primary/60 hover:bg-muted/70"

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



      <div className="p-3 space-y-2">

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

        <div className="flex items-end gap-2">

          <textarea

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

      </div>



      <div className="border-t border-border/80 px-3 py-3 md:px-4">

        <Eyebrow className="mb-2">History</Eyebrow>

        {threadsLoading ? (

          <p className="text-[11px] text-muted-foreground">Loading conversations…</p>

        ) : threadsErr ? (

          <p className="text-[11px] text-destructive">{threadsErr}</p>

        ) : threads.length === 0 ? (

          <p className="text-[11px] text-muted-foreground">No past conversations yet.</p>

        ) : (

          <>

          <ul className="space-y-1">

            {visibleThreads.map((t) => {

              const active = t.id === threadId;

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

                      <div className="truncate text-sm text-foreground">{t.title}</div>

                      <div className="mt-0.5">
                        <RelativeTime iso={t.updatedAt} fallback="…" display="relative" />
                      </div>

                    </button>

                    <button

                      type="button"

                      onClick={() => void deleteThread(t.id, t.title)}

                      disabled={panelBusy || deletingThreadId === t.id}

                      aria-label={`Delete ${t.title}`}

                      className={cn(

                        "tap-active shrink-0 rounded-lg px-2.5 text-[11px] text-muted-foreground transition hover:text-destructive hover:bg-destructive/10",

                        (panelBusy || deletingThreadId === t.id) && "opacity-60 pointer-events-none"

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

              {historyExpanded

                ? "Show fewer"

                : `Show all ${threads.length} conversations`}

            </button>

          ) : null}

          </>

        )}

      </div>

    </div>

  );

}


