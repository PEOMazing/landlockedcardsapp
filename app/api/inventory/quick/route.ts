import { NextResponse } from "next/server";
import { atList, atCreate, atUpdate, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { CATEGORIES } from "@/lib/categories";
import { matchProduct } from "@/lib/productNames";

// Quick-add from the stream builder. Any signed-in streamer or manager can
// create a product that is missing from inventory. Buy price is intentionally
// not accepted here (streamers never see or set it); admin fills it in later
// and open-stream snapshots backfill via the inventory PATCH route.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();
  const name = String(b.name || "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const category = CATEGORIES.includes(b.category) ? b.category : "Other";

  // If this product already exists, hand it back instead of making another.
  //
  // This used to be an Airtable formula on the current Product Name of ACTIVE
  // records only, and it missed on both counts. A product that has been
  // renamed answers to its old name too, and typing that old name slipped past
  // the check and made a second copy at $0 market, which is exactly what
  // Former Names exists to prevent. And a retired product is one to bring
  // back, not one to duplicate. matchProduct knows about both.
  const hit = matchProduct(name, await atList(T.inventory));
  if (hit.kind === "exact") {
    const r = hit.product;
    if (!r.fields["Active"]) await atUpdate(T.inventory, r.id, { "Active": true });
    return NextResponse.json({
      existed: true,
      item: {
        id: r.id,
        name: r.fields["Product Name"],
        category: r.fields["Category"] || "",
        marketPrice: r.fields["Market Price"] ?? 0,
        qtyOnHand: r.fields["Qty On Hand"] ?? 0,
      },
    });
  }

  const marketPrice = Math.max(0, parseFloat(b.marketPrice) || 0);
  const qtyOnHand = Math.max(0, parseInt(b.qtyOnHand) || 0);
  const rec = await atCreate(T.inventory, {
    "Product Name": name,
    "Category": category,
    "Buy Price": 0,
    "Market Price": marketPrice,
    ...(marketPrice > 0 ? { "Price Checked": new Date().toISOString().slice(0, 10) } : {}),
    "Qty On Hand": qtyOnHand,
    "Active": true,
  });
  return NextResponse.json({
    existed: false,
    item: { id: rec.id, name, category, marketPrice, qtyOnHand },
  });
}
