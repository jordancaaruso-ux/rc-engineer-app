/**
 * Roll-centre direction, made deterministic (founder call, 2026-09-01).
 *
 * The model has twice inverted a roll-centre move while composing an answer (2026-08-29
 * "fewer upper-outer = more bite"; 2026-09-01 "raise the RC with upper-outer removed or
 * upper-inner added" — both moves lower it). The direction data was always right — the net
 * words carry it per key — but the model derives the inverse lookup (RC goal → shim move)
 * from imagined link angles, which upper-link-geometry.md warns is exactly where the sign
 * flips. Two defences, both fed from the net words so nothing is hand-copied:
 *
 *  1. rcMovesBlock() — an explicit goal→move table rendered into the nets block, so the
 *     inverse lookup is a copy, not a derivation.
 *  2. rcGuardCorrections() — a code check over the finished reply; any shim-move/RC-direction
 *     pairing that contradicts the table gets a correction appended before the driver sees
 *     it uncorrected. It also catches a move sized as a roll-centre distance ("raise the RC
 *     by 0.25 mm") — founder ruling: the near-1:1 of the upper links is one chassis's
 *     coincidence; moves are sized in shim millimetres only.
 *
 * Detection is deliberately conservative: a lever's move verb is the NEAREST add/remove word
 * to that shim mention (a compound sentence names several), the roll-centre direction must be
 * unambiguous near the roll-centre mention, and anything unclear stays silent — a false
 * correction under a right answer costs more trust than a miss, and the table on the wire is
 * the first line of defence anyway.
 */

export type RcLever = {
  /** e.g. "upper_outer_shims" — parameter with the axle suffix stripped. */
  base: string;
  /** Driver-facing generic name, e.g. "upper-outer". */
  name: string;
  /** What ADDING shims does to that roll centre. */
  addEffect: "up" | "down";
};

const AXLE_SUFFIX = /_(front|rear|ff|fr|rf|rr)$/;

/**
 * Derive the lever table from loaded net entries — the words lines ("more — roll centre up")
 * are founder-owned and solver-checked, so they are the single source; nothing here is typed
 * by hand. Front and rear always agree today; if they ever disagreed the conflicting base is
 * dropped rather than guessed.
 */
