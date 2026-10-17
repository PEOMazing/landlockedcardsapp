// si-v1. Everything the slab form needs, as pure functions.
//
// One place so the preview endpoint and the create endpoint cannot drift: the
// number shown next to the Add button and the number written to Airtable come
// from the same call. That mattered enough to be worth a module - a form that
// previews $9,000 and saves $2,500 is worse than one that previews nothing.

import type { SaleRow } from "./gradedSales";
import { parseSoldPaste } from "./soldPaste";
import { isSlabGrade, normalizeGrade, SLAB_CONDITIONS } from "./slab";
import {
  parseSlabGrade,
  slabComp,
  slabCompSource,
  type PeerMove,
  type SlabCompResult,
  type SlabGrade,
} from "./slabComp";

/** The graders the form offers, in the order they appear on the tray. */
export const GRADERS = ["PSA", "BGS", "CGC", "SGC"] as const;

/** Which grades the dropdown offers for each grader.
 *
 *  DERIVED from SLAB_CONDITIONS rather than written out, and that is the whole
 *  design. A hand-maintained second list drifts: the first cut of this offered
 *  BGS 8.5, 8 and 7, none of which the Condition column can store, so the form
 *  would have let somebody pick a grade and then failed on save. That is the
 *  same shape as the bug where PSA 7 was unstorable for a month while slabs
 *  carrying it sat in the collection.
 *
 *  One vocabulary, one source. Add a grade to SLAB_CONDITIONS and to the
 *  Airtable select, and it appears here on its own.
 *
 *  Sorted high to low, because that is the order a tray is read in. */
export const GRADES_BY_GRADER: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const g of GRADERS) out[g] = [];
  for (const c of SLAB_CONDITIONS) {
    const p = parseSlabGrade(c);
    if (p && out[p.grader]) out[p.grader].push(p.grade);
  }
  for (const g of GRADERS) out[g].sort((a, b) => parseFloat(b) - parseFloat(a));
  return out;
})();

/** The Condition value for a grader and grade, or null if that pairing is not
 *  one we store. Checked against lib/slab's vocabulary rather than assumed, so
 *  the form can never write a Condition the rest of the app cannot read. */
export function conditionFor(grader: string, grade: string): string | null {
  const c = normalizeGrade(`${String(grader || "").toUpperCase()} ${String(grade || "").trim()}`);
  return isSlabGrade(c) ? c : null;
}

/** The TCGplayer product id out of a pasted URL.
 *
 *  Accepts what actually lands on a clipboard: the full product page, the
 *  shortened share link, a bare id, and anything with the tracking rubbish
 *  TCGplayer appends. Returns null rather than guessing, because a wrong
 *  product id silently attaches the wrong card to a slab. */
export function tcgProductIdFromUrl(input: string): number | null {
  const s = String(input || "").trim();
  if (!s) return null;
  if (/^\d{3,9}$/.test(s)) return parseInt(s, 10);
  const m =
    /tcgplayer\.com\/(?:[a-z-]+\/)*product\/(\d+)/i.exec(s) ||
    /[?&]productId=(\d+)/i.exec(s) ||
    /\/product\/(\d+)/.exec(s);
  return m ? parseInt(m[1], 10) : null;
}

/** Is this a link we are willing to store as comp provenance?
 *
 *  Allow-listed rather than "any http", because this string is rendered as a
 *  clickable link on the label page that a customer can reach. */
export function isSoldLink(input: string): boolean {
  const s = String(input || "").trim();
  if (!s) return false;
  return /^https:\/\/(www\.)?(130point\.com|ebay\.[a-z.]{2,6}|pricecharting\.com|psacard\.com)\//i.test(s);
}

export type SlabQuote = {
  ok: boolean;
  /** The comp, whole dollars. Null when the paste held nothing usable. */
  price: number | null;
  /** How it was arrived at, ready for the Comp Source column. */
  source: string;
  /** Every sale parsed, newest first, so the form can show the working. */
  parsed: SaleRow[];
  result: SlabCompResult | null;
  grade: SlabGrade | null;
  /** Plain-language problems to put in front of the person, not exceptions. */
  notes: string[];
};

/** Turn a grade and a pasted block of sold rows into a comp.
 *
 *  Runs the real engine, not a simplified version of it: step detection, the
 *  lone-high guard, the ask-is-not-a-price filter and the low-outlier floor
 *  all apply here exactly as they do on a recomp. A card added through this
 *  form and the same card repriced tomorrow go down one code path. */
export function quoteSlab(
  grader: string,
  grade: string,
  paste: string,
  opts: { now?: Date; peerMove?: PeerMove } = {},
): SlabQuote {
  const now = opts.now || new Date();
  const notes: string[] = [];
  const condition = conditionFor(grader, grade);
  const g = condition ? parseSlabGrade(condition) : null;

  if (!g) {
    return {
      ok: false, price: null, source: "", parsed: [], result: null, grade: null,
      notes: [`${grader} ${grade} is not a grade this app stores.`],
    };
  }

  const { sales, skipped } = parseSoldPaste(paste, now);
  if (skipped > 0) notes.push(`${skipped} row${skipped === 1 ? "" : "s"} had a price but no readable date and were ignored.`);

  if (sales.length === 0) {
    return {
      ok: false, price: null, source: "", parsed: [], result: null, grade: g,
      notes: [...notes, "No sales found in that paste. Select the sold results, including their dates, and paste again."],
    };
  }

  const result = slabComp(sales, now, { peerMove: opts.peerMove });
  if (!result) {
    return {
      ok: false, price: null, source: "", parsed: sales, result: null, grade: g,
      notes: [...notes, "Every row was a negotiated sale with no published price, so there is nothing to comp from."],
    };
  }

  // The warnings worth saying out loud on the way in, while the person is
  // still holding the card and can go and find more sales.
  if (result.used.length < 3) {
    notes.push(`Thin: ${result.used.length} sale${result.used.length === 1 ? "" : "s"} behind this price.`);
  }
  if (result.stale) notes.push(`Nothing sold in the last 30 days; newest is ${result.asOf}.`);
  if (result.step) {
    notes.push(`Repriced ${result.step.direction} ${result.step.gap}x: older sales around $${result.step.from.toLocaleString("en-US")} were not counted.`);
  }
  if (result.demoted) {
    notes.push(`One sale at $${result.demoted.claimed.toLocaleString("en-US")} was set aside as unconfirmed.`);
  }
  if (result.askOnly.length > 0) {
    notes.push(`${result.askOnly.length} negotiated sale${result.askOnly.length === 1 ? "" : "s"} excluded: the price was not published.`);
  }

  return {
    ok: true,
    price: result.price,
    source: slabCompSource(g, result),
    parsed: sales,
    result,
    grade: g,
    notes,
  };
}
