// lb-v2. Which Condition values mean "this is a slab in a case", and therefore
// has no binder pocket and is owed no sticker.
//
// One list, read by the slot pool on the server and by the singles page's
// raw/graded split in the browser, because the two disagreeing IS the bug this
// was written for. 37 slabs entered on 2026-09-26 were handed pockets 853 to
// 889 by a pool that thought they were sleeved cards, while the page filed them
// under graded and hid them from the raw view. The binder looked like it skipped
// from 852 to 890, and the never-printed count sat at 37 forever: labels owed
// for stickers with nowhere to stick them.
//
// Its own file, with no imports, because lib/slots pulls in the Airtable client
// and this has to be readable from a client component too.
//
// "Other" is here because the singles page has always counted it as graded. It
// is the odd one out and worth tidying, but a slot rule that contradicts the
// view in front of you is worse than one that inherits its quirk.
//
// sl-v3. The list used to stop at PSA 8, CGC 9.5, BGS 9.5 and CGC 10, which was
// fine while every slab in the collection was a gem-mint modern card. A real
// slabs export broke it: 13 of 82 rows came in at PSA 7, 6, 5, 2 and 1, plus
// CGC 9 and BGS 9, none of which this list knew. isSlab said false for every
// one of them, which would have handed a PSA 1 Mew EX a binder pocket and let
// the raw TCGplayer rotation price it off NM market. Low grades are the ones
// where that is most wrong - a PSA 1 is a fraction of NM, not a multiple.
//
// So the ladder is complete now, 1 through 10, for every grader that actually
// appears. Keep it in sync with the Condition single select in Airtable: a
// value this list knows but the select rejects cannot be saved, and a value the
// select accepts but this list does not know gets treated as a raw card.
export const SLAB_CONDITIONS = [
  "PSA 10", "PSA 9", "PSA 8", "PSA 7", "PSA 6", "PSA 5", "PSA 4", "PSA 3", "PSA 2", "PSA 1",
  "BGS 10", "BGS 9.5", "BGS 9",
  "CGC 10", "CGC 9.5", "CGC 9",
  "SGC 10", "SGC 9.5", "SGC 9",
  "Other Graded", "Other",
];

export function isSlab(condition: string | null | undefined): boolean {
  return SLAB_CONDITIONS.includes(String(condition ?? "").trim());
}

/** The raw conditions, for telling the two halves apart in a client component
 *  without importing the server-side pricing module. Mirrors RAW_CONDITIONS in
 *  lib/comp, which is derived from the condition multipliers there. */
export const RAW_LADDER = ["NM", "LP", "MP", "HP", "DM", "Raw"];

/** Turn a grade as a grading company or an export writes it into the short form
 *  this app stores.
 *
 *  Collectr exports the full label - "PSA 10.0 GEM - MT", "CGC 9.5 Mint+",
 *  "BGS 9.0 Mint", "PSA 1.0 PR" - and PSA's own site writes it differently
 *  again. Storing those verbatim is what put 13 cards outside isSlab, and it
 *  would also have split one grade across several Condition options, so a PSA 10
 *  entered by hand and a PSA 10 imported would have sorted as different things.
 *
 *  The rules, in order:
 *    "PSA 10.0 GEM - MT"  -> "PSA 10"     adjectival suffix dropped
 *    "CGC 9.5 Mint+"      -> "CGC 9.5"    half grades kept, they are real
 *    "BGS 9.0 Mint"       -> "BGS 9"      a trailing .0 is noise
 *    "NM"                 -> "NM"         raw conditions pass through
 *    "PSA 10 (OC)"        -> "PSA 10"     qualifiers are not part of the grade
 *
 *  Returns the input trimmed when nothing matches, so an unrecognised value is
 *  visible in the data rather than silently blanked. */
export function normalizeGrade(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  // Raw first and by exact match. "Raw" and the played ladder are not grades
  // and must never be rewritten.
  const exactRaw = RAW_LADDER.find((c) => c.toLowerCase() === s.toLowerCase());
  if (exactRaw) return exactRaw;

  const m = /^(PSA|BGS|CGC|SGC)\s*([0-9]{1,2})(?:\.([05]))?\b/i.exec(s);
  if (!m) {
    // "Other Graded" and "Other" are the two slab values that carry no number.
    const other = ["Other Graded", "Other"].find((c) => c.toLowerCase() === s.toLowerCase());
    return other || s;
  }
  const grader = m[1].toUpperCase();
  const whole = String(parseInt(m[2], 10));
  // Only .5 survives. A trailing .0 is how the full label writes a whole grade
  // and carries no information; anything else is not a grade this hobby uses.
  const half = m[3] === "5" ? ".5" : "";
  return `${grader} ${whole}${half}`;
}

/** Does this grade, once normalised, mean a slab? Use this on anything coming
 *  from outside the app - an import, a pasted export, a form - and isSlab on
 *  values already stored. */
export function isSlabGrade(raw: string | null | undefined): boolean {
  return isSlab(normalizeGrade(raw));
}
