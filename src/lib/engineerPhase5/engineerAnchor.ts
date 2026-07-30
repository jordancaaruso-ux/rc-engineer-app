/**
 * Explicit Engineer anchoring — the wire/URL formats and precedence rules for pinning
 * a run, saved (library) setup, or event as a conversation's subject.
 *
 * Pure module (no prisma, no React) so every rule here is unit-testable:
 * - `parseChatAnchor` — validate the untrusted `anchor` field on the chat request body.
 * - `anchorToRunFocus` — collapse an anchor onto the legacy runId/compareRunId plumbing.
 * - `parseAnchorParam` / `formatAnchorParam` / `formatGeneralAnchorParam` — the `?pin=`
 *   URL channel (`run:<id>`, `general`, `general:<carId>`).
 * - `resolveAnchorRunForRichContext` — the precedence that replaces the old
 *   `runId || latestRun.id` guess in the chat pipeline.
 *
 * Design record: docs/ENGINEER_NORTH_STAR.md (surfaces) + founder interview 2026-07-29 —
 * a pin is a hard subject (the model may not refocus away) with evidence tools left open.
 * Founder interview 2026-07-30 added the general anchor: a theory-only hard subject that
 * must never resolve a run, so answers stop being flavoured by the current setup.
 */

export type EngineerAnchorKind = "run" | "setup" | "event";

/** Run / saved-setup / event subject — the data-backed anchors. */
export type EngineerDataAnchor = {
  kind: EngineerAnchorKind;
  id: string;
  /** kind=run only — second run of a compare pair. */
  compareRunId: string | null;
  /** kind=run only — saved setup tested against the anchored run. */
  setupId: string | null;
  /** true = user pin (hard subject); false = Auto (visible guess, model may refocus). */
  pinned: boolean;
};

/**
 * General-question subject: theory only — no runs, no setup values, no community data
 * may enter the conversation. `carId` scopes theory to one car's identity (name/chassis/
 * platform, never its data); null = pure theory. Always a hard subject, so `pinned` is
 * fixed true.
 */
export type EngineerGeneralAnchor = {
  kind: "general";
  carId: string | null;
  pinned: true;
};

export type EngineerChatAnchor = EngineerDataAnchor | EngineerGeneralAnchor;

const ANCHOR_KINDS: ReadonlySet<string> = new Set(["run", "setup", "event"]);

/** Prisma cuids are url-safe; reject anything that couldn't be one before it reaches a query. */
const ID_RE = /^[A-Za-z0-9_-]{10,64}$/;

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return ID_RE.test(trimmed) ? trimmed : null;
}

/** Validate the untrusted `anchor` field of the chat request body. Null on anything malformed. */
export function parseChatAnchor(raw: unknown): EngineerChatAnchor | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === "general") {
    // Always a hard subject; a malformed carId degrades to pure theory rather than
    // dropping the driver's chosen mode.
    return { kind: "general", carId: cleanId(obj.carId), pinned: true };
  }
  const kind = typeof obj.kind === "string" && ANCHOR_KINDS.has(obj.kind)
    ? (obj.kind as EngineerAnchorKind)
    : null;
  const id = cleanId(obj.id);
  if (!kind || !id) return null;
  // Compare/setup modifiers are run-anchor-only; a setup or event anchor stands alone.
  const compareRunId = kind === "run" ? cleanId(obj.compareRunId) : null;
  const setupId = kind === "run" ? cleanId(obj.setupId) : null;
  return {
    kind,
    id,
    compareRunId: compareRunId === id ? null : compareRunId,
    setupId,
    pinned: obj.pinned === true,
  };
}

/**
 * Collapse an anchor onto the legacy runId/compareRunId channel that the whole pipeline
 * already speaks. The anchor wins over legacy body ids; setup/event anchors carry no
 * focused run pair of their own.
 */
export function anchorToRunFocus(
  anchor: EngineerChatAnchor | null,
  legacy: { runId: string; compareRunId: string }
): { runId: string; compareRunId: string } {
  if (!anchor) return legacy;
  if (anchor.kind === "run") {
    return { runId: anchor.id, compareRunId: anchor.compareRunId ?? "" };
  }
  return { runId: "", compareRunId: "" };
}

