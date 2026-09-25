import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { resolveSingleToTcg } from "@/lib/tcgcsvCards";

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
// Read only on purpose. Nothing here writes to Airtable, so it is safe to point
// at a stranger's binder.
//
// Per printing, which is the whole reason this goes through resolveSingleToTcg
// rather than the search endpoint: one productId covers Holofoil and Reverse
// Holofoil at very different prices, and the search endpoint returns whichever
// printing sorted first.
//
// The number returned is NM market. Condition is echoed back untouched rather
// than discounted, because a market price and a played-copy price are different
// claims and quietly blending them is how a comparison stops meaning anything.

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

const MAX_ROWS = 120;

export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isTeam && !me?.isCollector) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({} as any));
  const rows: QuoteRow[] = Array.isArray(body?.rows) ? body.rows.slice(0, MAX_ROWS) : [];
  if (rows.length === 0) return NextResponse.json({ error: "rows required" }, { status: 400 });

  // Serial rather than parallel. Every miss walks a whole set's product list,
  // and the group cache only helps once something has populated it; firing 120
  // cold lookups at tcgcsv at once is how you get rate limited into a page of
  // nulls that look like unmatched cards.
  const out = [];
  for (const r of rows) {
    const name = String(r?.name || "").trim();
    const qty = Math.max(1, Number(r?.qty) || 1);
    const base = {
      name,
      setName: String(r?.setName || "").trim(),
      number: String(r?.number || "").trim(),
      variant: String(r?.variant || "").trim(),
      condition: String(r?.condition || "").trim(),
      qty,
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

    out.push({
      ...base,
      matched: true,
      cardId: hit.cardId,
      productId: hit.productId,
      productName: hit.productName,
      // What printing the price is actually for. When this comes back different
      // from the variant that was sent, the card exists but not in the printing
      // asked for, and the price is a stand-in - worth seeing rather than hiding.
      printing: hit.subType,
      market: hit.market,
      image: hit.image,
    });
  }

  const matched = out.filter((r) => r.matched);
  return NextResponse.json({
    rows: out,
    count: out.length,
    matchedCount: matched.length,
    // Extended market for the rows that resolved, so the caller does not have
    // to re-add it and get a different answer.
    marketTotal:
      Math.round(
        matched.reduce((sum, r: any) => sum + (Number(r.market) > 0 ? r.market * r.qty : 0), 0) * 100,
      ) / 100,
  });
}
