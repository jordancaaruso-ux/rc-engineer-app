/**
 * Setup-change links: the Engineer's words about changes it cannot identify, linked to those boxes
 * on the driver's own sheet.
 *
 * Founder, 2026-09-24, on the design he picked: "I think we want to avoid this as much as possible
 * by having every setup sheet understood but in the case that it's not I think this is the best
 * solution." On a sheet the app cannot read yet, the driver data says "2 boxes not shown here"; the
 * driver taps the Engineer's words about them, sees the whole sheet with those boxes ringed, and
 * says what each one is.
 *
 * The link is plain Markdown with a fragment href — `[two changes I can't identify](#sheet-4f9k2m)`
 * — because a model writes Markdown links without being taught the syntax, and a fragment passes
 * the renderer's URL filter untouched. The handle comes from the run's id, so the same run carries
 * the same handle in every turn of a conversation; what it points at (the run, and the run it was
 * compared with) is saved with each answer, so an answer reopened from History still opens the
 * pair it was written about.
 *
 * Shared by the server (driver data, the chat route) and the page (the renderer), so it imports
 * nothing.
 */

/** The two runs a link compares: the run the change came before, and that car's run before it. */
export type SheetLinkTarget = { runId: string; sinceRunId: string };

export type SheetLinks = Record<string, SheetLinkTarget>;

const HANDLE_PREFIX = "sheet-";
const HANDLE_CHARS = 6;
const HANDLE = /^sheet-[a-z0-9]{4,24}$/i;
/** A link's href in a reply: `(#sheet-…)`. */
const HREF_IN_TEXT = /\]\(#(sheet-[a-z0-9]{4,24})\)/gi;

/** `#sheet-4f9k2m` → `sheet-4f9k2m`; null for any other href. */
export function sheetLinkHandleFromHref(href: string | null | undefined): string | null {
  if (!href || !href.startsWith("#")) return null;
  const handle = href.slice(1);
  return HANDLE.test(handle) ? handle : null;
}

/**
 * Give the change before `runId` a link, and return its handle.
 *
 * The handle is the tail of the run's id, lengthened only if two runs in one block would share it:
 * a run id is a cuid, whose tail is random, so six characters almost never collide.
 */
export function addSheetLink(links: Map<string, SheetLinkTarget>, target: SheetLinkTarget): string {
  const id = target.runId.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (let n = HANDLE_CHARS; n <= Math.max(HANDLE_CHARS, id.length); n++) {
    const handle = `${HANDLE_PREFIX}${id.slice(-n)}`;
    const taken = links.get(handle);
    if (!taken || (taken.runId === target.runId && taken.sinceRunId === target.sinceRunId)) {
      links.set(handle, target);
      return handle;
    }
  }
  // Two runs with the same id cannot exist; this is here so the function always returns.
  const handle = `${HANDLE_PREFIX}${id}${links.size}`;
  links.set(handle, target);
  return handle;
}

/** The handles a finished reply actually links to, in the order they first appear. */
export function sheetLinkHandlesIn(reply: string): string[] {
  const seen: string[] = [];
  for (const m of reply.matchAll(HREF_IN_TEXT)) {
    const handle = m[1].toLowerCase();
    if (!seen.includes(handle)) seen.push(handle);
  }
  return seen;
}

/** Only the links a reply used — what is saved with the answer. Empty when it used none. */
export function sheetLinksUsedIn(reply: string, links: SheetLinks | null | undefined): SheetLinks {
  const out: SheetLinks = {};
  if (!links) return out;
  for (const handle of sheetLinkHandlesIn(reply)) {
    const target = links[handle];
    if (target) out[handle] = target;
  }
  return out;
}

/** A saved answer's links, read defensively — metadata is JSON the page did not write. */
export function readSheetLinks(raw: unknown): SheetLinks {
  const out: SheetLinks = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [handle, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!HANDLE.test(handle) || !value || typeof value !== "object") continue;
    const { runId, sinceRunId } = value as Record<string, unknown>;
    if (typeof runId === "string" && runId && typeof sinceRunId === "string" && sinceRunId) {
      out[handle.toLowerCase()] = { runId, sinceRunId };
    }
  }
  return out;
}

/**
 * The words of every sheet link, without the link — for anywhere a reply is shown as plain text
 * (a History preview) or its link could not be opened.
 */
export function stripSheetLinks(text: string): string {
  return text.replace(/\[([^\]\n]*)\]\(#sheet-[a-z0-9]{4,24}\)/gi, "$1");
}

/**
 * A reply still arriving, with the half-written end of a link hidden.
 *
 * Tokens land a few characters at a time, so for a moment the page holds `[two changes I can't
 * identify](#sheet-4f` — Markdown that renders as the raw brackets until the closing bracket
 * arrives. The words show as they come; the brackets and the href wait until the link is whole.
 */
export function hideUnfinishedLink(text: string): string {
  // `[words](#sheet-4f` or `[words](` — the href is still arriving.
  const openHref = /\[([^\]\n]*)\]\([^)\s]*$/.exec(text);
  if (openHref) return text.slice(0, openHref.index) + openHref[1];
  // `[words]` — the href has not started.
  const closedWords = /\[([^\]\n]*)\]$/.exec(text);
  if (closedWords) return text.slice(0, closedWords.index) + closedWords[1];
  // `[words` — still inside the link text.
  const openWords = /\[([^\]\n]*)$/.exec(text);
  if (openWords) return text.slice(0, openWords.index) + openWords[1];
  return text;
}
