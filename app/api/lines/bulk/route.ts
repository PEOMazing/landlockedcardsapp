import { NextResponse } from "next/server";
import { stockAlert } from "@/lib/alerts";
import { atCreate, atGet, atList, atUpdate, isRecId, T, AtRecord } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";
import { onHandOf, stockShortfall } from "@/lib/stock";

// Bulk-add pasted items to a show set.
// Body: { streamId, items: [{ name, qty }] }
// Matches names against active inventory (exact, then contains). Unmatched items
// are auto-created in Inventory (admin only) with blank prices to fill in later,
// but are not added to the set - a product at 0 on hand has no stock to pull.
// Every row that cannot be satisfied lands in `skipped` carrying its reason.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();
  if (!isRecId(String(b.streamId || ""))) return NextResponse.json({ error: "bad stream id" }, { status: 400 });
  const stream = await atGet(T.streams, b.streamId);
  if (!ownsStream(me, stream)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // TEMPORARY inventory-rebuild window (expires 2026-07-20 23:00 Denver): admin
  // can rebuild closed show sets; adds skip stock decrements, mirroring deletes.
  const rebuildWindow = !!stream.fields["Items Returned"] && (me.isAdmin ?? false) && Date.now() < Date.parse("2026-07-21T05:00:00Z");
  if (stream.fields["Items Returned"] && !rebuildWindow) return NextResponse.json({ error: "items already returned - show set is locked" }, { status: 400 });

  const items: { name: string; qty: number }[] = (b.items || [])
    .map((i: any) => ({ name: String(i.name || "").trim(), qty: Math.max(1, parseInt(i.qty) || 1) }))
    .filter((i: any) => i.name.length > 0)
    .slice(0, 100);
  if (items.length === 0) return NextResponse.json({ error: "nothing to add" }, { status: 400 });

  const inventory = await atList(T.inventory, { filterByFormula: "{Active} = TRUE()" });
  const byLower = new Map<string, AtRecord>();
  for (const r of inventory) byLower.set(String(r.fields["Product Name"]).toLowerCase(), r);

  function match(name: string): AtRecord | null {
    const n = name.toLowerCase();
    if (byLower.has(n)) return byLower.get(n)!;
    const contains = inventory.filter((r) => {
      const p = String(r.fields["Product Name"]).toLowerCase();
      return p.includes(n) || n.includes(p);
    });
    return contains.length === 1 ? contains[0] : null;
  }

  const added: string[] = [];
  const created: string[] = [];
  const skipped: string[] = [];
  const stockChanges: { name: string; qtyNow: number; delta: number }[] = [];

  for (const item of items) {
    let product = match(item.name);
    if (!product) {
      if (!me.isAdmin) {
        skipped.push(`${item.name} - no match in inventory`);
        continue;
      }
      // Auto-created products start at 0 on hand, so deducting from one could
      // only ever go negative. Create the product so it can be priced and
      // stocked, but do not put it on the set.
      product = await atCreate(T.inventory, {
        "Product Name": item.name,
        "Category": "Other",
        "Buy Price": 0,
        "Market Price": 0,
        "Qty On Hand": 0,
        "Active": true,
      });
      byLower.set(item.name.toLowerCase(), product);
      inventory.push(product);
      created.push(item.name);
      skipped.push(`${item.name} - created at 0 on hand, receive stock then add it`);
      continue;
    }
    const name = product.fields["Product Name"];
    if (!rebuildWindow) {
      // The cached record is kept in step with each deduction below, so two
      // pasted rows of the same product are checked against what the first one
      // left behind rather than both seeing the original quantity.
      const short = stockShortfall(product, item.qty);
      if (short) {
        skipped.push(`${item.name} - ${short}`);
        continue;
      }
    }
    await atCreate(T.lines, {
      "Line": `${item.qty}x ${name}`,
      "Qty": item.qty,
      "Qty Hit": 0,
      "Buy Price Snapshot": product.fields["Buy Price"] ?? 0,
      "Market Price Snapshot": product.fields["Market Price"] ?? 0,
      "Is Giveaway": product.fields["Category"] === "Giveaway",
      "Stream": [b.streamId],
      "Stream Rec Id": b.streamId,
      "Product": [product.id],
    });
    if (!rebuildWindow) {
      const qtyNow = onHandOf(product) - item.qty;
      product.fields["Qty On Hand"] = qtyNow;
      stockChanges.push({ name, qtyNow, delta: -item.qty });
      await atUpdate(T.inventory, product.id, { "Qty On Hand": qtyNow });
    }
    added.push(`${item.qty}x ${name}`);
  }

  await stockAlert(stockChanges, "set build").catch(() => {});
  return NextResponse.json({ added, created, skipped });
}
