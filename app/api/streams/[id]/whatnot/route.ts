import { NextResponse } from "next/server";
import { atGet, atList, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";
import { rememberWhatnotName } from "@/lib/storeSales";

// Fill in a stream's show set from a Whatnot show report. The report is read
// in the browser and turned into hit counts per set line (planSetFromShow);
// this writes them, along with spots sold and the giveaway counts. Hits are
// set, not added, so uploading the same report again changes nothing.
//
// Once items have been returned the unhit stock is already back on the shelf,
// so hits are locked - same rule as marking hits by hand.
// `remember` is how a mapping sticks. When somebody tells the sync that an
// unrecognised listing title is really a given set line, that title is written
// onto the line's Inventory product as a Whatnot Name, and the matcher reads
// those on every later show. Without it the same odd title has to be mapped
// again every single week, which was the complaint.
type Body = {
  hits?: { lineId: string; qtyHit: number }[];
  spotsSold?: number;
  giveaways?: number;
  singlesGiveaways?: number;
  remember?: { productId: string; listing: string }[];
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const stream = await atGet(T.streams, params.id).catch(() => null);
  if (!stream || !ownsStream(me, stream)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (stream.fields["Items Returned"]) {
    return NextResponse.json({ error: "items were already returned for this stream - hits are locked" }, { status: 400 });
  }
  const b: Body = await req.json().catch(() => ({}));

  const lines = await atList(T.lines, { filterByFormula: `{Stream Rec Id} = '${params.id}'` });
  const byId = new Map(lines.map((l) => [l.id, l]));
  let changed = 0;
  const errors: string[] = [];
  for (const h of (b.hits || []).slice(0, 500)) {
    const l = byId.get(String(h.lineId));
    if (!l) { errors.push(`line ${h.lineId} is not on this stream`); continue; }
    if (l.fields["Is Store Purchase"]) continue; // store sales have their own section
    const qty = l.fields["Qty"] || 0;
    const want = Math.max(0, Math.min(qty, Math.floor(Number(h.qtyHit) || 0)));
    if (want === (l.fields["Qty Hit"] || 0)) continue;
    await atUpdate(T.lines, l.id, { "Qty Hit": want });
    changed++;
  }

  const fields: Record<string, number> = {};
  const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  if (b.spotsSold !== undefined) fields["Spots Sold"] = n(b.spotsSold);
  if (b.giveaways !== undefined) fields["Giveaways Run"] = n(b.giveaways);
  if (b.singlesGiveaways !== undefined) fields["Singles Giveaways Run"] = n(b.singlesGiveaways);
  if (Object.keys(fields).length) await atUpdate(T.streams, params.id, fields);

  // Learn the titles. Never fatal: the hits above are the point of the call,
  // and a show whose hits landed but whose alias did not is merely one that
  // has to be mapped again, not one that is wrong.
  let learned = 0;
  for (const r of (b.remember || []).slice(0, 100)) {
    if (!isRecId(String(r.productId)) || !String(r.listing || "").trim()) continue;
    const product = await atGet(T.inventory, r.productId).catch(() => null);
    if (!product) continue;
    await rememberWhatnotName(product, String(r.listing));
    learned++;
  }

  return NextResponse.json({ ok: true, changed, learned, errors });
}
