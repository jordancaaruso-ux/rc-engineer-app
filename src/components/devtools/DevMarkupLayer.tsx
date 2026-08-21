"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

/**
 * Dev-only markup layer: drive the real app, tap anything to pin a note on it, or scribble over it.
 *
 * Notes go to `.markup/notes.json` in the checkout (via `api/dev-markup`) so they can be read
 * straight off disk and acted on. This exists because screenshots lose the one thing that matters —
 * which element the complaint is about — and retyping "the third tab on the setup step" every time
 * is how a walkthrough's findings get vague.
 *
 * Deliberately styled to look FOREIGN to the app: slate chrome and a magenta accent, none of the
 * product tokens. It must never be mistaken for shipped UI in a screenshot. That is also why the
 * usual "no raw hex, yellow means actions" rule in CLAUDE.md does not apply here — this is tooling
 * chrome, not product surface.
 *
 * Mounted from the root layout behind a `NODE_ENV` check, and hidden under automation so it can
 * never sit on top of an element a Playwright spec is trying to click.
 */

type Note = {
  id: string;
  createdAt: string;
  route: string;
  kind: "pin" | "draw";
  text: string;
  selector: string | null;
  tag: string | null;
  className: string | null;
  label: string | null;
  x: number;
  y: number;
  vw: number;
  vh: number;
  paths?: string[];
  done?: boolean;
};

type Mode = "note" | "draw";

const ACCENT = "#ff2d95";
const CHROME = "#12151c";
const CHROME_EDGE = "#2a2f3a";
const ON_KEY = "rc_markup_on";

/** Best-effort selector: stop at an id or test id, else walk up building nth-of-type steps. */
function selectorFor(el: Element): string {
  const steps: string[] = [];
  let node: Element | null = el;
  let depth = 0;

  while (node && node !== document.body && depth < 6) {
    const testId = node.getAttribute("data-testid");
    if (testId) {
      steps.unshift(`[data-testid="${testId}"]`);
      return steps.join(" > ");
    }
    if (node.id) {
      steps.unshift(`#${CSS.escape(node.id)}`);
      return steps.join(" > ");
    }

    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = [...parent.children].filter((c) => c.tagName === node!.tagName);
      const index = sameTag.indexOf(node) + 1;
      steps.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
    } else {
      steps.unshift(tag);
    }

    node = parent;
    depth += 1;
  }

  return steps.join(" > ");
}

function labelFor(el: Element): string | null {
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, 90);
}

