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
import { Floor, conditionFloor } from "./tcgListings";

const $pct = (x: number) => `${Math.round(x * 100)}%`;

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

// ---------------- comp source strings ----------------
//
// Every Comp Source string is built here, and every one carries a marker that
// lib/pricingHealth.ts reads back to classify it. That coupling has broken
// twice already - once when the fallback shipped without "est." and its amber
// warning silently stopped firing, and nearly again when the last-sale rule
// below introduced two new phrasings that matched nothing. Prose drifts;
// builders and their tests do not.
export const EST_MARKER = "est.";
export const SOLDS_MARKER = "solds";
export const LISTING_MARKER = "lowest";

export function soldsCompSource(cond: string, sales: number): string {
  return `TCGplayer ${SOLDS_MARKER} (${cond}, median of ${sales})`;
}

// Still a sales-derived number, so it keeps the solds marker: the change is
// which sale it trusts, not where the data came from.
export function lastSaleCompSource(cond: string, date: string, overPct: string, sales: number): string {
  return `TCGplayer ${SOLDS_MARKER} (${cond}, last sale ${date} ${overPct} over median of ${sales})`;
}

export function listingCompSource(cond: string, printing: string, count: number, note = ""): string {
  return `TCGplayer ${LISTING_MARKER} ${cond} listing (${printing}, ${count} live${note ? `, ${note}` : ""})`;
}

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

// When the newest sale sits this far above the median, the median is treated
// as lagging rather than as the truth.
//
// A median is the right default because it shrugs off one weird sale, but that
// same property makes it slow: three sales of $100, $105 and $400 give a
// median of $105 on a card that just changed hands for $400. Pricing off that
// hands someone a card at a third of what the market is currently paying.
const RECENT_JUMP = 0.25;

// The floor caps it. The most recent sale is one data point and it can be a
// lot, a misdescribed card, or someone who did not check - and the giveaway is
// live listings in the same condition sitting well below it. If a buyer can
// purchase the card for the floor price right now, a comp above the floor is
// not a price anyone has to pay. Capping keeps the jump honest without
// throwing away the signal.
const capToFloor = (price: number, floor: Floor | null): number =>
  floor && floor.low > 0 ? Math.min(price, floor.low) : price;

export type SoldPick = {
  price: number;
  /** the newest sale was far enough above the median to override it */
  usedLastSale: boolean;
  /** that sale was above what the card can be bought for, so the floor won */
  cappedByFloor: boolean;
  jump: number;
  latestDate: string;
};

// Which number a set of sold sales should actually produce. Pure, because this
// is the function that decides what cards get priced at.
export function pickSoldPrice(
  median: number,
  detail: { date: string; price: number }[],
  floor: Floor | null
): SoldPick {
  const base = { price: median, usedLastSale: false, cappedByFloor: false, jump: 0, latestDate: "" };
  if (!Array.isArray(detail) || detail.length === 0 || !(median > 0)) return base;

  // Sorted rather than assumed: the feed returns newest first today, but the
  // whole rule turns on which sale is genuinely the latest.
  const latest = [...detail].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  if (!latest || !(latest.price > 0)) return base;

  const jump = (latest.price - median) / median;
  if (jump < RECENT_JUMP) return { ...base, jump, latestDate: latest.date };

  const capped = capToFloor(latest.price, floor);
  return {
    price: Math.round(capped * 100) / 100,
    usedLastSale: true,
    cappedByFloor: capped < latest.price,
    jump,
    latestDate: latest.date,
  };
}

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
    const pick = pickSoldPrice(sold.price, sold.detail, floor);
    fields["Comp"] = pick.price;
    fields["Comp Source"] = !pick.usedLastSale
      ? soldsCompSource(cond, sold.sales)
      : pick.cappedByFloor
        ? listingCompSource(cond, printing, floor!.count, `capped from a last sale ${$pct(pick.jump)} over median`)
        : lastSaleCompSource(cond, pick.latestDate, $pct(pick.jump), sold.sales);
    fields["Comp Detail"] = JSON.stringify(sold.detail);
  } else if (floor) {
    // No recent sales, but real listings in our condition. Asking prices run
    // above what things sell for, so this is a ceiling rather than a comp;
    // still far better than a condition-blind number times a guess.
    fields["Comp"] = floor.low;
    fields["Comp Source"] = listingCompSource(cond, printing, floor.count);
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
