import { NextResponse } from "next/server";
import { T, atDeleteBatch, atGet, atList, atUpdate, isRecId, type AtRecord } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { clampStock } from "@/lib/stock";
import { STORE_FAN_IN_MAX, duplicateStoreLines } from "@/lib/storeSales";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// sd-v2. Clearing a mass mis-booking off a show set.
//
// 134 shelf sales of 134 different listings once landed on a single Ultra
// Premium Collection. Removing them one at a time through the line endpoint is
// about six Airtable calls each, which is over the 5-per-second limit before
// the third one lands: some deletes failed, the page's own reload got rate
// limited too, and the editor reported that as "Stream not found". It looked
// like the lines refused to delete. They did delete. The request that was
// supposed to confirm it never came back.
//
// So do it in one pass with the batch endpoint - ten records a request, about
// fourteen requests for a hundred and thirty four - and put the stock back for
// the few that took any.
//
// What counts as a duplicate is deliberately narrow: a store line, with no
// Whatnot order id, belonging to a group of more than STORE_FAN_IN_MAX lines
// on the SAME product. A hand-entered store sale is never part of a group that
// size, so this cannot reach one.

async function loadStoreLines(streamId: string): Promise<AtRecord[]> {
  return atList(T.lines, {
    filterByFormula: `AND({Stream Rec Id} = '${streamId}', {Is Store Purchase})`,
    "fields[]": ["Line", "Qty", "Qty Hit", "Sold Price", "Product", "Whatnot Order Id", "Market Price Snapshot"],
  });
}

// GET: what would go, and what it is costing. Writes nothing.
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const dupes = duplicateStoreLines(await loadStoreLines(params.id));
  return NextResponse.json({
    count: dupes.length,
    threshold: STORE_FAN_IN_MAX,
    // The reason this matters: every one of these carries a product cost
    // snapshot that the show's P&L is paying for.
    phantomCost:
      Math.round(dupes.reduce((s, l) => s + (Number(l.fields["Market Price Snapshot"]) || 0) * (Number(l.fields["Qty"]) || 0), 0) * 100) / 100,
    unitsToRestore: dupes.reduce((s, l) => s + (Number(l.fields["Qty Hit"]) || 0), 0),
    name: String(dupes[0]?.fields["Line"] || ""),
  });
}

// DELETE: remove them. Manager only, and it reports exactly what it did.
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const stream = await atGet(T.streams, params.id).catch(() => null);
  if (!stream) return NextResponse.json({ error: "no stream with that id" }, { status: 404 });

  const dupes = duplicateStoreLines(await loadStoreLines(params.id));
  if (dupes.length === 0) return NextResponse.json({ ok: true, removed: 0, restored: {} });

  // Put back only what actually left the shelf. On a store line that is the
  // hit units, which is what the single-line delete restores too; a line left
  // pending never took anything.
  const restore = new Map<string, number>();
  for (const l of dupes) {
    const productId = String(l.fields["Product"]?.[0] || "");
    const hit = Number(l.fields["Qty Hit"]) || 0;
    if (productId && hit > 0) restore.set(productId, (restore.get(productId) || 0) + hit);
  }

  const removed = await atDeleteBatch(T.lines, dupes.map((l) => l.id));

  const restored: Record<string, number> = {};
  for (const [productId, units] of restore) {
    const product = await atGet(T.inventory, productId).catch(() => null);
    if (!product) continue;
    const name = String(product.fields["Product Name"] || productId);
    const qtyNow = clampStock(product.fields["Qty On Hand"]) + units;
    await atUpdate(T.inventory, productId, { "Qty On Hand": qtyNow });
    restored[name] = units;
  }

  return NextResponse.json({ ok: true, removed: removed.length, asked: dupes.length, restored });
}