function newId(): string {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function DevMarkupLayer() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [on, setOn] = useState(false);
  const [mode, setMode] = useState<Mode>("note");
  const [notes, setNotes] = useState<Note[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [draft, setDraft] = useState<Note | null>(null);
  const [strokes, setStrokes] = useState<string[]>([]);
  const drawing = useRef<string | null>(null);
  const captureRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
    try {
      setOn(window.localStorage.getItem(ON_KEY) === "1");
    } catch {
      /* private mode — start off */
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(ON_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [on, mounted]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dev-markup");
      if (!res.ok) return;
      const data = (await res.json()) as { notes?: Note[] };
      setNotes(data.notes ?? []);
    } catch {
      /* dev server restarting — pins reappear on the next load */
    }
  }, []);

  useEffect(() => {
    if (mounted) void load();
  }, [mounted, load]);

  const save = useCallback(async (note: Note) => {
    setNotes((prev) => {
      const at = prev.findIndex((n) => n.id === note.id);
      if (at < 0) return [...prev, note];
      const next = [...prev];
      next[at] = note;
      return next;
    });
    try {
      const res = await fetch("/api/dev-markup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note),
      });
      if (res.ok) {
        const data = (await res.json()) as { notes?: Note[] };
        if (data.notes) setNotes(data.notes);
      }
    } catch {
      /* keep the optimistic copy */
    }
  }, []);

  const remove = useCallback(async (id?: string) => {
    setNotes((prev) => (id ? prev.filter((n) => n.id !== id) : []));
    try {
      await fetch(`/api/dev-markup${id ? `?id=${encodeURIComponent(id)}` : ""}`, {
        method: "DELETE",
      });
    } catch {
      /* ignore */
    }
  }, []);

  const here = useMemo(
    () => notes.filter((n) => n.route === pathname),
    [notes, pathname]
  );

  /** Point the tap at whatever is underneath the capture layer, not the layer itself. */
  const elementUnder = useCallback((clientX: number, clientY: number): Element | null => {
    const layer = captureRef.current;
    const prev = layer?.style.pointerEvents;
    if (layer) layer.style.pointerEvents = "none";
    const el = document.elementFromPoint(clientX, clientY);
    if (layer) layer.style.pointerEvents = prev ?? "auto";
    return el;
  }, []);

  function beginNote(clientX: number, clientY: number) {
    const el = elementUnder(clientX, clientY);
    const pageX = clientX + window.scrollX;
    const pageY = clientY + window.scrollY;

    setDraft({
      id: newId(),
      createdAt: new Date().toISOString(),
      route: pathname,
      kind: "pin",
      text: "",
      selector: el ? selectorFor(el) : null,
      tag: el ? el.tagName.toLowerCase() : null,
      className: el?.getAttribute("class") ?? null,
      label: el ? labelFor(el) : null,
      x: pageX,
      y: pageY,
      vw: window.innerWidth,
      vh: window.innerHeight,
    });
  }

  function onCapturePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (mode === "note") {
      beginNote(e.clientX, e.clientY);
      return;
    }
    drawing.current = `M ${(e.clientX + window.scrollX).toFixed(1)} ${(
      e.clientY + window.scrollY
    ).toFixed(1)}`;
    setStrokes((prev) => [...prev, drawing.current!]);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onCapturePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (mode !== "draw" || !drawing.current) return;
    drawing.current += ` L ${(e.clientX + window.scrollX).toFixed(1)} ${(
      e.clientY + window.scrollY
    ).toFixed(1)}`;
    setStrokes((prev) => {
      const next = [...prev];
      next[next.length - 1] = drawing.current!;
      return next;
    });
  }

  function onCapturePointerUp() {
    drawing.current = null;
  }

  function saveDrawing() {
    if (strokes.length === 0) return;
    setDraft({
      id: newId(),
      createdAt: new Date().toISOString(),
      route: pathname,
      kind: "draw",
      text: "",
      selector: null,
      tag: null,
      className: null,
      label: null,
      x: window.scrollX + 16,
      y: window.scrollY + 16,
      vw: window.innerWidth,
      vh: window.innerHeight,
      paths: strokes,
    });
  }

  if (!mounted) return null;
  // Never sit on top of a control an automated spec is trying to reach.
  if (typeof navigator !== "undefined" && navigator.webdriver) return null;

  const pins = here.filter((n) => n.kind === "pin");
  const drawn = here.filter((n) => n.kind === "draw");

  return createPortal(
    <>
      {/* Saved strokes + the one being drawn, in page coordinates. */}
      <svg
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: `${Math.max(document.body.scrollHeight, window.innerHeight)}px`,
          pointerEvents: "none",
          zIndex: 2147483000,
          overflow: "visible",
        }}
      >
        {drawn.flatMap((n) =>
          (n.paths ?? []).map((d, i) => (
            <path
              key={`${n.id}-${i}`}
              d={d}
              fill="none"
              stroke={ACCENT}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={n.done ? 0.25 : 0.9}
            />
          ))
        )}
        {strokes.map((d, i) => (
          <path
            key={`live-${i}`}
            d={d}
            fill="none"
            stroke={ACCENT}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>

      {/* Numbered pins. Re-anchored to their element when the selector still resolves. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          zIndex: 2147483001,
        }}
      >
        {pins.map((n, i) => {
          let x = n.x;
          let y = n.y;
          if (n.selector) {
            try {
              const el = document.querySelector(n.selector);
              if (el) {
                // Park it on the element's top-right corner, not over its content — these mostly
                // annotate text, and a pin sitting on the words hides the thing being complained
                // about. Clamped so a full-width element keeps its pin on screen.
                const r = el.getBoundingClientRect();
                x = Math.min(r.right + window.scrollX - 4, window.innerWidth - 16);
                y = r.top + window.scrollY + 4;
              }
            } catch {
              /* stale selector — fall back to the stored point */
            }
          }
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => setListOpen(true)}
              title={n.text}
              style={{
                position: "absolute",
                left: `${x - 13}px`,
                top: `${y - 13}px`,
                width: 26,
                height: 26,
                borderRadius: 13,
                border: `2px solid ${n.done ? "#5b6270" : "#fff"}`,
                background: n.done ? "#5b6270" : ACCENT,
                color: "#fff",
                font: "600 12px/1 ui-sans-serif, system-ui, sans-serif",
                boxShadow: "0 1px 6px rgba(0,0,0,.45)",
                pointerEvents: "auto",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {/* Tap/draw capture, only while markup is on and no composer is open. */}
      {on && !draft ? (
        <div
          ref={captureRef}
          onPointerDown={onCapturePointerDown}
          onPointerMove={onCapturePointerMove}
          onPointerUp={onCapturePointerUp}
          onPointerCancel={onCapturePointerUp}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2147483002,
            background: mode === "draw" ? "rgba(255,45,149,.04)" : "transparent",
            touchAction: mode === "draw" ? "none" : "auto",
            cursor: mode === "draw" ? "crosshair" : "copy",
          }}
        />
      ) : null}

      {/* Composer */}
      {draft ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2147483004,
            background: "rgba(0,0,0,.55)",
            display: "flex",
            alignItems: "flex-end",
          }}
          onClick={() => setDraft(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              background: CHROME,
              borderTop: `1px solid ${CHROME_EDGE}`,
              padding: "14px 14px calc(14px + env(safe-area-inset-bottom))",
              color: "#e8eaef",
              font: "400 14px/1.45 ui-sans-serif, system-ui, sans-serif",
            }}
          >
            <div
              style={{
                font: "500 11px/1.4 ui-monospace, Consolas, monospace",
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: ACCENT,
                marginBottom: 8,
              }}
            >
              {draft.kind === "draw" ? "Drawing" : "Note"} on {pathname}
            </div>
            {draft.label ? (
              <div
                style={{
                  font: "400 12px/1.4 ui-monospace, Consolas, monospace",
                  color: "#9aa1ae",
                  marginBottom: 10,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                &lt;{draft.tag}&gt; {draft.label}
              </div>
            ) : null}
            <textarea
              autoFocus
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              placeholder="What's wrong with this?"
              rows={3}
              style={{
                width: "100%",
                background: "#0b0d12",
                color: "#e8eaef",
                border: `1px solid ${CHROME_EDGE}`,
                borderRadius: 8,
                padding: "10px 12px",
                font: "400 15px/1.45 ui-sans-serif, system-ui, sans-serif",
                resize: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                type="button"
                onClick={() => {
                  void save(draft);
                  setDraft(null);
                  setStrokes([]);
                }}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 8,
                  border: "none",
                  background: ACCENT,
                  color: "#fff",
                  font: "600 15px/1 ui-sans-serif, system-ui, sans-serif",
                }}
              >
                Save note
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                style={{
                  minHeight: 44,
                  padding: "0 16px",
                  borderRadius: 8,
                  border: `1px solid ${CHROME_EDGE}`,
                  background: "transparent",
                  color: "#c7ccd6",
                  font: "500 15px/1 ui-sans-serif, system-ui, sans-serif",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Notes list */}
      {listOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2147483004,
            background: "rgba(0,0,0,.55)",
            display: "flex",
            alignItems: "flex-end",
          }}
          onClick={() => setListOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxHeight: "70vh",
              overflowY: "auto",
              background: CHROME,
              borderTop: `1px solid ${CHROME_EDGE}`,
              padding: "14px 14px calc(14px + env(safe-area-inset-bottom))",
              color: "#e8eaef",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  font: "500 11px/1.4 ui-monospace, Consolas, monospace",
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: ACCENT,
                }}
              >
                {notes.length} note{notes.length === 1 ? "" : "s"} total
              </span>
              {notes.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void remove()}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#9aa1ae",
                    font: "500 13px/1 ui-sans-serif, system-ui, sans-serif",
                    padding: "6px 0",
                  }}
                >
                  Clear all
                </button>
              ) : null}
            </div>

            {notes.length === 0 ? (
              <p
                style={{
                  color: "#9aa1ae",
                  font: "400 14px/1.5 ui-sans-serif, system-ui, sans-serif",
                  margin: 0,
                }}
              >
                Nothing pinned yet. Tap anything on the page with Note mode on.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {notes.map((n) => (
                  <li
                    key={n.id}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "10px 0",
                      borderTop: `1px solid ${CHROME_EDGE}`,
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          font: "400 11px/1.4 ui-monospace, Consolas, monospace",
                          color: "#7d838f",
                          marginBottom: 3,
                        }}
                      >
                        {n.route}
                        {n.label ? ` — ${n.label.slice(0, 40)}` : ""}
                      </div>
                      <div
                        style={{
                          font: "400 14px/1.45 ui-sans-serif, system-ui, sans-serif",
                          color: n.done ? "#7d838f" : "#e8eaef",
                          textDecoration: n.done ? "line-through" : "none",
                        }}
                      >
                        {n.text || <em style={{ color: "#7d838f" }}>(no text)</em>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void save({ ...n, done: !n.done })}
                      style={{
                        minHeight: 32,
                        padding: "0 10px",
                        borderRadius: 6,
                        border: `1px solid ${CHROME_EDGE}`,
                        background: "transparent",
                        color: "#c7ccd6",
                        font: "500 12px/1 ui-sans-serif, system-ui, sans-serif",
                      }}
                    >
                      {n.done ? "Undo" : "Done"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(n.id)}
                      style={{
                        minHeight: 32,
                        padding: "0 10px",
                        borderRadius: 6,
                        border: `1px solid ${CHROME_EDGE}`,
                        background: "transparent",
                        color: "#9aa1ae",
                        font: "500 12px/1 ui-sans-serif, system-ui, sans-serif",
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {/* Toolbar / toggle */}
      {on ? (
        <div
          style={{
            position: "fixed",
            left: 8,
            right: 8,
            bottom: "calc(8px + env(safe-area-inset-bottom))",
            zIndex: 2147483003,
            display: "flex",
            gap: 6,
            alignItems: "center",
            background: CHROME,
            border: `1px solid ${CHROME_EDGE}`,
            borderRadius: 12,
            padding: 6,
            boxShadow: "0 6px 24px rgba(0,0,0,.5)",
          }}
        >
          {(["note", "draw"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                minHeight: 44,
                padding: "0 14px",
                borderRadius: 8,
                border: "none",
                background: mode === m ? ACCENT : "transparent",
                color: mode === m ? "#fff" : "#c7ccd6",
                font: "600 14px/1 ui-sans-serif, system-ui, sans-serif",
              }}
            >
              {m === "note" ? "Note" : "Draw"}
            </button>
          ))}

          {mode === "draw" && strokes.length > 0 ? (
            <>
              <button
                type="button"
                onClick={saveDrawing}
                style={{
                  minHeight: 44,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: `1px solid ${ACCENT}`,
                  background: "transparent",
                  color: ACCENT,
                  font: "600 14px/1 ui-sans-serif, system-ui, sans-serif",
                }}
              >
                Keep
              </button>
              <button
                type="button"
                onClick={() => setStrokes([])}
                style={{
                  minHeight: 44,
                  padding: "0 12px",
                  borderRadius: 8,
                  border: `1px solid ${CHROME_EDGE}`,
                  background: "transparent",
                  color: "#c7ccd6",
                  font: "500 14px/1 ui-sans-serif, system-ui, sans-serif",
                }}
              >
                Clear
              </button>
            </>
          ) : null}

          <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={() => setListOpen(true)}
            aria-label={`All notes (${notes.length})`}
            style={{
              minHeight: 44,
              padding: "0 12px",
              borderRadius: 8,
              border: `1px solid ${CHROME_EDGE}`,
              background: "transparent",
              color: "#c7ccd6",
              font: "600 14px/1 ui-sans-serif, system-ui, sans-serif",
            }}
          >
            {notes.length}
          </button>
          <button
            type="button"
            onClick={() => {
              setOn(false);
              setStrokes([]);
            }}
            style={{
              minHeight: 44,
              padding: "0 14px",
              borderRadius: 8,
              border: "none",
              background: "#2a2f3a",
              color: "#e8eaef",
              font: "600 14px/1 ui-sans-serif, system-ui, sans-serif",
            }}
          >
            Done
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOn(true)}
          aria-label="Markup mode"
          style={{
            position: "fixed",
            left: 10,
            bottom: "calc(10px + env(safe-area-inset-bottom))",
            zIndex: 2147483003,
            width: 40,
            height: 40,
            borderRadius: 20,
            border: `1px solid ${CHROME_EDGE}`,
            background: CHROME,
            color: ACCENT,
            font: "600 16px/1 ui-sans-serif, system-ui, sans-serif",
            opacity: 0.75,
            boxShadow: "0 2px 10px rgba(0,0,0,.4)",
          }}
        >
          ✎
          {here.length > 0 ? (
            <span
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                minWidth: 16,
                height: 16,
                borderRadius: 8,
                background: ACCENT,
                color: "#fff",
                font: "600 10px/16px ui-sans-serif, system-ui, sans-serif",
                padding: "0 4px",
              }}
            >
              {here.length}
            </span>
          ) : null}
        </button>
      )}
    </>,
    document.body
  );
}
