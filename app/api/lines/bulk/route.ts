import { NextResponse } from "next/server";
import { stockAlert } from "@/lib/alerts";
import { atCreate, atGet, atList, atUpdate, isRecId, T, AtRecord } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";
import { matchProduct, matchedProduct, type NameMatch } from "@/lib/productNames";
import { takeStock, clampStock, shortBy, NEGATIVE_STOCK_MSG } from "@/lib/stock";

// Bulk-add pasted items to a show set.
// Body: { streamId, items: [{ name, qty }] }
//
// Every name has to resolve to a product that already exists. Nothing here
// creates inventory. A paste is typed from memory or copied off a previous
// show, so it is the least reliable name source in the app, and auto-creating
// from it is how a second copy of a product you already own appears at $0
// market and quietly drags down profit over market on every show it lands in.
// If something really is new, it gets added in Inventory where it can be given
// a real price and a TCGplayer link.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();
  if (!isRecId(String(b.streamId || ""))) return NextResponse.json({ error: "bad stream id" }, { status: 400 });
  const stream = await atGet(T.streams, b.streamId);
  if (!ownsStream(me, stream)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (stream.fields["Items Returned"]) {
    return NextResponse.json({ error: "items already returned - show set is locked" }, { status: 400 });
  }

  const items: { name: string; qty: number }[] = (b.items || [])
    .map((i: any) => ({ name: String(i.name || "").trim(), qty: Math.max(1, parseInt(i.qty) || 1) }))
    .filter((i: any) => i.name.length > 0)
    .slice(0, 100);
  if (items.length === 0) return NextResponse.json({ error: "nothing to add" }, { status: 400 });

  const inventory = await atList(T.inventory, { filterByFormula: "{Active} = TRUE()" });

  // Resolve every line once, before anything is written.
  const resolved: { name: string; qty: number; match: NameMatch }[] = items.map((i) => ({
    ...i,
    match: matchProduct(i.name, inventory),
  }));

  // Check the whole paste before touching anything, so a set does not land half
  // built. Three ways a line can stop it, and they are reported separately
  // because the fix for each is different: find the real name, count the shelf,
  // or add the product in Inventory.
  const unknown = resolved.filter((r) => r.match.kind === "none").map((r) => r.name);
  const ambiguous = resolved.filter((r) => r.match.kind === "ambiguous");

  const need = new Map<string, { name: string; onHand: number; qty: number }>();
  for (const r of resolved) {
    const product = matchedProduct(r.match);
    if (!product) continue;
    const cur = need.get(product.id) || {
      name: product.fields["Product Name"],
      onHand: product.fields["Qty On Hand"] ?? 0,
      qty: 0,
    };
    cur.qty += r.qty;
    need.set(product.id, cur);
  }
  const short = [...need.values()].filter((x) => shortBy(x.onHand, x.qty) > 0);

  if (ambiguous.length > 0) {
    // Named first and on its own, because it is the one the old code got wrong.
    // Telling someone a product is missing when the truth is that two products
    // answer to what they typed sends them to create a duplicate.
    const parts = ambiguous.map((r) => {
      const names = (r.match as { candidates: AtRecord[] }).candidates
        .map((c) => c.fields["Product Name"])
        .slice(0, 4);
      return `"${r.name}" matches ${names.length} products (${names.join(", ")})`;
    });
    return NextResponse.json(
      { error: `Some lines matched more than one product, so nothing was added. Paste the full product name for: ${parts.join("; ")}.` },
      { status: 400 },
    );
  }

  if (short.length > 0 || unknown.length > 0) {
    const parts = [
      ...short.map((x) => `${x.name} (${clampStock(x.onHand)} on hand, ${x.qty} needed)`),
      ...unknown.map((m) => `${m} (not in inventory, add it there first)`),
    ];
    return NextResponse.json({ error: `${NEGATIVE_STOCK_MSG} Short: ${parts.join(", ")}.` }, { status: 400 });
  }

  const added: string[] = [];
  const failed: string[] = [];
  const stockChanges: { name: string; qtyNow: number; delta: number }[] = [];

  for (const r of resolved) {
    const product = matchedProduct(r.match)!;
    const name = product.fields["Product Name"];
    // Each line is its own create plus decrement, and there is no transaction
    // across them. The preflight above removes every reason a line should fail,
    // so a failure here is the network or Airtable, not the paste. Recording
    // which lines landed is the difference between "bulk add failed" and
    // knowing exactly what to retry.
    try {
      await atCreate(T.lines, {
        "Line": `${r.qty}x ${name}`,
        "Qty": r.qty,
        "Qty Hit": 0,
        "Buy Price Snapshot": product.fields["Buy Price"] ?? 0,
        "Market Price Snapshot": product.fields["Market Price"] ?? 0,
        "Is Giveaway": product.fields["Category"] === "Giveaway",
        "Stream": [b.streamId],
        "Stream Rec Id": b.streamId,
        "Product": [product.id],
      });
    } catch {
      failed.push(`${r.qty}x ${name}`);
      continue;
    }
    const qtyNow = takeStock(product.fields["Qty On Hand"], r.qty);
    stockChanges.push({ name, qtyNow, delta: -r.qty });
    await atUpdate(T.inventory, product.id, { "Qty On Hand": qtyNow }).catch(() => {});
    // Keep the local copy in step, so two lines of the same product in one
    // paste decrement from the running number instead of both from the
    // original. Without this a set with the same booster box on two lines
    // only ever took one line's worth off the shelf.
    product.fields["Qty On Hand"] = qtyNow;
    added.push(`${r.qty}x ${name}`);
  }

  await stockAlert(stockChanges, "set build").catch(() => {});
  // `created` stays in the response and stays empty: this route no longer
  // creates products, and the client already reads the key.
  return NextResponse.json({ added, created: [], skipped: [], failed });
}
