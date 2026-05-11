"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

type ChatMessage = { role: "user" | "assistant"; content: string };

export type EngineerQueuedChatPrompt = { id: number; text: string };

export function EngineerChatPanel({
  queuedPrompt = null,
  onQueuedPromptConsumed,
}: {
  /** When set, appends this user message and posts to the API once (use a new `id` per enqueue). */
  queuedPrompt?: EngineerQueuedChatPrompt | null;
  onQueuedPromptConsumed?: () => void;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const runIdFromUrl = searchParams.get("runId")?.trim() || null;
  const compareRunIdFromUrl = searchParams.get("compareRunId")?.trim() || null;

  const [chatBusy, setChatBusy] = useState(false);
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

  async function submitConversation(next: ChatMessage[]) {
    setChatBusy(true);
    setChatErr(null);
    try {
      const res = await fetch("/api/engineer/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          ...(runIdFromUrl ? { runId: runIdFromUrl } : {}),
          ...(compareRunIdFromUrl ? { compareRunId: compareRunIdFromUrl } : {}),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        debug?: string;
      };
      if (!res.ok) {
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
      const resolved = (data as { resolvedFocus?: { runId: string; compareRunId: string | null } | null })
        .resolvedFocus;
      if (resolved?.runId) {
        const sp = new URLSearchParams(searchParams.toString());
        sp.set("runId", resolved.runId);
        if (resolved.compareRunId) sp.set("compareRunId", resolved.compareRunId);
        else sp.delete("compareRunId");
        router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
      }
      const reply = (data as { reply?: string }).reply ?? "";
      setMessages((prev) => {
        const withAssistant = [...prev, { role: "assistant" as const, content: reply || "—" }].slice(-8);
        messagesRef.current = withAssistant;
        return withAssistant;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error — check connection and try again.";
      setChatErr(`Could not reach server: ${msg}`);
    } finally {
      setChatBusy(false);
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

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-background flex flex-col">
        <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[220px] sm:min-h-[280px] max-h-[min(52vh,420px)]">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground leading-relaxed">
              Ask about setup, handling, or laps. Optional: set a primary run (and compare run) in{" "}
              <span className="font-medium text-foreground/90">Compare &amp; trend</span> so answers anchor to those
              URLs.
            </p>
          ) : (
            messages.map((m, idx) => (
              <div
                key={idx}
                className={cn(
                  "text-sm leading-relaxed rounded-md px-3 py-2",
                  m.role === "user"
                    ? "bg-muted/80 text-foreground ml-0 mr-4"
                    : "bg-card border border-border/80 ml-4 mr-0 text-foreground/95"
                )}
              >
                <div className="text-[10px] ui-title text-muted-foreground mb-1">
                  {m.role === "user" ? "You" : "Engineer"}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
              </div>
            ))
          )}
        </div>
        {chatErr ? (
          <div className="text-xs text-destructive px-3 pb-2 space-y-1 border-t border-border">
            <div className="ui-title text-[11px] pt-2">Error</div>
            <pre className="whitespace-pre-wrap break-words font-sans text-[11px] leading-snug opacity-95">
              {chatErr}
            </pre>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-3 flex flex-col sm:flex-row gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendMessage();
            }
          }}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none min-h-[44px]"
          placeholder="Ask the Engineer…"
          disabled={chatBusy}
          aria-label="Message to engineer"
        />
        <button
          type="button"
          onClick={() => void sendMessage()}
          disabled={chatBusy || !input.trim()}
          className={cn(
            "inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-105 shrink-0 min-h-[44px]",
            (chatBusy || !input.trim()) && "opacity-60 pointer-events-none"
          )}
        >
          {chatBusy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
