import { NextResponse } from "next/server";
import { atDelete, atGet, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream, canManageStream } from "@/lib/auth";

async function guard(lineId: string) {
  const me = await getMe();
  if (!me) return { err: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (!isRecId(lineId)) return { err: NextResponse.json({ error: "bad id" }, { status: 400 }) };
  const line = await atGet(T.lines, lineId);
  const streamId = line.fields["Stream Rec Id"];
  const stream = await atGet(T.streams, streamId);
  if (!ownsStream(me, stream)) return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { me, line, stream };
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if ("err" in g) return g.err;
  const b = await req.json();
  const returned = !!g.stream.fields["Items Returned"];
  const fields: Record<string, any> = {};
  if (b.qtyHit !== undefined) {
    if (returned) return NextResponse.json({ error: "items already returned - hits are locked" }, { status: 400 });
    fields["Qty Hit"] = Math.max(0, parseInt(b.qtyHit) || 0);
  }
  if (b.market !== undefined) {
    // pricing is admin/manager territory
    if (!canManageStream(g.me, g.stream)) {
      return NextResponse.json({ error: "only admin or the stream manager can set prices" }, { status: 403 });
    }
    const mkt = Math.max(0, parseFloat(b.market) || 0);
    fields["Market Price Snapshot"] = mkt;
    // keep the inventory master in sync and stamp the price check
    const productId = g.line.fields["Product"]?.[0];
    if (productId) {
      await atUpdate(T.inventory, productId, {
        "Market Price": mkt,
        "Price Checked": new Date().toISOString().slice(0, 10),
      });
    }
  }
  if (b.qty !== undefined) {
    if (returned) return NextResponse.json({ error: "items already returned - show set is locked" }, { status: 400 });
    const newQty = Math.max(1, parseInt(b.qty) || 1);
    const oldQty = g.line.fields["Qty"] || 0;
    fields["Qty"] = newQty;
    fields["Line"] = `${newQty}x ${(g.line.fields["Line"] || "").replace(/^\d+x\s+/, "")}`;
    const productId = g.line.fields["Product"]?.[0];
    if (productId) {
      const product = await atGet(T.inventory, productId);
      await atUpdate(T.inventory, productId, {
        "Qty On Hand": (product.fields["Qty On Hand"] ?? 0) + oldQty - newQty,
      });
    }
  }
  await atUpdate(T.lines, params.id, fields);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if ("err" in g) return g.err;
  if (g.stream.fields["Items Returned"]) return NextResponse.json({ error: "items already returned - show set is locked" }, { status: 400 });
  const qty = g.line.fields["Qty"] || 0;
  const productId = g.line.fields["Product"]?.[0];
  if (productId) {
    const product = await atGet(T.inventory, productId);
    await atUpdate(T.inventory, productId, {
      "Qty On Hand": (product.fields["Qty On Hand"] ?? 0) + qty,
    });
  }
  await atDelete(T.lines, params.id);
  return NextResponse.json({ ok: true });
}
