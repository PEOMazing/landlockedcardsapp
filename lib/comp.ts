import { AtRecord } from "./airtable";
import {
  conditionSoldComp,
  getTcgcsvCard,
  makeCardId,
  parseCardId,
  resolveSingleToTcg,
  subTypeForVariant,
} from "./tcgcsvCards";
import { getCard } from "./pokemon";
import { conditionFloor } from "./tcgListings";

// One place that decides what a single is worth, so the per-card button, the
// bulk refresh and the nightly job cannot drift apart.
//
// Order of preference, every step condition-specific until the last:
//   1. median of recent TCGplayer sales in this exact condition
//   2. lowest live listing for this exact printing AND condition
//   3. mirror market for the printing, times a flat condition discount
//
// Steps 1 and 2 describe the card we actually hold. Step 3 does not - the
// mirror has no condition dimension at all - so it is a labelled placeholder,
// never a price to trade on. How wrong step 3 gets, measured 2026-09-17:
//
//   Charizard G Lv.X SV #143, LP: step 3 gives $450.72 x 0.9 = $405.65.
//   The actual LP floor is $250.00 and the DM floor is $49.99.
//
// Which is the whole argument for doing 1 and 2 first.

// Rough condition discounts off the NM market. Only used when a condition has
// no recent sales of its own, which is common on old sets.
const CONDITION_MULT: Record<string, number> = { NM: 1, Raw: 1, LP: 0.9, MP: 0.8, HP: 0.65, DM: 0.5 };

export const isRawCondition = (c: string) => CONDITION_MULT[String(c || "Raw")] !== undefined;

// The same set, for building Airtable filter formulas. Derived from
// CONDITION_MULT so the query and the guard can never disagree about which
// conditions the pipeline can actually price.
export const RAW_CONDITIONS = Object.keys(CONDITION_MULT);

// The singles table shows its amber "unverified comp" warning when the source
// string contains "est.", so a fallback comp MUST say so. Built here rather
// than inline so the contract can be tested instead of hoped for.
export const EST_MARKER = "est.";

export function fallbackCompSource(variant: string, mult: number, cond: string): string {
  return `${EST_MARKER} from TCGplayer market${variant ? ` (${variant})` : ""}${mult === 1 ? "" : ` x${mult} for ${cond}`}`;
}

export type CompResult = {
  ok: boolean;
  reason?: string;
  fields?: Record<string, any>;
  comp?: number;
  before?: number | null;
  linked?: boolean;    // true when this run had to find and store the card id
  estimated?: boolean; // comp came from market x a condition guess, not real sales
  needsReview?: boolean; // an estimate that moved the price far enough to check by hand
};

// How far an ESTIMATED comp may move an existing one before it gets called out.
// Real sales can move a price this much legitimately and are left alone; a
// guess that doubles a card is a different thing. The estimate still gets
// written, because a fresh flagged number beats a frozen unflagged one, but it
// does not get to move quietly.
const REVIEW_SWING = 0.5;

// Resolve the card id, filling it in when the record has none. Export-imported
// singles arrive with a set name and a card number but no id, which is why
// nothing could ever reprice them.
async function ensureCardId(rec: AtRecord): Promise<{ cardId: string; linked: boolean } | null> {
  const existing = String(rec.fields["Card ID"] || "").trim();
  if (existing) {
    // An old three-part id has no printing on it, so a Reverse copy would be
    // priced as a Holofoil. Upgrade it in place from the Variant column.
    const p = parseCardId(existing);
    if (p && !p.sub) {
      const sub = subTypeForVariant(String(rec.fields["Variant"] || ""), String(rec.fields["Rarity"] || ""));
      return { cardId: makeCardId(p.productId, p.groupId, sub), linked: true };
    }
    return { cardId: existing, linked: false };
  }
  const found = await resolveSingleToTcg({
    setName: String(rec.fields["Set Name"] || ""),
    number: String(rec.fields["Card Number"] || ""),
    name: String(rec.fields["Card Name"] || ""),
    variant: String(rec.fields["Variant"] || ""),
    rarity: String(rec.fields["Rarity"] || ""),
  });
  return found ? { cardId: found.cardId, linked: true } : null;
}

export type RecompOpts = {
  /** Skip the listings cache. For the moments a price is acted on - a sticker
   *  scanned at the table, a card going onto a stream - where "live" has to
   *  actually mean live. The background rotation leaves this off. */
  live?: boolean;
};

