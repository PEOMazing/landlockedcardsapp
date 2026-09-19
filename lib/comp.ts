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
import { FRESH_DAYS, dropWashSales, medianOf, round2, roundUpDollar, windowCutoff } from "./salesWindow";

export { dropWashSales } from "./salesWindow";

const money = (n: number) => "$" + n.toFixed(2);

// One place that decides what a single is worth, so the per-card button, the
// bulk refresh and the nightly job cannot drift apart.
//
// Order of preference, every step condition-specific until the last:
//   1. average of TCGplayer sales in this exact condition in the last 30 days
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

export function soldsCompSource(cond: string, count: number, range = ""): string {
  return `TCGplayer ${SOLDS_MARKER} (${cond}, median of ${count} in last 30d${range ? `, ${range}` : ""})`;
}

// Stale but sales-derived, so it keeps the solds marker: what changed is
// which sale answered, not where the number came from.
export function lastSaleCompSource(cond: string, date: string): string {
  return `TCGplayer ${SOLDS_MARKER} (${cond}, last sale ${date}, none in 30d)`;
}

// The newest sale beat the median and set the price. Says both numbers,
// because a comp above every other sale in the window is the one a person is
// most likely to want to check.
export function risingSaleCompSource(cond: string, date: string, median: number, count: number): string {
  return `TCGplayer ${SOLDS_MARKER} (${cond}, last sale ${date} above the ${money(median)} median of ${count} in last 30d)`;
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

// A lone listing is not a market. Gengar (17) shows why: real sales around
// $120 against a single asking price of $604.90. One seller's optimism should
// not become the card's value, so the floor only answers when at least this
// many people are asking around that number.
const MIN_FLOOR_LISTINGS = 2;

// Standing listings are self-selecting: the ones still visible are the ones
// nobody bought, so on a thin card the asks can sit far above the clearing
// price indefinitely. That is why a recent sale beats a live ask, and the ask
// only answers when no sale is recent enough to.
//
// Machamp (Prime) is the case that proved it: five sales inside a month at
// $60.88 to $118 against four NM asks starting at $448.59. The asks are what
// four people want, the sales are what the card is worth.

// Below this share of the cheapest standing ask, the sales are not a discount
// on the market, they are evidence of something other than the market. Wash
// trading only works when the fake sales dominate the window, and then every
// one of them sits far under what anyone will part with a copy for.
//
// The margin is the point: Machamp trades at 26% of its asking floor and must
// stay on the sales side of this line; a card pushed to $1 against $180 asks
// is under 1%.
const IMPLAUSIBLE_FRACTION = 0.15;

// A floor this far above the sold median still gets used, but gets named in
// the refresh report. At 2x the two sources disagree enough that one of them
// is measuring something else, and that is worth a human glance.
const FLOOR_REVIEW = 2;

// How fresh the newest sale has to be before it is allowed to beat the median,
// and how far above the median it may carry the price.
//
// Arceus LV.X DP53 is the case. Three NM sales in the window: $115 twenty days
// back, $120 twenty days after that, then $169.99 five days ago. The median is
// $120 and the two holding it there are about to age out. The newest sale is
// the only one describing the market the card is in now.
//
// Machamp (Prime) is why this cannot simply be "use the last sale". Its newest
// sale was $74.99 against a median of $115 - the low straggler in a scatter,
// not a market. So the rule takes the HIGHER of the two and never the lower:
// the median holds the floor up, the last sale lifts the ceiling, and neither
// can pull a card down on its own.
//
// Measured across all 98 singles, the asymmetric rule moved 17 cards and left
// Machamp, Gengar Lv.X and Lugia Legend exactly where they were.
const LAST_SALE_FRESH_DAYS = 10;

// Without a gate, a lift comes off any sale in the window, and at 15 to 20
// days old that is the top of a thin scatter rather than a move: Palkia LP
// would jump $41 to $74 on a 20-day-old sale. Ten days keeps the lifts to
// sales that are actually describing today.
//
// The cap is insurance rather than a live constraint - no card in the
// collection reaches it today. It matters because dropWashSales only discards
// sales that are too LOW, so nothing else in the pipeline stops one inflated
// sale from setting a card's price for as long as it stays in the window.
const LAST_SALE_MAX_LIFT = 2;

export type SoldPick = {
  price: number;
  /** no sale inside the window, so the listing floor answered instead */
  usedFloor: boolean;
  /** nothing sold in the window at all */
  staleSales: boolean;
  /** how many real sales the median was taken over */
  freshCount: number;
  /** the low-high of those sales, so a split set is visible without digging */
  freshRange: string;
  /** what the sales alone produced, 0 when there were none */
  priceFromSales: number;
  latestDate: string;
  /** the newest sale beat the median and set the price */
  usedLastSale?: boolean;
};

// Which number a set of sold sales should actually produce. Pure, because this
// is the function that decides what cards get priced at.
export function pickSoldPrice(
  medianIn: number,
  detailIn: { date: string; price: number }[],
  floor: Floor | null,
  now: Date = new Date()
): SoldPick {
  const clean = dropWashSales(detailIn || []);
  const cutoff = windowCutoff(now);
  const recent = clean.filter((d) => String(d.date) >= cutoff);

  const usableFloor = floor && floor.low > 0 && floor.count >= MIN_FLOOR_LISTINGS ? floor : null;
  const latest = [...clean].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];

  // The middle sale, not the average of them.
  //
  // An average assumes the sales cluster around one number. Real card sales
  // often do not. Machamp (Prime) sold five times in a month at $60.88,
  // $74.99, $115, $118 and $118 - three tight at the top, two stragglers -
  // and the mean of that is $97.37, a price at which nothing actually sold.
  // The median lands at $115, inside the cluster where the card really trades.
  //
  // When the sales do agree the two are the same number anyway, so the median
  // costs nothing in the easy case and is right in the hard one.
  const fresh = recent.length ? round2(medianOf(recent.map((d) => d.price))) : 0;

  const base: SoldPick = {
    price: fresh || (clean.length ? round2(medianOf(clean.map((d) => d.price))) : medianIn),
    usedFloor: false,
    staleSales: recent.length === 0,
    freshCount: recent.length,
    freshRange: recent.length > 1
      ? `${money(Math.min(...recent.map((d) => d.price)))}-${money(Math.max(...recent.map((d) => d.price)))}`
      : "",
    priceFromSales: fresh,
    latestDate: latest ? latest.date : "",
  };

  // Every recent sale sitting far under what anyone will part with a copy for
  // is not a discount, it is wash trading that the sale count should not
  // launder. The margin matters: Machamp trades at 26% of its asking floor and
  // has to stay on the sales side of this line.
  const implausible = !!(usableFloor && fresh > 0 && fresh < usableFloor.low * IMPLAUSIBLE_FRACTION);

  // Recent sales exist but are manufactured: the asks are the only honest
  // number left.
  if (usableFloor && implausible && !base.staleSales) {
    return { ...base, price: usableFloor.low, usedFloor: true };
  }

  // Nothing sold inside the window. Both remaining signals are weak, so take
  // whichever is higher: the last real sale, or the cheapest live ask.
  //
  // Higher rather than either one alone, because each fails in the opposite
  // direction and we have hit both:
  //
  //   Milotic 70/147 - last sale $49 back in July, three live asks from $88.
  //   The sale is stale and the asks are the truth.
  //
  //   Blissey (Prime) - last sale $94.98, and a $70 "Near Mint" ask that is
  //   really a CGC 7.5 slab listed against the raw card. Four genuine NM asks
  //   sit at $94.98 to $100. The listing is junk and the sale is the truth.
  //
  // The feed carries no grade field and no listing title, so a graded card
  // filed under the raw product is not detectable directly. Taking the higher
  // of the two neutralises it without having to.
  if (base.staleSales) {
    const lastPrice = latest ? latest.price : 0;
    const askPrice = usableFloor ? usableFloor.low : 0;
    if (askPrice > 0 || lastPrice > 0) {
      return {
        ...base,
        price: round2(Math.max(lastPrice, askPrice)),
        usedFloor: askPrice >= lastPrice,
      };
    }
  }

  // A rising card should not be held down by sales that are about to age out.
  // Taken only when it is higher, so this can lift a comp and never lower one:
  // the median already answers for the scatter case, and letting the newest
  // sale win outright would price Machamp off its $74.99 straggler.
  if (fresh > 0 && latest) {
    const age = Math.floor((now.getTime() - new Date(`${latest.date}T00:00:00Z`).getTime()) / 86400000);
    if (age <= LAST_SALE_FRESH_DAYS) {
      const capped = Math.min(latest.price, fresh * LAST_SALE_MAX_LIFT);
      if (capped > base.price) {
        return { ...base, price: round2(capped), usedLastSale: true };
      }
    }
  }
  return base;
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

  // Backfill the picture while we have the card in hand.
  //
  // A CSV-imported single arrives with no card id and no image, and the match
  // above is the moment an image first becomes reachable - but nothing here
  // ever wrote one, so the id got filled in and the picture stayed empty
  // forever. Scanning the sticker then showed a card page with no card on it.
  // Only written when the record has none, so a hand-picked image survives.
  const img = card ? String(card.imageLarge || card.image || "") : "";
  if (img && !String(rec.fields["Image URL"] || "").trim()) fields["Image URL"] = img;

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
    // the spread, for the scan page to show
    fields["Listing Detail"] = JSON.stringify(floor.prices || []);
    fields["Market Basis"] = `${printing} ${cond}, low of ${floor.count} listing${floor.count === 1 ? "" : "s"}`;
  }

  let estimated = false;
  let floorLift = 0;
  if (sold) {
    const pick = pickSoldPrice(sold.price, sold.detail, floor);
    fields["Comp"] = pick.price;
    if (pick.usedFloor) {
      fields["Comp Source"] = listingCompSource(
        cond, printing, floor!.count,
        pick.staleSales
          ? `above the last sale, none in 30d`
          : `recent sales only reached ${money(pick.priceFromSales)}`
      );
      floorLift = pick.priceFromSales > 0 ? pick.price / pick.priceFromSales : 0;
    } else if (pick.staleSales) {
      fields["Comp Source"] = lastSaleCompSource(cond, pick.latestDate);
    } else if (pick.usedLastSale) {
      fields["Comp Source"] = risingSaleCompSource(cond, pick.latestDate, pick.priceFromSales, pick.freshCount);
    } else {
      fields["Comp Source"] = soldsCompSource(cond, pick.freshCount, pick.freshRange);
    }
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

  // Every branch above lands here, which is the point: the comp is rounded up
  // to a whole dollar in exactly one place, so a future way of arriving at a
  // price cannot quietly skip it and put $94.24 on a sticker. The reference
  // numbers are deliberately left alone - Market and the sales list are
  // evidence, and evidence with the cents filed off is harder to check.
  fields["Comp"] = roundUpDollar(fields["Comp"]);

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

  // A floor that sits miles above the sales still gets used - that is the
  // point - but the two sources disagreeing by this much usually means one of
  // them is measuring something else, so the card gets named rather than
  // quietly repriced.
  const floorDisagrees = floorLift >= FLOOR_REVIEW;

  return {
    ok: true,
    fields,
    comp: fields["Comp"],
    before,
    linked,
    estimated,
    needsReview: swing > REVIEW_SWING || floorDisagrees,
  };
}
