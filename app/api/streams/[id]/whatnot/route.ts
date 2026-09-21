import { NextResponse } from "next/server";
import { atGet, atList, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";

// Fill in a stream's show set from a Whatnot show report. The report is read
// in the browser and turned into hit counts per set line (planSetFromShow);
// this writes them, along with spots sold and the giveaway counts. Hits are
// set, not added, so uploading the same report again changes nothing.
//
// Once items have been returned the unhit stock is already back on the shelf,
// so hits are locked - same rule as marking hits by hand.
type Body = {
  hits?: { lineId: string; qtyHit: number }[];
  spotsSold?: number;
  giveaways?: number;
  singlesGiveaways?: number;
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

  return NextResponse.json({ ok: true, changed, errors });
}
