import { NextResponse } from "next/server";
import { atCreate, atGet, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";

// Put a single onto a stream's show set. The comp snapshots in as the line's
// market price and the buy price snapshots as cost, so the pay engine and all
// metrics treat it exactly like a sealed product line.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const b = await req.json();
  if (!b.streamId || !isRecId(b.streamId)) return NextResponse.json({ error: "streamId required" }, { status: 400 });

  const [single, stream] = await Promise.all([atGet(T.singles, params.id), atGet(T.streams, b.streamId)]);
  if (!ownsStream(me, stream)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (stream.fields["Items Returned"]) {
    return NextResponse.json({ error: "items were already returned for this stream" }, { status: 400 });
  }
  if ((single.fields["Status"] || "In Stock") !== "In Stock") {
    return NextResponse.json({ error: "card is not in stock" }, { status: 400 });
  }
  if (single.fields["Comp"] === undefined || single.fields["Comp"] === null) {
    return NextResponse.json({ error: "set a comp on this card first - it drives spot value and pay" }, { status: 400 });
  }

  const name = [
    single.fields["Card Name"] || "Card",
    single.fields["Card Number"] ? `#${single.fields["Card Number"]}` : "",
    single.fields["Set Name"] || "",
    single.fields["Condition"] && single.fields["Condition"] !== "Raw" ? `(${single.fields["Condition"]})` : "",
  ].filter(Boolean).join(" ");

  await atCreate(T.lines, {
    "Line": `1x ${name}`,
    "Qty": 1,
    "Qty Hit": 0,
    "Buy Price Snapshot": single.fields["Buy Price"] ?? 0,
    "Market Price Snapshot": single.fields["Comp"],
    "Is Giveaway": false,
    "Stream": [b.streamId],
    "Stream Rec Id": b.streamId,
  });

  // one copy moves onto the stream; extra copies stay in stock
  const qty = single.fields["Qty"] ?? 1;
  if (qty > 1) {
    await atUpdate(T.singles, params.id, { "Qty": qty - 1 });
  } else {
    await atUpdate(T.singles, params.id, { "Status": "In Stream", "Stream Rec Id": b.streamId });
  }
  return NextResponse.json({ ok: true });
}
