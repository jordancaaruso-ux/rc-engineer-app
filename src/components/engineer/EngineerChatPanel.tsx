"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, MessageSquarePlus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { EngineerMessageRatingRow } from "@/components/engineer/EngineerMessageRatingRow";
import { Button } from "@/components/ui/Button";
import { EngineerMarkdown } from "@/components/ui/EngineerMarkdown";
import { Eyebrow } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/RelativeTime";

/**
 * The Engineer chat, rebuilt minimal (2026-08-13, docs/ENGINEER_NORTH_STAR.md):
 * thread history, the conversation, the composer, and ratings. The anchor picker,
 * subject bar, choice chips and status theatre all died with the old pipeline —
 * anything that returns must earn its place through the eval harness first.
 */

type RatingContext = {
  question?: string;
  answer?: string;
  runId?: string | null;
  compareRunId?: string | null;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  messageId?: string;
  ratingContext?: RatingContext;
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
  ratingContext?: RatingContext;
};

export type EngineerQueuedChatPrompt = { id: number; text: string };

// History starts collapsed to the most recent few conversations; the rest live
// behind a "Show all" toggle so the panel doesn't scroll into a wall of threads.
const HISTORY_COLLAPSED_COUNT = 4;

async function readSseStream(
  res: Response,
  handlers: { onToken?: (text: string) => void }
): Promise<{ reply: string; feedback: EngineerChatFeedback | null }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Stream had no body");
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
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
      } else if (event === "done") {
        if (typeof data.reply === "string" && data.reply.trim()) reply = data.reply;
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

  return { reply, feedback };
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
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  // The transcript follows the newest words as they arrive. `stickToBottom` drops to false the
  // moment the driver scrolls up to re-read an earlier answer, and comes back the moment they
  // return to the foot of the thread (or send anything), so following never fights a deliberate
  // scroll back.
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const transcriptInnerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const consumedPromptIdRef = useRef<number | null>(null);

  const refreshThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/engineer/threads?limit=30");
      if (!res.ok) return;
      const data = (await res.json()) as { threads?: ThreadSummary[] };
      if (Array.isArray(data.threads)) setThreads(data.threads);
    } catch {
      /* history is a convenience — never block the chat on it */
    }
  }, []);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that conversation");
    } finally {
      setLoadingThread(false);
    }
  }, []);

  const deleteThread = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/engineer/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch {
        /* refresh below shows the truth either way */
      }
      if (threadId === id) {
        setThreadId(null);
        setMessages([]);
      }
      void refreshThreads();
    },
    [refreshThreads, threadId]
  );

  const newChat = useCallback(() => {
    setThreadId(null);
    stickToBottom.current = true;
    setMessages([]);
    setError(null);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || sending) return;
      setError(null);
      setSending(true);
      stickToBottom.current = true;
      setInput("");

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
          }),
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const { reply, feedback } = await readSseStream(res, {
          onToken: (t) => applyAssistant((prev) => ({ ...prev, content: prev.content + t })),
        });
        applyAssistant((prev) => ({
          ...prev,
          content: reply || prev.content,
          messageId: feedback?.assistantMessageId,
          ratingContext: feedback?.ratingContext,
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
      }
    },
    [messages, refreshThreads, sending, threadId]
  );

  // A `?prompt=` handoff (dashboard cards) lands in the composer and sends itself once.
  useEffect(() => {
    if (!queuedPrompt || consumedPromptIdRef.current === queuedPrompt.id) return;
    consumedPromptIdRef.current = queuedPrompt.id;
    onQueuedPromptConsumed?.();
    void send(queuedPrompt.text);
  }, [onQueuedPromptConsumed, queuedPrompt, send]);

  const visibleThreads = historyExpanded ? threads : threads.slice(0, HISTORY_COLLAPSED_COUNT);
  const inConversation = messages.length > 0 || sending;

  return (
    <div className="flex min-h-0 flex-col lg:flex-row">
      {/* History */}
      <aside className="order-2 border-t border-border lg:order-1 lg:w-64 lg:shrink-0 lg:border-r lg:border-t-0">
        <div className="flex items-center justify-between px-4 pt-3">
          <Eyebrow>History</Eyebrow>
          <button
            type="button"
            onClick={newChat}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
            New chat
          </button>
        </div>
        <ul className="space-y-0.5 p-2">
          {visibleThreads.map((t) => (
            <li key={t.id} className="group flex items-start gap-1">
              <button
                type="button"
                onClick={() => void openThread(t.id)}
                className={cn(
                  "min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition hover:bg-muted/50",
                  threadId === t.id && "bg-muted/60"
                )}
              >
                <span className="block truncate text-[13px] text-foreground">{t.title}</span>
                <span className="block text-[10px] text-muted-foreground">
                  <RelativeTime iso={t.updatedAt} fallback="" />
                </span>
              </button>
              <button
                type="button"
                aria-label="Delete conversation"
                onClick={() => void deleteThread(t.id)}
                className="mt-1.5 rounded p-1 text-muted-foreground/50 opacity-0 transition hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
          {threads.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">No conversations yet.</li>
          ) : null}
        </ul>
        {threads.length > HISTORY_COLLAPSED_COUNT ? (
          <button
            type="button"
            onClick={() => setHistoryExpanded((v) => !v)}
            className="px-4 pb-3 text-xs text-muted-foreground transition hover:text-foreground"
          >
            {historyExpanded ? "Show fewer" : `Show all (${threads.length})`}
          </button>
        ) : null}
      </aside>

      {/* Conversation */}
      <div className="order-1 flex min-h-0 flex-1 flex-col lg:order-2">
        <div
          ref={transcriptRef}
          data-testid="engineer-transcript"
          className="min-h-[16rem] flex-1 overflow-y-auto p-4"
        >
          {/* The inner box is what the ResizeObserver watches: a scroll container never reports its
              own content growing, so the following would stop the moment tokens arrived. */}
          <div ref={transcriptInnerRef} className="space-y-4">
          {loadingThread ? (
            <p className="text-sm text-muted-foreground">Loading conversation…</p>
          ) : !inConversation ? (
            <div className="max-w-prose space-y-1 pt-2">
              <p className="text-sm text-foreground">Ask about setup, handling, or the physics behind either.</p>
              <p className="text-xs text-muted-foreground">
                “Pushes mid-corner on high grip — what would you try first?”
              </p>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[92%] rounded-xl px-3 py-2 text-sm lg:max-w-[80%]",
                    m.role === "user"
                      ? "bg-primary/10 text-foreground"
                      : "bg-muted/40 text-foreground"
                  )}
                >
                  {m.role === "assistant" ? (
                    m.content ? (
                      <EngineerMarkdown>{m.content}</EngineerMarkdown>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <span className="animate-pulse">Thinking…</span>
                      </span>
                    )
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}
                  {m.role === "assistant" && ratingsEnabled && m.messageId ? (
                    <EngineerMessageRatingRow
                      messageId={m.messageId}
                      initialContext={m.ratingContext}
                    />
                  ) : null}
                </div>
              </div>
            ))
          )}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        </div>

        {/* Composer */}
        <form
          data-tour="engineer-composer"
          className="flex items-end gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            aria-label="Message to engineer"
            placeholder="Ask the Engineer…"
            className="min-h-[3rem] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
            disabled={sending}
          />
          <Button type="submit" disabled={sending || !input.trim()} aria-label="Send">
            <ArrowUp className="h-4 w-4" aria-hidden />
          </Button>
        </form>
      </div>
    </div>
  );
}
