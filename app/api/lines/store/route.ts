import { NextResponse } from "next/server";
import { atCreate, atGet, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";
import { stockAlert } from "@/lib/alerts";

// A store purchase: a customer bought an in-stock item off the shelf during
// the stream. Creates a line flagged Is Store Purchase with the actual sold
// price, marks it delivered (Qty Hit 1), and pulls one from inventory. Store
// lines never touch spin metrics or the show set export.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (!isRecId(String(b.streamId)) || !isRecId(String(b.productId))) {
    return NextResponse.json({ error: "bad ids" }, { status: 400 });
  }
  const soldPrice = parseFloat(b.soldPrice);
  if (!(soldPrice >= 0)) return NextResponse.json({ error: "sold price required" }, { status: 400 });

  const stream = await atGet(T.streams, b.streamId).catch(() => null);
  if (!stream || !(await ownsStream(me, stream))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (stream.fields["Items Returned"]) {
    return NextResponse.json({ error: "items already returned - show set is locked" }, { status: 400 });
  }
  const product = await atGet(T.inventory, b.productId).catch(() => null);
  if (!product) return NextResponse.json({ error: "unknown product" }, { status: 400 });

  const name = product.fields["Product Name"];
  const line = await atCreate(T.lines, {
    "Line": `1x ${name} (store)`,
    "Qty": 1,
    "Qty Hit": 1,
    "Buy Price Snapshot": product.fields["Buy Price"] ?? 0,
    "Market Price Snapshot": product.fields["Market Price"] ?? 0,
    "Is Store Purchase": true,
    "Sold Price": soldPrice,
    "Stream": [b.streamId],
    "Stream Rec Id": b.streamId,
    "Product": [product.id],
  });
  await atUpdate(T.inventory, product.id, {
    "Qty On Hand": (product.fields["Qty On Hand"] ?? 0) - 1,
  });
  await stockAlert([{ name, qtyNow: (product.fields["Qty On Hand"] ?? 0) - 1, delta: -1 }], "store sale").catch(() => {});
  return NextResponse.json({ ok: true, id: line.id, name, soldPrice });
}