export function rcLeversFromNets(
  entries: Array<{ parameter: string; words?: { more?: string } }>
): RcLever[] {
  const byBase = new Map<string, "up" | "down" | "conflict">();
  for (const e of entries) {
    const m = /roll centre (up|down)/i.exec(e.words?.more ?? "");
    if (!m) continue;
    const base = e.parameter.replace(AXLE_SUFFIX, "");
    const effect = m[1].toLowerCase() as "up" | "down";
    const prev = byBase.get(base);
    if (prev && prev !== effect) byBase.set(base, "conflict");
    else byBase.set(base, effect);
  }
  const levers: RcLever[] = [];
  for (const [base, effect] of [...byBase.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (effect === "conflict") continue;
    levers.push({
      base,
      name: base.replace(/_?shims?_?/g, "_").replace(/^_|_$/g, "").replace(/_/g, "-"),
      addEffect: effect,
    });
  }
  return levers;
}

/** The goal→move table rendered into the nets block. Byte-stable for the cached prefix. */
export function rcMovesBlock(levers: RcLever[]): string {
  if (levers.length === 0) return "";
  const up = levers.map((l) => (l.addEffect === "up" ? `more ${l.name} shims` : `fewer ${l.name} shims`));
  const lines = [
    "ROLL CENTRE MOVES (solver-checked; front and rear alike). Copy these — never derive a shim direction from how the links look:",
    `RC UP: ${up.join(" / ")}. RC DOWN: the reverse of each.`,
    "Size a roll-centre move in SHIM millimetres only. Never say how far the roll centre itself moves — shim millimetres are not roll-centre millimetres, and the ratio changes car to car.",
  ];
  return lines.join("\n");
}

const ADD_WORDS = /\b(add|adds|added|adding|more|extra|install|installing|installed|put)\b/gi;
const REMOVE_WORDS = /\b(remove|removes|removed|removing|fewer|take out|taking out|took out|pull|pulled)\b/gi;
const RC_MENTION = /\broll[-\s]?cent(?:re|er)s?\b|\bRC\b/i;
const RC_UP_WORDS = /\b(raise|raises|raised|raising|higher|up|lift|lifts|lifting)\b/i;
const RC_DOWN_WORDS = /\b(lower|lowers|lowered|lowering|drop|drops|dropping|down)\b/i;

/** "raise/lower the roll centre by 0.25 mm" or "0.25 mm of roll centre". */
const RC_DISTANCE_A =
  /\b(raise|raises|raised|raising|lower|lowers|lowered|lowering|move|moves|moving|drop|drops|lift|lifts)\b[^.!?\n]{0,40}?\broll[-\s]?cent(?:re|er)\b[^.!?\n]{0,20}?\bby\s+\d+(?:\.\d+)?\s*mm\b/i;
const RC_DISTANCE_B = /\b\d+(?:\.\d+)?\s*mm\s+of\s+(?:front\s+|rear\s+)?(?:roll[-\s]?cent(?:re|er)|RC)\b/i;

/** How far a move verb may sit from the shim mention it governs. */
const MOVE_VERB_REACH = 30;

function leverPattern(lever: RcLever): RegExp {
  // upper_outer → /upper[-\s]?outer/i — matches "upper-outer", "upper outer".
  const tokens = lever.name.split("-");
  return new RegExp(tokens.join("[-\\s]?"), "i");
}

/**
 * The move verb governing a shim mention: the nearest add/remove word within reach. A
 * compound sentence names several verbs ("…outer shims removed or inner shims added…"), so
 * presence is not enough — distance decides, and an exact tie stays silent.
 */
function nearestMove(sentence: string, start: number, end: number): "add" | "remove" | null {
  let best: { kind: "add" | "remove"; distance: number } | null = null;
  let tied = false;
  for (const [kind, re] of [
    ["add", ADD_WORDS],
    ["remove", REMOVE_WORDS],
  ] as const) {
    re.lastIndex = 0;
    for (const m of sentence.matchAll(re)) {
      const mStart = m.index ?? 0;
      const mEnd = mStart + m[0].length;
      const distance = mStart >= end ? mStart - end : mEnd <= start ? start - mEnd : 0;
      if (distance > MOVE_VERB_REACH) continue;
      if (!best || distance < best.distance) {
        best = { kind, distance };
        tied = false;
      } else if (distance === best.distance && best.kind !== kind) {
        tied = true;
      }
    }
  }
  return best && !tied ? best.kind : null;
}

function windowAround(text: string, index: number, length: number, radius: number): string {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + length + radius));
}

/**
 * Scan a finished reply; return correction lines (empty when the text is clean). Each line is
 * ready to append verbatim. Deduplicated.
 */
export function rcGuardCorrections(reply: string, levers: RcLever[]): string[] {
  const out = new Set<string>();
  const sentences = reply.split(/(?<=[.!?])\s+|\n+/);

  for (const sentence of sentences) {
    const rcMatch = RC_MENTION.exec(sentence);
    if (!rcMatch) continue;

    // The sentence's roll-centre direction, read close to the RC mention; both directions
    // present (or neither) means unclear — stay silent.
    const rcWindow = windowAround(sentence, rcMatch.index, rcMatch[0].length, 50);
    const rcUp = RC_UP_WORDS.test(rcWindow);
    const rcDown = RC_DOWN_WORDS.test(rcWindow);
    const claimed = rcUp === rcDown ? null : rcUp ? "up" : "down";

    if (claimed) {
      for (const lever of levers) {
        const m = leverPattern(lever).exec(sentence);
        if (!m) continue;
        const move = nearestMove(sentence, m.index, m.index + m[0].length);
        if (!move) continue;
        const expected =
          move === "add" ? lever.addEffect : lever.addEffect === "up" ? "down" : "up";
        if (expected !== claimed) {
          const addWord = lever.addEffect === "up" ? "raises" : "lowers";
          const removeWord = lever.addEffect === "up" ? "lowers" : "raises";
          out.add(
            `Correction — adding ${lever.name} shims ${addWord} that roll centre and removing them ${removeWord} it; a move above states the direction backwards.`
          );
        }
      }
    }

    if (RC_DISTANCE_A.test(sentence) || RC_DISTANCE_B.test(sentence)) {
      out.add(
        "Correction — size that move in shim millimetres, not roll-centre millimetres: how far the roll centre itself moves differs car to car."
      );
    }
  }

  return [...out];
}
