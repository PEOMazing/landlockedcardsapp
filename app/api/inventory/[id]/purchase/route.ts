import { NextResponse } from "next/server";
import { atCreate, atGet, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

// Receive stock for a sealed product: adds quantity, records the lot in the
// Purchase Log, and rolls the product's Buy Price forward as a weighted
// average of all known lots. If the existing basis is unknown (buy price 0),
// the new lot's cost becomes the basis rather than blending against zero.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const b = await req.json();
  const qty = Math.max(1, parseInt(b.qty) || 0);
  const unitCost = Math.max(0, parseFloat(b.unitCost) || 0);
  if (!qty) return NextResponse.json({ error: "qty required" }, { status: 400 });

  const rec = await atGet(T.inventory, params.id);
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });

  const oldQty = rec.fields["Qty On Hand"] ?? 0;
  const oldBuy = rec.fields["Buy Price"] ?? 0;
  const newQty = oldQty + qty;

  const fields: Record<string, any> = { "Qty On Hand": newQty };
  if (unitCost > 0) {
    fields["Buy Price"] =
      oldBuy > 0 && oldQty > 0
        ? Math.round(((oldQty * oldBuy + qty * unitCost) / newQty) * 100) / 100
        : unitCost;
  }
  await atUpdate(T.inventory, params.id, fields);

  await atCreate(T.purchases, {
    "Product Name": rec.fields["Product Name"] || "",
    "Product Rec Id": params.id,
    "Qty": qty,
    "Unit Cost": unitCost,
    "Date": b.date || new Date().toISOString().slice(0, 10),
    "Source": "manual",
  });

  return NextResponse.json({ ok: true, qtyOnHand: newQty, avgBuy: fields["Buy Price"] ?? oldBuy });
}