export async function recompSingle(rec: AtRecord, opts: RecompOpts = {}): Promise<CompResult> {
  const cond = String(rec.fields["Condition"] || "Raw");
  const mult = CONDITION_MULT[cond];
  if (mult === undefined) {
    return { ok: false, reason: "graded comps are manual - no free feed covers graded pricing" };
  }

  const link = await ensureCardId(rec);
  if (!link) {
    return { ok: false, reason: "could not match this card on TCGplayer - set the comp by hand" };
  }
  const { cardId, linked } = link;

  const before = rec.fields["Comp"] ?? null;
  const fields: Record<string, any> = {};
  if (linked) fields["Card ID"] = cardId;

  const parsed = parseCardId(cardId);
  const card = parsed ? await getTcgcsvCard(cardId) : await getCard(cardId);

  // The printing we hold, which decides which listings are even relevant.
  const printing = subTypeForVariant(
    String(rec.fields["Variant"] || ""),
    String(rec.fields["Rarity"] || "")
  );

  // Both condition-specific lookups run together: the floor is wanted for
  // display whether or not it ends up being the comp.
  const [sold, floor] = await Promise.all([
    parsed ? conditionSoldComp(parsed.productId, cond) : Promise.resolve(null),
    parsed ? conditionFloor(parsed.productId, printing, cond, opts.live === true) : Promise.resolve(null),
  ]);

  // The lowest live listing for this exact printing and condition - the number
  // you see on TCGplayer after picking the condition. Stored whatever the comp
  // ends up being, because it is the figure to sanity-check a price against.
  if (floor) {
    fields["Market"] = floor.low;
    fields["Market Basis"] = `${printing} ${cond}, low of ${floor.count} listing${floor.count === 1 ? "" : "s"}`;
  }

  let estimated = false;
  if (sold) {
    fields["Comp"] = sold.price;
    fields["Comp Source"] = `TCGplayer solds (${cond}, median of ${sold.sales})`;
    fields["Comp Detail"] = JSON.stringify(sold.detail);
  } else if (floor) {
    // No recent sales, but real listings in our condition. Asking prices run
    // above what things sell for, so this is a ceiling rather than a comp;
    // still far better than a condition-blind number times a guess.
    fields["Comp"] = floor.low;
    fields["Comp Source"] = `TCGplayer lowest ${cond} listing (${printing}, ${floor.count} live)`;
    fields["Comp Detail"] = "";
  } else if (card && card.market !== null) {
    // The word "est." is load-bearing: the singles table keys its amber
    // "unverified comp" warning off it. A fallback comp that did not say so
    // would look exactly as solid as one built from real sales.
    //
    // Worth being clear about how rough this branch is: market carries no
    // condition, so this is a condition-free number times a flat guess. It is
    // a placeholder until the card sells or someone prices it by hand.
    estimated = true;
    fields["Comp"] = Math.round(card.market * mult * 100) / 100;
    fields["Comp Source"] = fallbackCompSource(card.variant || "", mult, cond);
    // No sales means the old sales list is stale and would be read as current.
    fields["Comp Detail"] = "";
  } else {
    return { ok: false, reason: "no price available for this card right now" };
  }

  // Only if there were no live listings at all does the condition-blind mirror
  // number get stored, and then it says so, because an unlabelled price that
  // silently means "some other condition" is what caused this whole mess.
  if (fields["Market"] === undefined && card && card.market !== null) {
    fields["Market"] = card.market;
    fields["Market Basis"] = `${card.variant || "printing"}, any condition`;
  }
  fields["Comp Date"] = new Date().toISOString().slice(0, 10);
  // Written on every check, including ones that did not move the price.
  // Comp Date is day-granularity, so it cannot order a rotation that runs
  // several times an hour - every card done today would sort equal and the
  // job would re-walk the same head of the table forever.
  fields["Comp Checked"] = new Date().toISOString();
  if (!(rec.fields["Entry Comp"] > 0)) fields["Entry Comp"] = fields["Comp"];

  // An estimate that swings an existing comp by more than half is the case
  // that actually costs money: it is the moment a guess replaces a number
  // somebody may have already priced a card against.
  const swing = estimated && typeof before === "number" && before > 0
    ? Math.abs(fields["Comp"] - before) / before
    : 0;

  return {
    ok: true,
    fields,
    comp: fields["Comp"],
    before,
    linked,
    estimated,
    needsReview: swing > REVIEW_SWING,
  };
}
