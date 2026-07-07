import { NextResponse } from "next/server";
import { atGet, atList, atUpdate, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

// When a quick-added product (buy price 0) gets its real buy price, fix the
// $0 cost snapshots on streams that are not Complete yet. Complete streams are
// frozen: past pay never changes.
async function backfillSnapshots(productId: string, buyPrice: number) {
  const zeroLines = await atList(T.lines, { filterByFormula: "{Buy Price Snapshot} = 0" });
  const mine = zeroLines.filter((l) => (l.fields["Product"] || []).includes(productId));
  if (mine.length === 0) return;
  const streamIds = Array.from(new Set(mine.map((l) => l.fields["Stream Rec Id"]).filter(Boolean)));
  const openStreams = new Set<string>();
  for (const sid of streamIds) {
    try {
      const st = await atGet(T.streams, sid);
      if ((st.fields["Status"] || "Planned") !== "Complete") openStreams.add(sid);
    } catch {}
  }
  for (const line of mine) {
    if (!openStreams.has(line.fields["Stream Rec Id"])) continue;
    await atUpdate(T.lines, line.id, { "Buy Price Snapshot": buyPrice });
  }
}

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
  if (typeof b.buyPrice === "number" && b.buyPrice > 0) {
    try { await backfillSnapshots(params.id, b.buyPrice); } catch {}
  }
  return NextResponse.json({ ok: true });
}
