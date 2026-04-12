"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { PatternDigestV1 } from "@/lib/engineerPhase5/patternDigestTypes";
import type { RunCatalogV1 } from "@/lib/engineerPhase5/runCatalogTypes";

type ChatMessage = { role: "user" | "assistant"; content: string };

export function EngineerChatPanel({
  patternDigest = null,
  includeRunCatalog = true,
  onIncludeRunCatalogChange,
}: {
  patternDigest?: PatternDigestV1 | null;
  includeRunCatalog?: boolean;
  onIncludeRunCatalogChange?: (next: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const runIdFromUrl = searchParams.get("runId")?.trim() || null;
  const compareRunIdFromUrl = searchParams.get("compareRunId")?.trim() || null;

  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [catalogBanner, setCatalogBanner] = useState<RunCatalogV1 | null>(null);
  const [catalogBannerErr, setCatalogBannerErr] = useState<string | null>(null);

  useEffect(() => {
    if (!includeRunCatalog) {
      setCatalogBanner(null);
      setCatalogBannerErr(null);
      return;
    }
    let alive = true;
    fetch("/api/runs/catalog", { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .then((data: { catalog?: RunCatalogV1; error?: string }) => {
        if (!alive) return;
        if (data.catalog) {
          setCatalogBanner(data.catalog);
          setCatalogBannerErr(null);
        } else {
          setCatalogBanner(null);
          setCatalogBannerErr(data.error ?? null);
        }
      })
      .catch(() => {
        if (!alive) return;
        setCatalogBanner(null);
        setCatalogBannerErr("Could not load catalog");
      });
    return () => {
      alive = false;
    };
  }, [includeRunCatalog]);

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
          ...(patternDigest ? { patternDigest } : {}),
          includeRunCatalog,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setChatErr((data as { error?: string })?.error ?? "Could not send message.");
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
      setMessages((prev) => [...prev, { role: "assistant" as const, content: reply || "—" }].slice(-8));
    } catch {
      setChatErr("Could not send message.");
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <label className="flex items-center gap-2 text-[11px] text-foreground cursor-pointer">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-primary shrink-0"
            checked={includeRunCatalog}
            onChange={(e) => onIncludeRunCatalogChange?.(e.target.checked)}
          />
          <span>Include account run catalog in answers</span>
        </label>
        <span className="text-[10px] text-muted-foreground sm:text-right">
          Grounds replies in real run ids and dates when enabled.
        </span>
      </div>

      {(runIdFromUrl && compareRunIdFromUrl) || runIdFromUrl || patternDigest ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground rounded-md bg-muted/40 px-2.5 py-2 border border-border/60">
          {runIdFromUrl && compareRunIdFromUrl ? (
            <span>
              <span className="text-foreground font-medium">Compare mode:</span> two runs in URL — chat uses lap + setup
              diff.
            </span>
          ) : runIdFromUrl ? (
            <span>
              <span className="text-foreground font-medium">Focused run</span> from URL.
            </span>
          ) : null}
          {patternDigest ? (
            <span>
              Trend digest: <span className="text-foreground font-medium">{patternDigest.runs.length}</span> runs (load
              in section below).
            </span>
          ) : null}
        </div>
      ) : null}

      {includeRunCatalog && catalogBanner ? (
        <div className="text-[10px] text-muted-foreground rounded-md border border-border/80 bg-muted/25 px-2.5 py-2">
          Catalog in context:{" "}
          <span className="text-foreground font-medium">{catalogBanner.includedRunCount}</span> of{" "}
          <span className="text-foreground font-medium">{catalogBanner.totalRunCount}</span> runs
          {catalogBanner.truncated ? (
            <span className="text-amber-600 dark:text-amber-500">
              {" "}
              ({catalogBanner.omittedCount} not listed — narrow filters in compare section or name a run id)
            </span>
          ) : null}
          .
        </div>
      ) : null}
          {includeRunCatalog && catalogBannerErr ? (
        <div className="text-[10px] text-destructive">{catalogBannerErr}</div>
      ) : null}
      {!includeRunCatalog ? (
        <div className="text-[10px] text-muted-foreground">Catalog off — chat uses summary and digest only.</div>
      ) : null}
      <p className="text-[10px] text-muted-foreground leading-snug">
        You can ask for runs by time (&quot;last weekend&quot;) or teammate name — the Engineer can search and set the
        focused run in the page URL when it finds a match.
      </p>

      <div className="rounded-lg border border-border bg-background min-h-[220px] sm:min-h-[280px] flex flex-col">
        <div className="flex-1 overflow-y-auto p-3 space-y-3 max-h-[min(52vh,420px)]">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground leading-relaxed">
              Ask about setup direction, tires, balance, or what changed between runs. The assistant only uses data in
              your context (summary, catalog when on, compare/digest when loaded).
            </p>
          ) : (
            messages.map((m, idx) => (
              <div
                key={idx}
                className={cn(
                  "text-sm leading-relaxed rounded-md px-3 py-2",
                  m.role === "user" ? "bg-muted/80 text-foreground ml-0 mr-4" : "bg-card border border-border/80 ml-4 mr-0 text-foreground/95"
                )}
              >
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  {m.role === "user" ? "You" : "Engineer"}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
              </div>
            ))
          )}
        </div>
        {chatErr ? <div className="text-xs text-destructive px-3 pb-2">{chatErr}</div> : null}
        <div className="border-t border-border p-3 flex flex-col sm:flex-row gap-2 bg-muted/20">
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
            placeholder="Ask the engineer…"
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
    </div>
  );
}
