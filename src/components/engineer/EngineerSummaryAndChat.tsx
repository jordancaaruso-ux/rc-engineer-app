"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { EngineerRunSummaryPanel } from "@/components/engineer/EngineerRunSummaryPanel";

type ChatMessage = { role: "user" | "assistant"; content: string };

export function EngineerSummaryAndChat() {
  const searchParams = useSearchParams();
  const runIdFromUrl = searchParams.get("runId")?.trim() || null;
  const compareRunIdFromUrl = searchParams.get("compareRunId")?.trim() || null;

  const [runId, setRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");

  const panelRunId = runIdFromUrl ?? runId;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    if (runIdFromUrl) {
      setRunId(runIdFromUrl);
      setLoading(false);
      return () => {
        alive = false;
      };
    }
    fetch("/api/engineer/summary", { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .then((data: { runId?: string | null }) => {
        if (!alive) return;
        setRunId(typeof data.runId === "string" ? data.runId : null);
      })
      .catch(() => {
        if (alive) setRunId(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [runIdFromUrl]);

  async function sendMessage() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setChatErr(null);
    const next: ChatMessage[] = [...messages, { role: "user" as const, content: text }].slice(-8);
    setMessages(next);
    setChatBusy(true);
    try {
      const res = await fetch("/api/engineer/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          ...(runIdFromUrl ? { runId: runIdFromUrl } : {}),
          ...(compareRunIdFromUrl ? { compareRunId: compareRunIdFromUrl } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setChatErr((data as { error?: string })?.error ?? "Could not send message.");
        return;
      }
      const reply = (data as { reply?: string }).reply ?? "";
      setMessages((prev) => [...prev, { role: "assistant" as const, content: reply || "—" }].slice(-8));
    } catch {
      setChatErr("Could not send message.");
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {loading && !runIdFromUrl ? (
        <div className="rounded-lg border border-border bg-muted/50 p-3 text-[11px] text-muted-foreground">Loading…</div>
      ) : panelRunId ? (
        <EngineerRunSummaryPanel runId={panelRunId} />
      ) : (
        <div className="rounded-lg border border-border bg-muted/50 p-3 text-[11px] text-muted-foreground">
          Log a run first — the engineer summary compares your latest run to the previous one on the same car.
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-3 space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Follow-up chat</div>
        <div className="rounded-md border border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
          Optional. Uses the summary above when available, open action items, and — if you opened this page from analysis
          with run links — a focused lap/setup comparison packet for those runs.
        </div>
        {runIdFromUrl && compareRunIdFromUrl ? (
          <div className="text-[10px] text-muted-foreground">
            Comparing two selected runs (chat uses focused lap + setup diff; deterministic summary may be hidden when
            both IDs are set).
          </div>
        ) : runIdFromUrl ? (
          <div className="text-[10px] text-muted-foreground">Focused on the run in the URL — chat includes that run&apos;s context.</div>
        ) : null}
        <div className="space-y-2">
          <div className="rounded-md border border-border bg-background p-2 max-h-56 overflow-y-auto space-y-2">
            {messages.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">No messages yet.</div>
            ) : (
              messages.map((m, idx) => (
                <div
                  key={idx}
                  className={cn("text-[11px] leading-snug", m.role === "user" ? "text-foreground" : "text-muted-foreground")}
                >
                  <span className="font-medium text-muted-foreground mr-1">{m.role === "user" ? "You:" : "Assistant:"}</span>
                  <span className="whitespace-pre-wrap break-words">{m.content}</span>
                </div>
              ))
            )}
          </div>
          {chatErr ? <div className="text-[11px] text-destructive">{chatErr}</div> : null}
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs outline-none"
              placeholder="Ask a follow-up question…"
              disabled={chatBusy}
              aria-label="Engineer follow-up question"
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={chatBusy || !input.trim()}
              className={cn(
                "inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-[11px] font-medium text-primary-foreground shadow-glow-sm transition hover:brightness-105",
                (chatBusy || !input.trim()) && "opacity-60 pointer-events-none"
              )}
            >
              {chatBusy ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
