/**
 * The debrief box writes dot points: every line is a point, and the box puts the dot there.
 * Founder call 2026-09-19 — one empty notes box "looks a bit cheap", and three short points read
 * better than a blob.
 *
 * It is still ONE plain-text note underneath ("• " at the start of each line), so saving, the
 * draft memory and the Engineer's later read of it are all unchanged. Everything here is pure so
 * the box's behaviour can be tested without a browser.
 */

export const BULLET = "• ";

/** A line with its dot (and any dash or star typed by hand in an older note) taken off. */
function lineBody(line: string): string {
  return line.replace(/^\s*[•\-*]\s*/, "").trim();
}

/**
 * What the box opens with: a dot on every line that says something. Notes written before the
 * dots existed get them here, on the way in — the stored note only changes when it is next edited.
 */
export function withBullets(text: string): string {
  return text
    .split("\n")
    .map(lineBody)
    .filter((body) => body !== "")
    .map((body) => BULLET + body)
    .join("\n");
}

/** What is saved: the box's text without the dots nobody wrote beside. An untouched box is "". */
export function cleanBullets(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => lineBody(line) !== "")
    .join("\n")
    .trim();
}

export type BoxEdit = { value: string; caret: number };

/**
 * Put right what the keyboard just did, given the box AFTER the edit. Works off the input event
 * (not keydown) because that is the one thing a phone keyboard, a paste and dictation all raise.
 *
 * - Return starts a new point. Return on a point with nothing in it does nothing, so empty dots
 *   never stack up.
 * - Backspace over a dot joins the point to the one above — what the same key does in Notes.
 * - Anything else that leaves a line without its dot (a paste, typing at the very start) gets
 *   the dot back, and the caret stays on the letter it was on.
 */
export function applyBulletEdit(value: string, caret: number, inputType: string): BoxEdit {
  if (value === "") return { value, caret };

  if (inputType === "insertLineBreak" || inputType === "insertParagraph") {
    if (caret > 0 && value[caret - 1] === "\n") {
      const prevStart = value.lastIndexOf("\n", caret - 2) + 1;
      const prevLine = value.slice(prevStart, caret - 1);
      const nextBreak = value.indexOf("\n", caret);
      const restOfLine = value.slice(caret, nextBreak === -1 ? value.length : nextBreak);
      if (lineBody(prevLine) === "" && restOfLine.trim() === "") {
        value = value.slice(0, caret - 1) + value.slice(caret);
        caret -= 1;
      }
    }
  } else if (inputType === "deleteContentBackward") {
    const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
    const dotEaten = value[lineStart] === "•" && value[lineStart + 1] !== " ";
    if (dotEaten && caret === lineStart + 1) {
      if (lineStart > 0) {
        // Join to the point above: the break and the dot both go.
        value = value.slice(0, lineStart - 1) + value.slice(lineStart + 1);
        caret = lineStart - 1;
      } else if (value === "•" || value.startsWith("•\n")) {
        // The first point, with nothing in it.
        value = value.slice(value === "•" ? 1 : 2);
        caret = 0;
      }
    }
  } else if (inputType === "deleteContentForward") {
    // Delete at the end of a point pulls the next one up; its dot is now mid-line.
    if (caret > 0 && value[caret - 1] !== "\n" && value.startsWith(BULLET, caret)) {
      value = value.slice(0, caret) + value.slice(caret + BULLET.length);
    }
  }

  if (value === "") return { value, caret };

  let out = "";
  let nextCaret = caret;
  let lineStart = 0;
  for (const line of value.split("\n")) {
    if (lineStart > 0) out += "\n";
    if (line.startsWith(BULLET)) {
      out += line;
    } else if (line.startsWith("•")) {
      out += BULLET + line.slice(1);
      if (lineStart + 1 <= caret) nextCaret += 1;
    } else {
      out += BULLET + line;
      if (lineStart <= caret) nextCaret += BULLET.length;
    }
    lineStart += line.length + 1;
  }
  return { value: out, caret: nextCaret };
}
