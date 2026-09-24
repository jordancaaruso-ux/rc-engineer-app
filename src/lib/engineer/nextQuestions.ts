/**
 * Follow-up buttons (founder, 2026-09-24): "if we give like a pretty quick single safe change, still
 * some things that are a little interesting, but then say you know what are some other options I
 * could try, what about this". The Engineer ends a reply with one line — `[[next: … | … | …]]`, the
 * two or three things this driver would most likely ask next — and the app shows them as buttons
 * under the answer, beside its own "Other options" button, sending the one tapped as the driver's
 * next message. The line itself never reaches the driver: it is cut out of the reply, and held
 * back from the live stream as it arrives.
 *
 * Why the app adds "Other options" itself: in the trial the Engineer offered one on only 2 of 6
 * answers, and the short first answer depends on the rest being one tap away.
 */

/** The app's own button, on every answer that isn't itself the other options. */
export const OTHER_OPTIONS_LABEL = "Other options";
/** What that button sends — the founder's words. */
export const OTHER_OPTIONS_QUESTION = "What are some other options I could try?";

/** The prompt asks for two or three; more are dropped rather than crowding a phone. */
export const NEXT_QUESTIONS_MAX = 3;
/** A button is a few words. Anything this long is the model writing prose into the line. */
export const NEXT_QUESTION_MAX_CHARS = 80;

const MARKER_OPEN = "[[next:";
const MARKER = /\[\[next:([^\]]*)\]\]/i;

/** Cut the `[[next: …]]` line out of a finished reply; the questions come back beside the text. */
export function splitNextQuestions(reply: string): { text: string; nextQuestions: string[] } {
  const m = MARKER.exec(reply);
  if (!m) {
    // An unclosed marker (the model stopped mid-line) is dropped, never shown.
    const open = reply.toLowerCase().lastIndexOf(MARKER_OPEN);
    return { text: (open >= 0 ? reply.slice(0, open) : reply).trim(), nextQuestions: [] };
  }
  const seen = new Set<string>([OTHER_OPTIONS_LABEL.toLowerCase(), OTHER_OPTIONS_QUESTION.toLowerCase()]);
  const nextQuestions: string[] = [];
  for (const part of m[1].split("|")) {
    const q = part.replace(/\s+/g, " ").trim();
    const key = q.toLowerCase();
    if (!q || q.length > NEXT_QUESTION_MAX_CHARS || seen.has(key)) continue;
    seen.add(key);
    nextQuestions.push(q);
    if (nextQuestions.length === NEXT_QUESTIONS_MAX) break;
  }
  const text = (reply.slice(0, m.index) + reply.slice(m.index + m[0].length)).replace(/\n{3,}/g, "\n\n").trim();
  return { text, nextQuestions };
}

/**
 * A token sink that never shows the marker: text streams through until `[[next:` begins, and
 * everything from there on is held back. A tail that could still turn into the marker ("[", "[[n")
 * waits for the next token before it is released. `flush()` releases a held tail that never became
 * the marker, once the stream has ended.
 */
export function holdBackNextQuestions(onToken: (text: string) => void): {
  push: (text: string) => void;
  flush: () => void;
} {
  let pending = "";
  let cut = false;
  return {
    push(text) {
      if (cut || !text) return;
      pending += text;
      const lower = pending.toLowerCase();
      const at = lower.indexOf(MARKER_OPEN);
      if (at >= 0) {
        if (at > 0) onToken(pending.slice(0, at));
        pending = "";
        cut = true;
        return;
      }
      let keep = 0;
      for (let k = Math.min(MARKER_OPEN.length - 1, lower.length); k > 0; k--) {
        if (MARKER_OPEN.startsWith(lower.slice(-k))) {
          keep = k;
          break;
        }
      }
      const release = pending.slice(0, pending.length - keep);
      if (release) onToken(release);
      pending = pending.slice(pending.length - keep);
    },
    flush() {
      if (!cut && pending) onToken(pending);
      pending = "";
    },
  };
}
