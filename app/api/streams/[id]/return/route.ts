import { NextResponse } from "next/server";
import { atGet, atList, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";

// Return all unsold/unhit items on this stream's show set to inventory:
// per line, Qty On Hand += (Qty - Qty Hit). One-shot: gated by the
// "Items Returned" flag so it can never double-credit inventory.
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const stream = await atGet(T.streams, params.id);
  if (!ownsStream(me, stream)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (stream.fields["Items Returned"]) {
    return NextResponse.json({ error: "items were already returned for this stream" }, { status: 400 });
  }

  const lines = await atList(T.lines, { filterByFormula: `{Stream Rec Id} = '${params.id}'` });
  let itemsReturned = 0;
  const detail: string[] = [];
  for (const l of lines) {
    const qty = l.fields["Qty"] || 0;
    const hit = l.fields["Qty Hit"] || 0;
    const back = Math.max(qty - hit, 0);
    const productId = l.fields["Product"]?.[0];
    if (back > 0 && productId) {
      const product = await atGet(T.inventory, productId);
      await atUpdate(T.inventory, productId, {
        "Qty On Hand": (product.fields["Qty On Hand"] ?? 0) + back,
      });
      itemsReturned += back;
      detail.push(`${back}x ${product.fields["Product Name"]}`);
    }
  }
  await atUpdate(T.streams, params.id, { "Items Returned": true });
  return NextResponse.json({ itemsReturned, detail });
}
