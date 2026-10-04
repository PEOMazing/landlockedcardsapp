import { NextResponse } from "next/server";
import { atList, atCreate, atUpdate, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { clampStock } from "@/lib/stock";
import { matchProduct } from "@/lib/productNames";
import { openHoldsByProduct, type ShowHold } from "@/lib/openStock";

export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Two numbers, not one. Qty On Hand has always been the storage room; what
  // was missing is the units standing on an open show, which are still owned
  // and are what makes a shelf count of 0 look like "we are out of these" when
  // there are six of them on a wheel tonight.
  //
  // If the commitment read fails the page still renders: an inventory table
  // with no "on shows" column is the behaviour from last week, and that beats
  // a 500 on the only screen that tells anyone what stock exists.
  const [rows, holds] = await Promise.all([
    atList(T.inventory, {
      filterByFormula: "{Active} = TRUE()",
      "sort[0][field]": "Product Name",
    }),
    openHoldsByProduct().catch(() => new Map<string, ShowHold[]>()),
  ]);
  const items = rows.map((r) => ({
    id: r.id,
    name: r.fields["Product Name"],
    category: r.fields["Category"] || "",
    marketPrice: r.fields["Market Price"] ?? 0,
    qtyOnHand: r.fields["Qty On Hand"] ?? 0,
    // committed to shows that have not been closed out yet
    qtyOnShows: (holds.get(r.id) || []).reduce((a, s) => a + s.qty, 0),
    // Which shows are holding them, so the number can be opened rather than
    // just read. Omitted entirely when nothing is out, which is most rows:
    // sending an empty array on 1,200 products would be a kilobyte of nothing.
    ...(holds.get(r.id)?.length ? { showsOnHold: holds.get(r.id) } : {}),
    tcgUrl: r.fields["TCGplayer URL"] || "",
    imageUrl: r.fields["Image URL"] || "",
    retailPrice: r.fields["Retail Price"] ?? null,
    entryMarket: r.fields["Entry Market"] ?? null,
    dateAdded: r.fields["Date Added"] || "",
    priceChecked: r.fields["Price Checked"] || null,
    isGiveaway: r.fields["Category"] === "Giveaway",
    // other names this product goes by: old names, and Whatnot listing titles
    // matched to it by hand, so a CSV upload can find it
    aliases: [...String(r.fields["Former Names"] || "").split("\n"), ...String(r.fields["Whatnot Names"] || "").split("\n")]
      .map((s) => s.trim())
      .filter(Boolean),
    // mapped = locked to one exact TCGplayer product, so the price is read
    // straight from that product rather than guessed from the name
    tcgMapped: Number(r.fields["TCG Group Id"]) > 0 && Number(r.fields["TCG Category Id"]) > 0,
    // buy prices: admins and managers only - streamers never receive them
    ...(me.isManager ? { buyPrice: r.fields["Buy Price"] ?? 0 } : {}),
  }));
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json();

  // Add product had no duplicate check at all, and it is how most of them got
  // here: 57 products in this table had a second copy, several a third, and
  // the pairs disagreed about price, category and how many were on the shelf.
  // A show set built off the wrong copy prices the night wrong.
  //
  // Exact only, against current AND former names, which is what productAliases
  // gives. Not the fuzzy match: that one exists to help a human pick from a
  // pasted line, and using it here would refuse to create a genuinely new
  // product because an older one shares most of its words.
  const name = String(b.name || "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const hit = matchProduct(name, await atList(T.inventory));
  if (hit.kind === "exact") {
    // Reviving the record rather than making another one: an inactive product
    // with the right name is a product that was retired, not a missing one.
    const revive: Record<string, any> = {};
    if (!hit.product.fields["Active"]) revive["Active"] = true;
    if (clampStock(b.qtyOnHand) > 0) {
      revive["Qty On Hand"] = (hit.product.fields["Qty On Hand"] ?? 0) + clampStock(b.qtyOnHand);
    }
    if ((b.buyPrice ?? 0) > 0) revive["Buy Price"] = b.buyPrice;
    if (Object.keys(revive).length) await atUpdate(T.inventory, hit.product.id, revive);
    return NextResponse.json({
      id: hit.product.id,
      existed: true,
      name: hit.product.fields["Product Name"],
    });
  }

  const rec = await atCreate(T.inventory, {
    "Product Name": name,
    "Category": b.category || "Other",
    "Buy Price": b.buyPrice ?? 0,
    "Market Price": b.marketPrice ?? 0,
    "Price Checked": new Date().toISOString().slice(0, 10),
    "Date Added": new Date().toISOString().slice(0, 10),
    ...((b.marketPrice ?? 0) > 0 ? { "Entry Market": b.marketPrice } : {}),
    "Qty On Hand": clampStock(b.qtyOnHand),
    "TCGplayer URL": b.tcgUrl || "",
    "Active": true,
  });
  // the opening lot goes in the purchase log so the cost history is complete
  if ((b.buyPrice ?? 0) > 0 && (b.qtyOnHand ?? 0) > 0) {
    await atCreate(T.purchases, {
      "Product Name": b.name,
      "Product Rec Id": rec.id,
      "Qty": b.qtyOnHand,
      "Unit Cost": b.buyPrice,
      "Date": new Date().toISOString().slice(0, 10),
      "Source": "add product",
    }).catch(() => {});
  }
  return NextResponse.json({ id: rec.id });
}
