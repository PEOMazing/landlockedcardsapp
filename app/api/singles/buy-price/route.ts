import { NextResponse } from "next/server";
import { atList, atUpdate, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { DEFAULT_BUY_PCT, buyPriceFrom, buyPriceIsCurrent } from "@/lib/buyPrice";

export const maxDuration = 60;

// Sets a cost basis on singles as a share of what the card is worth. See
// lib/buyPrice.ts for why a flat percentage is the honest answer for cards that
// arrived in lots.
//
// Chunked like the slots backfill and for the same reason: one Airtable write
// per card, and a whole collection is more writes than a serverless function
// gets a minute for. Call it until remaining comes back 0.
//
// fill: true leaves alone any card that already has a buy price, for when a
// real number has been typed in on some of them. The default overwrites, which
// is what you want the first time through.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}) as any);
  const pct = Number.isFinite(Number(b?.pct)) && Number(b?.pct) > 0 ? Number(b.pct) : DEFAULT_BUY_PCT;
  const limit = Math.min(Math.max(parseInt(b?.limit) || 150, 1), 400);
  const fillOnly = !!b?.fill;

  const rows = await atList(T.singles, { "fields[]": ["Comp", "Buy Price"] });
  const want = rows.map((r) => ({
    id: r.id,
    now: r.fields["Buy Price"],
    price: buyPriceFrom(r.fields["Comp"], pct),
  }));
  const noComp = want.filter((w) => w.price === null).length;
  const todo = want.filter((w) => {
    if (w.price === null) return false;
    if (fillOnly && Number(w.now) > 0) return false;
    return !buyPriceIsCurrent(w.now, w.price);
  });

  let priced = 0;
  let failed = 0;
  for (const w of todo.slice(0, limit)) {
    try {
      await atUpdate(T.singles, w.id, { "Buy Price": w.price });
      priced++;
    } catch {
      failed++;
    }
  }
  return NextResponse.json({
    pct,
    priced,
    failed,
    // cards with no comp to work from, which this can do nothing about
    noComp,
    remaining: todo.length - priced,
  });
}