/** `?pin=run:<id>` — the pinned URL channel (legacy `?runId=` stays the Auto channel). */
export function formatAnchorParam(kind: EngineerAnchorKind, id: string): string {
  return `${kind}:${id}`;
}

/** `?pin=general` / `?pin=general:<carId>` — the general-question URL channel. */
export function formatGeneralAnchorParam(carId: string | null): string {
  return carId ? `general:${carId}` : "general";
}

export function parseAnchorParam(
  value: string | null | undefined
): { kind: EngineerAnchorKind; id: string } | { kind: "general"; carId: string | null } | null {
  if (!value) return null;
  if (value === "general" || value.startsWith("general:")) {
    // Junk after the colon degrades to pure theory — keep the driver's chosen mode.
    return { kind: "general", carId: cleanId(value.slice("general:".length)) };
  }
  const sep = value.indexOf(":");
  if (sep <= 0) return null;
  const kind = value.slice(0, sep);
  const id = cleanId(value.slice(sep + 1));
  if (!ANCHOR_KINDS.has(kind) || !id) return null;
  return { kind: kind as EngineerAnchorKind, id };
}

/**
 * The precedence that replaces the pipeline's old one-line guess
 * (`runId || latestRun.id`): an explicit run anchor wins; a setup/event anchor supplies
 * its own best related run; only then the account-latest run.
 */
export function resolveAnchorRunForRichContext(input: {
  anchor: EngineerChatAnchor | null;
  /** Effective focused run id after anchorToRunFocus + legacy fallback. */
  focusedRunId: string;
  /** For setup/event anchors: the run the serializer resolved as most related (may be null). */
  anchorDerivedRunId: string | null;
  latestRunId: string | null;
}): string | null {
  // A general anchor NEVER resolves a run — the latest-run fallback is exactly the
  // leak general mode exists to close.
  if (input.anchor?.kind === "general") return null;
  if (input.focusedRunId) return input.focusedRunId;
  if (input.anchor && input.anchor.kind !== "run" && input.anchorDerivedRunId) {
    return input.anchorDerivedRunId;
  }
  return input.latestRunId;
}

/** Shape persisted on EngineerChatThread.focusAnchorJson (v1). */
export type EngineerThreadFocusAnchorV1 = EngineerChatAnchor & {
  version: 1;
  /** Human label frozen at persist time so old threads can render a chip without a lookup. */
  label: string | null;
};

/**
 * Thread focus for a persisted exchange. A user pin is the standing subject and beats
 * whatever the model resolved this turn; without one, the model's resolvedFocus (or the
 * request's run ids) stands, recorded as an Auto anchor so reopening the thread restores it.
 */
export function resolveThreadFocusForPersist(params: {
  anchor: EngineerChatAnchor | null;
  anchorLabel?: string | null;
  resolvedFocus: { runId: string; compareRunId: string | null } | null;
  runId?: string;
  compareRunId?: string;
}): {
  primaryRunId: string | null;
  compareRunId: string | null;
  focusAnchorJson: EngineerThreadFocusAnchorV1 | null;
} {
  const label = params.anchorLabel?.trim().slice(0, 160) || null;
  if (params.anchor?.pinned) {
    const a = params.anchor;
    return {
      primaryRunId: a.kind === "run" ? a.id : null,
      compareRunId: a.kind === "run" ? a.compareRunId : null,
      focusAnchorJson: { ...a, version: 1, label },
    };
  }
  const ids = params.resolvedFocus ?? {
    runId: params.runId?.trim() || null,
    compareRunId: params.compareRunId?.trim() || null,
  };
  return {
    primaryRunId: ids.runId,
    compareRunId: ids.compareRunId,
    focusAnchorJson: ids.runId
      ? {
          version: 1,
          kind: "run",
          id: ids.runId,
          compareRunId: ids.compareRunId ?? null,
          setupId: null,
          pinned: false,
          label,
        }
      : null,
  };
}

export function parseThreadFocusAnchor(raw: unknown): EngineerThreadFocusAnchorV1 | null {
  const anchor = parseChatAnchor(raw);
  if (!anchor) return null;
  const label =
    raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).label === "string"
      ? ((raw as Record<string, unknown>).label as string).slice(0, 160)
      : null;
  return { ...anchor, version: 1, label };
}
