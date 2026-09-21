import { NextResponse } from "next/server";
import { atGet, atList, isRecId, T, type AtRecord } from "@/lib/airtable";
import { getMe, ownsStream, canManageStream } from "@/lib/auth";
import { recordStoreSale, rememberWhatnotName, type StoreSaleResult } from "@/lib/storeSales";

// Store sales from a Whatnot CSV upload. The file is read in the browser; only
// the listing title, units, price and order id come here - never buyer names
// or addresses. Orders already booked on this stream (same Whatnot order id)
// are skipped, so uploading the same file twice is harmless.
type Row = { productId: string; units: number; soldPrice: number; orderId?: string; listing?: string; remember?: boolean };

export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (!isRecId(String(b.streamId))) return NextResponse.json({ error: "bad stream" }, { status: 400 });
  const rows: Row[] = Array.isArray(b.rows) ? b.rows.slice(0, 200) : [];
  if (rows.length === 0) return NextResponse.json({ error: "nothing to add" }, { status: 400 });

  const stream = await atGet(T.streams, b.streamId).catch(() => null);
  if (!stream || !(await ownsStream(me, stream))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (stream.fields["Items Returned"] && !canManageStream(me, stream)) {
    return NextResponse.json({ error: "this stream is closed - a manager has to add store sales to it" }, { status: 403 });
  }

  const existing = await atList(T.lines, {
    filterByFormula: `AND({Stream Rec Id} = '${stream.id}', {Is Store Purchase})`,
    "fields[]": ["Whatnot Order Id"],
  });
  const booked = new Set(existing.map((l) => String(l.fields["Whatnot Order Id"] || "")).filter(Boolean));

  const added: StoreSaleResult[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const products = new Map<string, AtRecord>();
  for (const r of rows) {
    const orderId = String(r.orderId || "").slice(0, 60);
    if (orderId && booked.has(orderId)) { skipped.push(r.listing || orderId); continue; }
    if (!isRecId(String(r.productId))) { errors.push(`${r.listing || "row"}: no product picked`); continue; }
    // re-read the product every time: two rows can draw on the same stock
    const product = await atGet(T.inventory, r.productId).catch(() => null);
    if (!product) { errors.push(`${r.listing || "row"}: product not found`); continue; }
    products.set(product.id, product);
    const res = await recordStoreSale(stream, product, {
      units: Math.max(1, Math.min(500, parseInt(String(r.units)) || 1)),
      soldPrice: Math.max(0, parseFloat(String(r.soldPrice)) || 0),
      orderId,
    });
    added.push(res);
    if (orderId) booked.add(orderId);
    if (r.remember && r.listing) await rememberWhatnotName(product, r.listing);
  }
  return NextResponse.json({
    ok: true,
    added: added.length,
    pending: added.filter((a) => a.pending).map((a) => ({ name: a.name, units: a.units, onHand: a.onHand })),
    skipped,
    errors,
  });
}
