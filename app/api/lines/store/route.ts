import { NextResponse } from "next/server";
import { atGet, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream, canManageStream } from "@/lib/auth";
import { recordStoreSale } from "@/lib/storeSales";

// A store sale entered by hand: a buyer bought something off the shelf during
// the stream. Creates a line flagged Is Store Purchase with what they actually
// paid. `qty` is how many units left the shelf (a "5x packs" listing is 5).
// When there is not enough on hand the sale is still logged, flagged "cannot
// complete set", and finished later from the Store sales section once the
// count is fixed. Store lines never touch spin metrics or the show set export.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (!isRecId(String(b.streamId)) || !isRecId(String(b.productId))) {
    return NextResponse.json({ error: "bad ids" }, { status: 400 });
  }
  const soldPrice = parseFloat(b.soldPrice);
  if (!(soldPrice >= 0)) return NextResponse.json({ error: "sold price required" }, { status: 400 });
  const qty = Math.max(1, Math.min(500, parseInt(b.qty) || 1));

  const stream = await atGet(T.streams, b.streamId).catch(() => null);
  if (!stream || !(await ownsStream(me, stream))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // a closed stream is history: only a manager can add to it
  if (stream.fields["Items Returned"] && !canManageStream(me, stream)) {
    return NextResponse.json({ error: "this stream is closed - a manager has to add store sales to it" }, { status: 403 });
  }
  const product = await atGet(T.inventory, b.productId).catch(() => null);
  if (!product) return NextResponse.json({ error: "unknown product" }, { status: 400 });

  const r = await recordStoreSale(stream, product, { units: qty, soldPrice });
  return NextResponse.json({ ok: true, ...r, soldPrice });
}
