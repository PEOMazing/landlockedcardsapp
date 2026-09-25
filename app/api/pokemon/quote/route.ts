import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { conditionSoldComp, resolveSingleToTcg, subTypeForVariant } from "@/lib/tcgcsvCards";
import { conditionFloor } from "@/lib/tcgListings";
import {
  isRawCondition, pickSoldPrice, conditionEstimate,
  soldsCompSource, lastSaleCompSource, risingSaleCompSource, outlierCompSource,
  listingCompSource, fallbackCompSource,
} from "@/lib/comp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Price a list of cards against TCGplayer without touching inventory.
//
// The resolver that matches an imported single to a TCGplayer product already
// exists, but until now it could only be reached by importing the cards first.
// That is the wrong order for the question actually being asked: "what is this
// pile worth" comes before "do I want to own it". Buying a collection, checking
// a trade, sanity-checking somebody's Collectr export - all of it wants a price
// for a list that is not ours and may never be.
//
// Read only on purpose. Nothing here writes to Airtable, and it never stores a
// card id, so it is safe to point at a stranger's binder.
//
// Two modes, and the difference matters:
//
//   market    - NM market per printing, straight off the nightly mirror. One
//               upstream call per card. Fine for a quick total, wrong for any
//               card that is not Near Mint.
//   condition - the real comp for the condition the card is actually in, using
//               the same three steps the nightly reprice uses on our own stock:
//               sales in that condition, then the lowest live listing in that
//               condition and printing, then a labelled estimate. Three
//               upstream calls per card, so the batch cap is smaller.
//
// Condition is the default. Comparing an MP copy against an NM market price is
// not a comparison, it is a category error with a number attached.

type QuoteRow = {
  name?: string;
  setName?: string;
  number?: string;
  variant?: string;
  rarity?: string;
  language?: string;
  condition?: string;
  qty?: number;
};

// Three upstream calls a card against somebody else's public endpoints. Forty
// at a time keeps a 260-card list inside seven requests and keeps us a guest
// worth having.
const MAX_CONDITION = 40;
const MAX_MARKET = 120;

export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isTeam && !me?.isCollector) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({} as any));
  const mode: "market" | "condition" = body?.mode === "market" ? "market" : "condition";
  const cap = mode === "condition" ? MAX_CONDITION : MAX_MARKET;
  const rows: QuoteRow[] = Array.isArray(body?.rows) ? body.rows.slice(0, cap) : [];
  if (rows.length === 0) return NextResponse.json({ error: "rows required" }, { status: 400 });

  // Serial rather than parallel. Every miss walks a whole set's product list,
  // and the group cache only helps once something has populated it; firing a
  // hundred cold lookups at once is how you get rate limited into a page of
  // nulls that look like unmatched cards.
  const out = [];
  for (const r of rows) {
    const name = String(r?.name || "").trim();
    const condRaw = String(r?.condition || "").trim();
    const cond = isRawCondition(condRaw) ? condRaw : "NM";
    const base = {
      name,
      setName: String(r?.setName || "").trim(),
      number: String(r?.number || "").trim(),
      variant: String(r?.variant || "").trim(),
      condition: condRaw,
      // What the card was priced as, when the row asked for a condition this
      // pipeline cannot price - graded, mostly. Silence here would look like
      // agreement.
      pricedAs: cond,
      qty: Math.max(1, Number(r?.qty) || 1),
    };

    if (!name) {
      out.push({ ...base, matched: false, reason: "no name" });
      continue;
    }

    let hit = null;
    try {
      hit = await resolveSingleToTcg({
        setName: base.setName,
        number: base.number,
        name,
        variant: base.variant,
        rarity: String(r?.rarity || ""),
        language: String(r?.language || ""),
      });
    } catch {
      hit = null;
    }

    if (!hit) {
      out.push({ ...base, matched: false, reason: "no product" });
      continue;
    }

    const row: Record<string, any> = {
      ...base,
      matched: true,
      cardId: hit.cardId,
      productId: hit.productId,
      productName: hit.productName,
      // What printing the price is for. When this comes back different from the
      // variant that was sent, the card exists but not in the printing asked
      // for, and the price is a stand-in - worth seeing rather than hiding.
      printing: hit.subType,
      market: hit.market,
      image: hit.image,
    };

    if (mode === "market") {
      out.push(row);
      continue;
    }

    const printing = subTypeForVariant(base.variant, String(r?.rarity || ""));
    const [sold, floor] = await Promise.all([
      conditionSoldComp(hit.productId, cond).catch(() => null),
      conditionFloor(hit.productId, printing, cond).catch(() => null),
    ]);

    if (floor) {
      row.floor = floor.low;
      row.floorListings = floor.count;
    }

    if (sold) {
      const pick = pickSoldPrice(sold.price, sold.detail, floor);
      row.comp = pick.price;
      row.basis = "sales";
      row.salesCount = pick.freshCount ?? sold.sales;
      row.compSource =
        pick.demotedOutlier
          ? outlierCompSource(cond, pick.droppedPrice || 0, pick.peerMedian || 0, pick.peerCount || 0)
          : pick.usedFloor
          ? listingCompSource(cond, printing, floor?.count || 0, "no recent sales in this condition")
          : pick.usedLastSale
          ? (pick.priceFromSales
              ? risingSaleCompSource(cond, pick.latestDate, pick.priceFromSales, pick.freshCount || 0)
              : lastSaleCompSource(cond, pick.latestDate))
          : soldsCompSource(cond, pick.freshCount ?? sold.sales, pick.freshRange);
    } else if (floor) {
      row.comp = floor.low;
      row.basis = "listing";
      row.compSource = listingCompSource(cond, printing, floor.count);
    } else if (typeof hit.market === "number" && hit.market > 0) {
      // Last resort, and flagged as such. The mirror has no condition
      // dimension, so this is NM market times a rough discount - a labelled
      // placeholder, never a number to trade on.
      const est = conditionEstimate(hit.market, cond);
      row.comp = est.price;
      row.basis = "estimate";
      row.compSource = fallbackCompSource(printing, est.mult, cond);
    } else {
      row.basis = "none";
    }

    out.push(row);
  }

  const priced = out.filter((r: any) => Number(r.comp) > 0 || (mode === "market" && Number(r.market) > 0));
  const ext = (r: any) => (mode === "market" ? r.market : r.comp) * r.qty;
  return NextResponse.json({
    mode,
    rows: out,
    count: out.length,
    matchedCount: out.filter((r: any) => r.matched).length,
    pricedCount: priced.length,
    // Extended total for the rows that priced, so the caller does not have to
    // re-add it and get a different answer.
    total: Math.round(priced.reduce((sum, r: any) => sum + ext(r), 0) * 100) / 100,
  });
}
