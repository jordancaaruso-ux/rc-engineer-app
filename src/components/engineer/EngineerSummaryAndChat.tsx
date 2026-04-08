"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type EngineerSummaryV1 = {
  whatChanged: string[];
  whatStandsOut: string[];
  possibleExplanations: string[];
  thingsToConsiderNext: string[];
  notes?: string | null;
};

type Packet = {
  version: number;
  generatedAtIso: string;
  latestRun: null | {
    createdAtLabel: string;
    sessionTypeLabel: string;
    carName: string;
    trackName: string;
    eventName: string | null;
    lapSummary: null | { lapCount: number; bestLapSeconds: number | null; avgTop5Seconds: number | null };
    setup: { setupDeltaKeyCount: number; setupDeltaKeys: string[] };
    notesPreview: string | null;
  };
  previousRun: null | {
    createdAtLabel: string;
    sessionTypeLabel: string;
    carName: string;
    trackName: string;
    lapSummary: null | { lapCount: number; bestLapSeconds: number | null; avgTop5Seconds: number | null };
  };
  comparison: null | {
    lapDeltaSummary: {
      bestLapDeltaSeconds: number | null;
      avgTop5DeltaSeconds: number | null;
      direction: "improved" | "regressed" | "flat" | "unknown";
    };
    setupChangeSummary: { changedKeyCount: number; changedKeysSample: string[] };
  };
  thingsToTry: Array<{ id: string; text: string }>;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

function Section({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {items.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">{empty}</div>
      ) : (
        <ul className="space-y-1 text-[11px] text-foreground list-disc pl-4">
          {items.map((t, i) => (
            <li key={`${title}-${i}`} className="leading-snug">
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EngineerSummaryAndChat() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [summary, setSummary] = useState<EngineerSummaryV1 | null>(null);

  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");

  async function loadSummary() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/engineer/summary", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr((data as { error?: string })?.error ?? "Could not generate engineer summary.");
        setPacket(null);
        setSummary(null);
        return;
      }
      setPacket((data as { packet?: Packet }).packet ?? null);
      setSummary((data as { summary?: EngineerSummaryV1 }).summary ?? null);
    } catch {
      setErr("Could not generate engineer summary.");
      setPacket(null);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ctxLine = useMemo(() => {
    if (!packet?.latestRun) return "No runs saved yet — log a run to get an engineer summary.";
    const lr = packet.latestRun;
    const parts = [
      lr.createdAtLabel,
      lr.sessionTypeLabel,
      lr.carName,
      lr.trackName,
      lr.eventName ? lr.eventName : null,
    ].filter(Boolean) as string[];
    return parts.join(" · ");
  }, [packet]);

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
        body: JSON.stringify({ messages: next }),
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
      <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs space-y-2">
        <div className="ui-title text-[10px] uppercase tracking-wide text-muted-foreground">
          Current context (compact)
        </div>
        <div className="text-[11px] text-muted-foreground leading-snug">{ctxLine}</div>
        {packet?.latestRun?.lapSummary ? (
          <div className="text-[11px] text-muted-foreground">
            Laps: <span className="text-foreground/90 font-mono">{packet.latestRun.lapSummary.lapCount}</span> · Best:{" "}
            <span className="text-foreground/90 font-mono">
              {packet.latestRun.lapSummary.bestLapSeconds != null ? packet.latestRun.lapSummary.bestLapSeconds.toFixed(3) : "—"}
            </span>
            s · Avg top 5:{" "}
            <span className="text-foreground/90 font-mono">
              {packet.latestRun.lapSummary.avgTop5Seconds != null ? packet.latestRun.lapSummary.avgTop5Seconds.toFixed(3) : "—"}
            </span>
            s
          </div>
        ) : null}
        {packet?.comparison ? (
          <div className="text-[11px] text-muted-foreground">
            Compared to previous run:{" "}
            <span className="text-foreground/90">
              {packet.comparison.lapDeltaSummary.direction}
            </span>
            {packet.comparison.lapDeltaSummary.avgTop5DeltaSeconds != null ? (
              <>
                {" "}
                · Δ avg top 5:{" "}
                <span className="font-mono text-foreground/90">
                  {packet.comparison.lapDeltaSummary.avgTop5DeltaSeconds >= 0 ? "+" : ""}
                  {packet.comparison.lapDeltaSummary.avgTop5DeltaSeconds.toFixed(3)}s
                </span>
              </>
            ) : null}
            {packet.comparison.setupChangeSummary.changedKeyCount > 0 ? (
              <>
                {" "}
                · Setup changed keys:{" "}
                <span className="font-mono text-foreground/90">{packet.comparison.setupChangeSummary.changedKeyCount}</span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-card p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Engineer summary</div>
          <button
            type="button"
            onClick={() => void loadSummary()}
            className={cn(
              "rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/60 transition",
              loading && "opacity-60 pointer-events-none"
            )}
          >
            {loading ? "Generating…" : "Regenerate"}
          </button>
        </div>
        {err ? <div className="text-[11px] text-destructive">{err}</div> : null}
        {!err && loading ? <div className="text-[11px] text-muted-foreground">Generating summary…</div> : null}
        {!err && !loading && !summary ? <div className="text-[11px] text-muted-foreground">—</div> : null}
        {summary ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Section title="What changed" items={summary.whatChanged ?? []} empty="No clear changes found in the stored context." />
            <Section title="What stands out" items={summary.whatStandsOut ?? []} empty="No strong signals yet." />
            <Section
              title="Possible explanations"
              items={summary.possibleExplanations ?? []}
              empty="Not enough evidence for confident explanations yet."
            />
            <Section
              title="Things to consider next"
              items={summary.thingsToConsiderNext ?? []}
              empty="Ask a question below to steer the engineer."
            />
            {summary.notes ? (
              <div className="md:col-span-2 text-[11px] text-muted-foreground border-t border-border pt-2">
                {summary.notes}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-card p-3 space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Follow-up</div>
        <div className="rounded-md border border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
          Ask about setup, handling, or what to try next. The engineer will only use your current stored context.
        </div>
        <div className="space-y-2">
          <div className="rounded-md border border-border bg-background p-2 max-h-56 overflow-y-auto space-y-2">
            {messages.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">No messages yet.</div>
            ) : (
              messages.map((m, idx) => (
                <div key={idx} className={cn("text-[11px] leading-snug", m.role === "user" ? "text-foreground" : "text-muted-foreground")}>
                  <span className="font-medium text-muted-foreground mr-1">{m.role === "user" ? "You:" : "Engineer:"}</span>
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
              placeholder="Ask about entry/mid/exit, grip, setup direction, or what to test next…"
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

