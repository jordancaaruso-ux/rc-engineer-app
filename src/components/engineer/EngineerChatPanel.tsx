"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { PatternDigestV1 } from "@/lib/engineerPhase5/patternDigestTypes";
import type { PaceVsFieldRunDigestV1 } from "@/lib/engineerPhase5/paceVsFieldRunDigestTypes";
import type { RunCatalogV1 } from "@/lib/engineerPhase5/runCatalogTypes";
import { engineerQuickPromptDisabled, engineerQuickPromptsForSurface } from "@/lib/engineerQuickPrompts";

type ChatMessage = { role: "user" | "assistant"; content: string };

export type EngineerQueuedChatPrompt = { id: number; text: string };

const chatQuickBtnClass =
  "inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] font-medium text-foreground hover:bg-muted/70 transition disabled:opacity-40 disabled:cursor-not-allowed";

export function EngineerChatPanel({
  patternDigest = null,
  includeRunCatalog = true,
  onIncludeRunCatalogChange,
  includePatternDigestInChat = false,
  onIncludePatternDigestInChatChange,
  queuedPrompt = null,
  onQueuedPromptConsumed,
  onQuickPrompt,
}: {
  patternDigest?: PatternDigestV1 | null;
  includeRunCatalog?: boolean;
  onIncludeRunCatalogChange?: (next: boolean) => void;
  /** When true, POST /api/engineer/chat sends patternDigest (Compare & trend must have loaded one). */
  includePatternDigestInChat?: boolean;
  onIncludePatternDigestInChatChange?: (next: boolean) => void;
  /** When set, appends this user message and posts to the API once (use a new `id` per enqueue). */
  queuedPrompt?: EngineerQueuedChatPrompt | null;
  onQueuedPromptConsumed?: () => void;
  /** Engineer page: enqueue a canned prompt (same as run-summary quick asks). */
  onQuickPrompt?: (text: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const runIdFromUrl = searchParams.get("runId")?.trim() || null;
  const compareRunIdFromUrl = searchParams.get("compareRunId")?.trim() || null;
  const chatPanelQuickPrompts = engineerQuickPromptsForSurface("chat_panel");

  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [catalogBanner, setCatalogBanner] = useState<RunCatalogV1 | null>(null);
  const [catalogBannerErr, setCatalogBannerErr] = useState<string | null>(null);
  const [paceDigest, setPaceDigest] = useState<PaceVsFieldRunDigestV1 | null>(null);
  const [paceDigestLoading, setPaceDigestLoading] = useState(false);
  const [paceDigestErr, setPaceDigestErr] = useState<string | null>(null);
  const [includePaceDigestInChat, setIncludePaceDigestInChat] = useState(true);
  const [paceScopeCarOnly, setPaceScopeCarOnly] = useState(Boolean(runIdFromUrl));

  const messagesRef = useRef<ChatMessage[]>([]);
  const lastQueuedId = useRef<number | null>(null);
  const paceDigestRef = useRef<PaceVsFieldRunDigestV1 | null>(null);
  const includePaceDigestRef = useRef(true);
  const onQueuedConsumedRef = useRef(onQueuedPromptConsumed);
  useEffect(() => {
    onQueuedConsumedRef.current = onQueuedPromptConsumed;
  }, [onQueuedPromptConsumed]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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

  useEffect(() => {
    paceDigestRef.current = paceDigest;
  }, [paceDigest]);

  useEffect(() => {
    includePaceDigestRef.current = includePaceDigestInChat;
  }, [includePaceDigestInChat]);

  async function loadPaceDigest() {
    setPaceDigestLoading(true);
    setPaceDigestErr(null);
    try {
      const qs = new URLSearchParams();
      if (runIdFromUrl && paceScopeCarOnly) {
        qs.set("scope", "car");
        qs.set("anchorRunId", runIdFromUrl);
      } else {
        qs.set("scope", "account");
        if (runIdFromUrl) qs.set("anchorRunId", runIdFromUrl);
      }
      const res = await fetch(`/api/engineer/pace-vs-field-digest?${qs}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPaceDigestErr((data as { error?: string }).error ?? "Could not load digest");
        setPaceDigest(null);
        return;
      }
      const d = (data as { digest?: PaceVsFieldRunDigestV1 }).digest;
      if (!d || d.version !== 1) {
        setPaceDigestErr("Invalid digest response");
        setPaceDigest(null);
        return;
      }
      setPaceDigest(d);
      setIncludePaceDigestInChat(true);
    } catch {
      setPaceDigestErr("Could not load digest");
      setPaceDigest(null);
    } finally {
      setPaceDigestLoading(false);
    }
  }

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
          includePatternDigest: Boolean(patternDigest && includePatternDigestInChat),
          ...(patternDigest && includePatternDigestInChat ? { patternDigest } : {}),
          includeRunCatalog,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(paceDigestRef.current && includePaceDigestRef.current
            ? { paceVsFieldRunDigest: paceDigestRef.current }
            : {}),
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
            Ask anything—general setup and KB, or a compare from the URL. Trend/series context is **optional** (see below).
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

      {onQuickPrompt ? (
        <div className="space-y-1.5 rounded-md border border-border/80 bg-muted/20 px-2.5 py-2">
          <div className="text-[10px] ui-title text-muted-foreground">Quick prompts</div>
          <div className="flex flex-wrap gap-1.5">
            {chatPanelQuickPrompts.map((def) => {
              const dis = engineerQuickPromptDisabled(def, {
                hasRunId: Boolean(runIdFromUrl),
                hasCompareRunId: Boolean(compareRunIdFromUrl),
                hasPatternDigest: patternDigest != null,
                hasPaceVsFieldDigest: paceDigest != null,
              });
              let hint = def.label;
              if (dis) {
                if (def.requiresRunId !== false && !runIdFromUrl) hint = "Set a primary run in Compare & trend below first";
                else if (def.requiresCompare && !compareRunIdFromUrl) hint = "Pick a compare run in Compare & trend below first";
                else if (def.requiresPatternDigest && !patternDigest)
                  hint = "Load trend digest in Compare & trend below first";
                else if (def.requiresPaceVsFieldDigest && !paceDigest)
                  hint = "Load pace vs field digest below first";
              }
              return (
                <button
                  key={def.id}
                  type="button"
                  title={hint}
                  disabled={dis}
                  className={chatQuickBtnClass}
                  onClick={() => onQuickPrompt(def.prompt)}
                >
                  {def.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

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
          placeholder="Custom text — ask the engineer…"
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

      <div className="space-y-2 pt-1 text-[10px] text-muted-foreground">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <label
            className={cn(
              "flex items-center gap-2 text-[11px] text-foreground cursor-pointer",
              !patternDigest && "opacity-50 cursor-not-allowed"
            )}
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-primary shrink-0"
              checked={includePatternDigestInChat && Boolean(patternDigest)}
              disabled={!patternDigest}
              onChange={(e) => onIncludePatternDigestInChatChange?.(e.target.checked)}
            />
            <span>Attach Compare &amp; trend digest to chat</span>
          </label>
          <span className="sm:text-right">
            Off by default—keeps chat separate from the series tool until you opt in.
          </span>
        </div>

        <div className="rounded-md border border-border/80 bg-muted/25 px-2.5 py-2 space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Pace vs field (linked timing)
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Lists runs where avg top 10 vs the <span className="text-foreground/90">session field mean</span> is
            meaningful (multi-driver import, matched row, ≥10 laps). Gap = your avg10 − mean (negative = faster than
            average).
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              onClick={() => void loadPaceDigest()}
              disabled={paceDigestLoading || chatBusy}
              className={chatQuickBtnClass}
            >
              {paceDigestLoading ? "Loading…" : "Load pace vs field digest"}
            </button>
            {runIdFromUrl ? (
              <label className="flex items-center gap-2 text-[11px] text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary shrink-0"
                  checked={paceScopeCarOnly}
                  onChange={(e) => setPaceScopeCarOnly(e.target.checked)}
                />
                <span>Limit to this car</span>
              </label>
            ) : null}
          </div>
          <label
            className={cn(
              "flex items-center gap-2 text-[11px] text-foreground cursor-pointer",
              !paceDigest && "opacity-50 cursor-not-allowed"
            )}
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-primary shrink-0"
              checked={includePaceDigestInChat && Boolean(paceDigest)}
              disabled={!paceDigest}
              onChange={(e) => setIncludePaceDigestInChat(e.target.checked)}
            />
            <span>Attach pace vs field digest to chat</span>
          </label>
          {paceDigestErr ? <div className="text-destructive text-[11px]">{paceDigestErr}</div> : null}
          {paceDigest ? (
            <div className="text-[11px] text-muted-foreground leading-snug">
              <span className="text-foreground font-medium">{paceDigest.includedRunCount}</span> run(s) with valid avg
              top 10 vs field mean (scanned {paceDigest.scannedRunCount} with linked timing
              {paceDigest.scope === "car" ? ", this car only" : ""}).
              {paceDigest.omittedAfterCap > 0 ? (
                <span className="text-amber-600 dark:text-amber-500">
                  {" "}
                  {paceDigest.omittedAfterCap} more qualifying run(s) not included (table capped at 48 rows,
                  best-vs-field first).
                </span>
              ) : null}
              {paceDigest.truncatedScan ? (
                <span className="text-amber-600 dark:text-amber-500">
                  {" "}
                  More linked-timing runs exist than were scanned.
                </span>
              ) : null}
              {includePaceDigestInChat ? <> Sent with each chat request while enabled.</> : <> Not sent — enable checkbox to attach.</>}
            </div>
          ) : null}
        </div>

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
          <span className="sm:text-right">Grounds replies in real run ids and dates when enabled.</span>
        </div>

        {(runIdFromUrl && compareRunIdFromUrl) || runIdFromUrl || patternDigest || paceDigest ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-muted/40 px-2.5 py-2 border border-border/60">
            {runIdFromUrl && compareRunIdFromUrl ? (
              <span>
                <span className="text-foreground font-medium">Two runs</span> in URL — Engineer has lap + setup context.
                Structured summary is in Compare &amp; trend below; chat is conversational.
              </span>
            ) : runIdFromUrl ? (
              <span>
                <span className="text-foreground font-medium">Focused run</span> from URL.
              </span>
            ) : null}
            {patternDigest ? (
              <span>
                Trend digest loaded:{" "}
                <span className="text-foreground font-medium">{patternDigest.runs.length}</span> runs
                {includePatternDigestInChat ? (
                  <> — included in chat requests.</>
                ) : (
                  <> — not sent to chat (enable checkbox above).</>
                )}
              </span>
            ) : null}
            {paceDigest ? (
              <span>
                Pace vs field digest:{" "}
                <span className="text-foreground font-medium">{paceDigest.includedRunCount}</span> row(s)
                {includePaceDigestInChat ? <> — included in chat.</> : <> — not sent (enable attach above).</>}
              </span>
            ) : null}
          </div>
        ) : null}

        {includeRunCatalog && catalogBanner ? (
          <div className="rounded-md border border-border/80 bg-muted/25 px-2.5 py-2">
            Catalog in context:{" "}
            <span className="text-foreground font-medium">{catalogBanner.includedRunCount}</span> of{" "}
            <span className="text-foreground font-medium">{catalogBanner.totalRunCount}</span> runs
            {catalogBanner.truncated ? (
              <span className="text-amber-600 dark:text-amber-500">
                {" "}
                ({catalogBanner.omittedCount} not listed — narrow filters in Compare &amp; trend below or name a run id)
              </span>
            ) : null}
            .
          </div>
        ) : null}
        {includeRunCatalog && catalogBannerErr ? (
          <div className="text-destructive">{catalogBannerErr}</div>
        ) : null}
        {!includeRunCatalog ? (
          <div>Catalog off — chat uses summary, URL runs, and tools.</div>
        ) : null}
        <p className="leading-snug">
          You can ask for runs by time (&quot;last weekend&quot;) or teammate name — the Engineer can search and set the
          focused run in the page URL when it finds a match.
        </p>
      </div>
    </div>
  );
}
