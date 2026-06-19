"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

type ChatMessage = { role: "user" | "assistant"; content: string };

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
): Promise<{ reply: string; resolvedFocus: { runId: string; compareRunId: string | null } | null }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Stream had no body");
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  let resolvedFocus: { runId: string; compareRunId: string | null } | null = null;

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
      } else if (event === "error") {
        throw new Error(typeof data.message === "string" ? data.message : "Engineer chat failed");
      }
    }
  }

  return { reply, resolvedFocus };
}

export function EngineerChatPanel({
  queuedPrompt = null,
  onQueuedPromptConsumed,
}: {
  queuedPrompt?: EngineerQueuedChatPrompt | null;
  onQueuedPromptConsumed?: () => void;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const runIdFromUrl = searchParams.get("runId")?.trim() || null;
  const compareRunIdFromUrl = searchParams.get("compareRunId")?.trim() || null;

  const [chatBusy, setChatBusy] = useState(false);
  const [statusPhase, setStatusPhase] = useState<string | null>(null);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");

  const messagesRef = useRef<ChatMessage[]>([]);
  const lastQueuedId = useRef<number | null>(null);
  const onQueuedConsumedRef = useRef(onQueuedPromptConsumed);
  useEffect(() => {
    onQueuedConsumedRef.current = onQueuedPromptConsumed;
  }, [onQueuedPromptConsumed]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  function applyResolvedFocus(resolved: { runId: string; compareRunId: string | null } | null) {
    if (!resolved?.runId) return;
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("runId", resolved.runId);
    if (resolved.compareRunId) sp.set("compareRunId", resolved.compareRunId);
    else sp.delete("compareRunId");
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  async function submitConversation(next: ChatMessage[]) {
    setChatBusy(true);
    setStatusPhase("preparing");
    setChatErr(null);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    try {
      const res = await fetch("/api/engineer/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          stream: true,
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
        const { reply, resolvedFocus } = await readSseStream(res, {
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
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") {
            copy[copy.length - 1] = {
              role: "assistant",
              content: reply || last.content || "—",
            };
          }
          const trimmed = copy.slice(-8);
          messagesRef.current = trimmed;
          return trimmed;
        });
        return;
      }

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        debug?: string;
        reply?: string;
        resolvedFocus?: { runId: string; compareRunId: string | null } | null;
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
      const reply = data.reply ?? "";
      setMessages((prev) => {
        const withoutEmpty = prev.slice(0, -1);
        const withAssistant = [...withoutEmpty, { role: "assistant" as const, content: reply || "—" }].slice(-8);
        messagesRef.current = withAssistant;
        return withAssistant;
      });
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

    const next = [...messagesRef.current, { role: "user" as const, content: text }].slice(-8);
    messagesRef.current = next;
    setMessages(next);
    void submitConversation(next);
  }, [queuedPrompt?.id, queuedPrompt?.text]);

  async function sendMessage() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const next: ChatMessage[] = [...messagesRef.current, { role: "user" as const, content: text }].slice(-8);
    messagesRef.current = next;
    setMessages(next);
    await submitConversation(next);
  }

  const statusLabel = statusPhase ? (STATUS_LABEL[statusPhase] ?? "Working…") : null;

  return (
    <div className="flex flex-col">
      {messages.length > 0 ? (
        <div className="max-h-[min(42vh,340px)] overflow-y-auto border-b border-border/80 px-3 py-2.5 space-y-2">
          {messages.map((m, idx) => (
            <div
              key={idx}
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

      <div className="p-3">
        {messages.length === 0 ? (
          <p className="mb-2 text-[11px] text-muted-foreground leading-snug">
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
            className="flex-1 min-h-[42px] max-h-28 resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            placeholder="Ask the Engineer…"
            disabled={chatBusy}
            aria-label="Message to engineer"
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={chatBusy || !input.trim()}
            className={cn(
              "inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-105 shrink-0 min-h-[42px]",
              (chatBusy || !input.trim()) && "opacity-60 pointer-events-none"
            )}
          >
            {chatBusy ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
