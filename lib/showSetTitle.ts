// Titles for the list that gets pasted into Whatnot.
//
// WHY THIS IS NOT JUST THE LINE NAME.
//
// Whatnot sent a policy violation for a show set whose listings carried no
// condition. The app was not at fault in the obvious way: all 245 singles
// lines it has ever written carry the condition at the front. What the sale
// report showed is that the condition was lost between the app and the
// listing. The same card, at three stages:
//
//   card in Airtable   Eevee - 200 (Cosmos Holo), NM, slot 368
//   app's line         1x [0368] NM Eevee - 200 (Cosmos Holo) #SVP 200 SV: ...
//   what Whatnot sold  INSANE HEAT - GREAT ODDS!!! - [0368] EEVEE - 200 COSMOS HOLO #SVP 200
//
// The name was uppercased, the parentheses went, the set name went, and so did
// the NM. On that one show, 44 card listings, 0 with a condition in the title.
//
// Two things in that report say how to beat it. The square bracket came
// through verbatim on all 44, and emoji came through intact on the 33 that had
// them, including the full set name on those lines. So whatever is rewriting
// the middle of the title leaves bracketed text and emoji alone.
//
// Hence the shape: the condition rides INSIDE the bracket that already carries
// the binder slot. The slot still leads, so packing is unchanged, and the
// condition sits in the one part of the string that is known to survive.

/** The mark that goes on a hit. One symbol, on the hits only, which is the
 *  rule the CSV export already follows and the reason it reads at a glance. */
export const HIT_MARK = "\u{1F525}";

/** Sealed product has a condition too, as far as Whatnot is concerned. */
export const SEALED_CONDITION = "Sealed";

export type TitleParts = {
  /** Binder pocket. Leads the bracket so a hit still says which sleeve to open. */
  slot?: number | null;
  /** NM, LP, PSA 10 and so on. Blank on sealed, where SEALED_CONDITION is used. */
  condition?: string | null;
  /** Card name, or the product name for sealed. */
  name: string;
  /** Printed collector number, singles only. */
  cardNumber?: string | null;
  /** True for sealed product, which has no slot and no graded condition. */
  sealed?: boolean;
};

const pad = (n: number) => String(n).padStart(4, "0");

/** The bracket at the front: slot and condition, whichever of them exist.
 *
 *  Never empty on a card we know the condition of, because an empty bracket is
 *  the failure this whole file exists to prevent. */
export function leadBracket(parts: TitleParts): string {
  const bits: string[] = [];
  if (parts.slot && Number(parts.slot) > 0) bits.push(pad(Number(parts.slot)));
  const cond = String(parts.condition || "").trim() || (parts.sealed ? SEALED_CONDITION : "");
  if (cond) bits.push(cond);
  return bits.length ? `[${bits.join(" ")}]` : "";
}

/** One listing title, without the quantity or the hit mark. */
export function whatnotTitle(parts: TitleParts): string {
  const name = String(parts.name || "").trim();
  const num = String(parts.cardNumber || "").trim();
  return [leadBracket(parts), name, num ? `#${num}` : ""].filter(Boolean).join(" ");
}

/** The whole pasted line: quantity, the hit mark wrapped around the title, the
 *  title itself.
 *
 *  Wrapped rather than prefixed because that is the shape that survived in the
 *  live report: every emoji-wrapped listing came through with its full text,
 *  including the set names that the bare titles lost. */
export function whatnotLine(parts: TitleParts & { qty: number; isHit?: boolean }): string {
  const title = whatnotTitle(parts);
  const body = parts.isHit ? `${HIT_MARK}${title}${HIT_MARK}` : title;
  return `${Math.max(1, Math.floor(Number(parts.qty) || 1))}x ${body}`;
}

/** What goes in the CSV's description column, which Whatnot also reads.
 *
 *  The set name moved here out of the title: it was being stripped there
 *  anyway, and it is the one piece Whatnot wants that does not have to be in
 *  the title. Brand is spelled out because "Brand/Manufacturer where relevant"
 *  is on the same policy line as the condition. */
export function whatnotDescription(setName?: string | null, brand = "Pokemon"): string {
  return [brand, String(setName || "").trim()].filter(Boolean).join(" - ");
}

// The vocabulary a condition can be, longest first so "PSA 10" is not read as
// "PSA 1". Used to find a condition already embedded in an old line's text,
// for cards whose record no longer says.
const CONDITIONS = [
  "Other Graded", "BGS 9.5", "CGC 9.5", "PSA 10", "CGC 10", "PSA 9", "PSA 8",
  "Sealed", "Raw", "Other", "NM", "LP", "MP", "HP", "DM",
];

/** Pull a condition out of a line of text, or null.
 *
 *  The fallback for a line whose card has been deleted or has lost its
 *  Condition: the text written when it went on the set still has it, and a
 *  condition from there beats no condition at all. */
export function conditionInText(s: unknown): string | null {
  const t = ` ${String(s || "")} `;
  for (const c of CONDITIONS) {
    if (new RegExp(`[\\s\\[]${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\]]`, "i").test(t)) return c;
  }
  return null;
}

/** Lines whose title would go out with no condition on it.
 *
 *  Shown on the stream page before the set is pasted, because finding this out
 *  from a policy violation two days later is the expensive way. */
export function missingCondition<T extends { exportTitle?: string }>(lines: T[]): T[] {
  return lines.filter((l) => !conditionInText(l.exportTitle));
}
