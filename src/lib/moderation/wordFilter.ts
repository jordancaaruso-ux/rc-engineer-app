/**
 * The word filter on everything one driver types that another driver reads: team comments, team
 * names, "My name", and the names and notes of shared tracks, layouts, tires, additives, events
 * and chassis (App Store guideline 1.2, 2026-09-26: "a method for filtering objectionable
 * material from being posted").
 *
 * It stops slurs, sexual words and threats. Everyday swearing is left alone on purpose: "the car
 * was shit on power" is a normal thing to say to a teammate, and a filter that refuses it teaches
 * drivers the filter is broken. Whatever gets past it is what Report is for.
 *
 * Whole words only, so "Scunthorpe", "Niger", "Pornic" or "grapeseed" never trip it. Pure and
 * Prisma-free.
 */

export const OBJECTIONABLE_TEXT_ERROR = "Please keep it clean.";

/** Matched as whole words. */
const WORDS = new Set([
  "abo",
  "abos",
  "dyke",
  "dykes",
  "fag",
  "fags",
  "gook",
  "gooks",
  "kike",
  "kikes",
  "kys",
  "paedo",
  "paedos",
  "paki",
  "pakis",
  "pedo",
  "pedos",
  "porn",
  "porno",
  "pornographic",
  "pornography",
  "pornhub",
  "porns",
  "raghead",
  "ragheads",
  "rape",
  "raped",
  "rapes",
  "raping",
  "rapist",
  "rapists",
  "slut",
  "sluts",
  "spic",
  "spics",
  "towelhead",
  "towelheads",
  "trannie",
  "trannies",
  "tranny",
  "wetback",
  "wetbacks",
  "whore",
  "whores",
]);

/** Matched at the start of a word, for the ones that grow endings ("-s", "-ing", "-y"). */
const STEMS = ["cunt", "faggot", "nigga", "nigger", "paedophil", "pedophil"];

/** Matched as whole phrases. */
const PHRASES = ["heil hitler", "kill urself", "kill your self", "kill yourself", "sieg heil"];

/** Digits and symbols people swap in for letters. */
const LOOKALIKES: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "!": "i",
};

/**
 * Lowercase, accents off, lookalikes swapped, and a letter held down three times or more cut to
 * one ("cuuunt"). Doubles stay doubles: English spells with them, and held keys rarely stop at two.
 */
function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[013457@$!]/g, (ch) => LOOKALIKES[ch] ?? ch)
    .replace(/([a-z])\1{2,}/g, "$1");
}

/** The first word or phrase that trips the filter, or null. Returned for tests and logs only. */
export function findObjectionableWord(text: string | null | undefined): string | null {
  if (!text) return null;
  const words = normalize(text).split(/[^a-z]+/).filter(Boolean);
  if (words.length === 0) return null;

  const spaced = ` ${words.join(" ")} `;
  for (const phrase of PHRASES) {
    if (spaced.includes(` ${phrase} `)) return phrase;
  }
  for (const word of words) {
    if (WORDS.has(word)) return word;
    for (const stem of STEMS) {
      if (word.startsWith(stem)) return stem;
    }
  }
  return null;
}

/** For API routes: the error to send back when any of these texts trips the filter, else null. */
export function objectionableTextError(
  ...texts: Array<string | null | undefined>
): string | null {
  return texts.some((t) => findObjectionableWord(t) !== null) ? OBJECTIONABLE_TEXT_ERROR : null;
}
