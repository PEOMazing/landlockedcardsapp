import { NextResponse } from "next/server";
import { atList, atCreate, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await atList(T.inventory, {
    filterByFormula: "{Active} = TRUE()",
    "sort[0][field]": "Product Name",
  });
  const items = rows.map((r) => ({
    id: r.id,
    name: r.fields["Product Name"],
    category: r.fields["Category"] || "",
    marketPrice: r.fields["Market Price"] ?? 0,
    qtyOnHand: r.fields["Qty On Hand"] ?? 0,
    tcgUrl: r.fields["TCGplayer URL"] || "",
    imageUrl: r.fields["Image URL"] || "",
    priceChecked: r.fields["Price Checked"] || null,
    isGiveaway: r.fields["Category"] === "Giveaway",
    // buy price is admin-only
    ...(me.isAdmin ? { buyPrice: r.fields["Buy Price"] ?? 0 } : {}),
  }));
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json();
  const rec = await atCreate(T.inventory, {
    "Product Name": b.name,
    "Category": b.category || "Other",
    "Buy Price": b.buyPrice ?? 0,
    "Market Price": b.marketPrice ?? 0,
    "Price Checked": new Date().toISOString().slice(0, 10),
    "Qty On Hand": b.qtyOnHand ?? 0,
    "TCGplayer URL": b.tcgUrl || "",
    "Active": true,
  });
  return NextResponse.json({ id: rec.id });
}
