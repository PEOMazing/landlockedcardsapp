import { NextResponse } from "next/server";
import { atUpdate, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json();
  const fields: Record<string, any> = {};
  if (b.name !== undefined) fields["Product Name"] = b.name;
  if (b.category !== undefined) fields["Category"] = b.category;
  if (b.buyPrice !== undefined) fields["Buy Price"] = b.buyPrice;
  if (b.marketPrice !== undefined) {
    fields["Market Price"] = b.marketPrice;
    fields["Price Checked"] = new Date().toISOString().slice(0, 10);
  }
  if (b.qtyOnHand !== undefined) fields["Qty On Hand"] = b.qtyOnHand;
  if (b.tcgUrl !== undefined) fields["TCGplayer URL"] = b.tcgUrl;
  if (b.active !== undefined) fields["Active"] = b.active;
  await atUpdate(T.inventory, params.id, fields);
  return NextResponse.json({ ok: true });
}
