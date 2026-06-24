"use client";



import { useCallback, useEffect, useRef, useState } from "react";

import { ArrowUp, MessageSquarePlus } from "lucide-react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

import { EngineerMessageRatingRow } from "@/components/engineer/EngineerMessageRatingRow";

import { Button } from "@/components/ui/Button";

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



const STATUS_LABEL: Record<string, string> = {

  preparing: "Preparing context…",

  thinking: "Thinking…",

};



async function readSseStream(

  res: Response,

  handlers: {

    onToken?: (text: string) => void;

    onStatus?: (phase: string) => void;

  }

): Promise<{

  reply: string;

  resolvedFocus: { runId: string; compareRunId: string | null } | null;

  feedback: EngineerChatFeedback | null;

}> {

  const reader = res.body?.getReader();

  if (!reader) throw new Error("Stream had no body");

  const decoder = new TextDecoder();

  let buffer = "";

  let reply = "";

  let resolvedFocus: { runId: string; compareRunId: string | null } | null = null;

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



  return { reply, resolvedFocus, feedback };

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

    const sp = new URLSearchParams(searchParams.toString());

    sp.set("runId", resolved.runId);

    if (resolved.compareRunId) sp.set("compareRunId", resolved.compareRunId);

    else sp.delete("compareRunId");

    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });

  }



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

        syncThreadToUrl(id);

        setMessages(mapped);

        messagesRef.current = mapped;

      } catch (e) {

        setChatErr(e instanceof Error ? e.message : "Could not load conversation");

      } finally {

        setLoadingThread(false);

      }

    },

    [syncThreadToUrl]

  );



  const startNewChat = useCallback(() => {

    initialUrlThreadLoaded.current = null;

    setThreadId(null);

    setMessages([]);

    messagesRef.current = [];

    setChatErr(null);

    setInput("");

    syncThreadToUrl(null);

  }, [syncThreadToUrl]);



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

          ...(runIdFromUrl ? { runId: runIdFromUrl } : {}),

          ...(compareRunIdFromUrl ? { compareRunId: compareRunIdFromUrl } : {}),

          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,

        }),

      });



      if (res.headers.get("content-type")?.includes("text/event-stream") && res.ok && res.body) {

        let pendingTokens = "";

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

        const { reply, resolvedFocus, feedback } = await readSseStream(res, {

          onStatus: (phase) => setStatusPhase(phase),

          onToken: (token) => {

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



  async function sendMessage() {

    const text = input.trim();

    if (!text || chatBusy || loadingThread) return;

    setInput("");

    const displayNext: ChatMessage[] = [...messagesRef.current, { role: "user", content: text }];

    messagesRef.current = displayNext;

    setMessages(displayNext);

    await submitConversation(displayNext.slice(-8));

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



  const statusLabel = statusPhase ? (STATUS_LABEL[statusPhase] ?? "Working…") : null;

  const panelBusy = chatBusy || loadingThread;

  const showNewChat = Boolean(threadId || messages.length > 0);



  return (

    <div className="flex flex-col">

      {messages.length > 0 ? (

        <div className="max-h-[min(42vh,340px)] overflow-y-auto border-b border-border/80 px-3 py-2.5 space-y-2">

          {messages.map((m, idx) => (

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

              <div className="whitespace-pre-wrap break-words">

                {m.content ||

                  (chatBusy && m.role === "assistant"

                    ? statusLabel ?? "…"

                    : m.role === "assistant"

                      ? "—"

                      : "")}

              </div>

              {ratingsEnabled && m.role === "assistant" && m.messageId ? (

                <EngineerMessageRatingRow

                  messageId={m.messageId}

                  disabled={chatBusy}

                  initialContext={m.ratingContext}

                />

              ) : null}

            </div>

          ))}

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

        {messages.length === 0 ? (

          <p className="text-[11px] text-muted-foreground leading-snug">

            Ask about setup, handling, or laps. Set a primary run in{" "}

            <span className="text-foreground/80">Compare &amp; trend</span> to anchor answers.

          </p>

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

          <ul className="space-y-1">

            {threads.map((t) => {

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

        )}

      </div>

    </div>

  );

}


