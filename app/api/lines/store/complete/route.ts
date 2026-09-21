import { NextResponse } from "next/server";
import { atGet, atList, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";
import { completeStoreSale, isPendingStoreLine } from "@/lib/storeSales";

// Finish store sales that were waiting on inventory. Pass lineId for one, or
// streamId to finish every one on the stream that now has enough stock.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  let lines;
  let streamId = "";
  if (isRecId(String(b.lineId))) {
    const line = await atGet(T.lines, b.lineId).catch(() => null);
    if (!line) return NextResponse.json({ error: "line not found" }, { status: 404 });
    streamId = line.fields["Stream Rec Id"];
    lines = [line];
  } else if (isRecId(String(b.streamId))) {
    streamId = b.streamId;
    lines = (await atList(T.lines, { filterByFormula: `AND({Stream Rec Id} = '${streamId}', {Is Store Purchase})` })).filter(isPendingStoreLine);
  } else {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const stream = await atGet(T.streams, streamId).catch(() => null);
  if (!stream || !(await ownsStream(me, stream))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let completed = 0;
  const errors: string[] = [];
  for (const l of lines) {
    const r = await completeStoreSale(l);
    if (r.ok === true) completed++;
    else errors.push(r.error);
  }
  if (lines.length === 1 && errors.length) return NextResponse.json({ error: errors[0] }, { status: 400 });
  return NextResponse.json({ ok: true, completed, errors });
}
