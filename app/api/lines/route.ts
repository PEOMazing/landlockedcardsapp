import { NextResponse } from "next/server";
import { atCreate, atGet, atUpdate, T } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";

// Add a product line to a stream. Snapshots current prices, decrements inventory.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json(); // { streamId, productId, qty }
  const stream = await atGet(T.streams, b.streamId);
  if (!ownsStream(me, stream)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // TEMPORARY inventory-rebuild window (expires 2026-07-20 23:00 Denver): admin
  // can rebuild closed show sets; adds skip the stock decrement, mirroring deletes.
  const rebuildWindow = me.isAdmin && Date.now() < Date.parse("2026-07-21T05:00:00Z");
  if (stream.fields["Items Returned"] && !rebuildWindow) return NextResponse.json({ error: "items already returned - show set is locked" }, { status: 400 });
  const product = await atGet(T.inventory, b.productId);
  const qty = Math.max(1, parseInt(b.qty) || 1);
  const name = product.fields["Product Name"];

  const rec = await atCreate(T.lines, {
    "Line": `${qty}x ${name}`,
    "Qty": qty,
    "Qty Hit": 0,
    "Buy Price Snapshot": product.fields["Buy Price"] ?? 0,
    "Market Price Snapshot": product.fields["Market Price"] ?? 0,
    "Is Giveaway": product.fields["Category"] === "Giveaway",
    "Stream": [b.streamId],
    "Stream Rec Id": b.streamId,
    "Product": [b.productId],
  });
  const onHand = product.fields["Qty On Hand"] ?? 0;
  if (!(rebuildWindow && stream.fields["Items Returned"])) {
    await atUpdate(T.inventory, b.productId, { "Qty On Hand": onHand - qty });
  }
  return NextResponse.json({ id: rec.id });
}
