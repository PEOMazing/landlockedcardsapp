import { NextResponse } from "next/server";
import { stockAlert } from "@/lib/alerts";
import { atGet, atList, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";
import { settleStreamSingles } from "@/lib/streamSingles";

// Return all unsold/unhit items on this stream's show set to inventory:
// per line, Qty On Hand += (Qty - Qty Hit). One-shot: gated by the
// "Items Returned" flag so it can never double-credit inventory.
//
// Singles can be held back one at a time. The body may carry holdLineIds: the
// singles lines the streamer un-ticked on the return list because those cards
// are not going back in the binder, they are staying out for an upcoming show.
// The flags are written to the lines FIRST and the settle reads them off the
// lines afterwards, so the decision is durable and both ways of closing a show
// (this route and the approve path) see the same answer. A held card is not
// lost: it stays out of stock, still pointed at this show, and rollover moves
// it onto the next set without a trip through the shelf.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const stream = await atGet(T.streams, params.id);
  if (!ownsStream(me, stream)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (stream.fields["Items Returned"]) {
    return NextResponse.json({ error: "items were already returned for this stream" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({} as any));
  const hold = new Set<string>(
    (Array.isArray(body?.holdLineIds) ? body.holdLineIds : []).map(String).filter(isRecId),
  );

  const lines = await atList(T.lines, { filterByFormula: `{Stream Rec Id} = '${params.id}'` });

  // Stamp the hold flags before anything settles. Only singles lines can be
  // held; a held sealed line would take units off both the shelf and the show
  // at once and quietly drop them out of the owned total, which is the exact
  // failure the two-column split was built to end.
  let heldLines = 0;
  for (const l of lines) {
    if (!isRecId(String(l.fields["Single Rec Id"] || ""))) continue;
    const want = hold.has(l.id);
    if (want === !!l.fields["Hold Out"]) continue;
    try {
      await atUpdate(T.lines, l.id, { "Hold Out": want });
      l.fields["Hold Out"] = want;
      if (want) heldLines++;
    } catch {}
  }
  let itemsReturned = 0;
  const detail: string[] = [];
  const stockChanges: { name: string; qtyNow: number; delta: number }[] = [];
  for (const l of lines) {
    // store sales were bought, not left over - nothing of theirs comes back
    if (l.fields["Is Store Purchase"]) continue;
    const qty = l.fields["Qty"] || 0;
    const hit = l.fields["Qty Hit"] || 0;
    const back = Math.max(qty - hit, 0);
    const productId = l.fields["Product"]?.[0];
    if (back > 0 && productId) {
      const product = await atGet(T.inventory, productId);
      await atUpdate(T.inventory, productId, {
        "Qty On Hand": (product.fields["Qty On Hand"] ?? 0) + back,
      });
      stockChanges.push({ name: product.fields["Product Name"], qtyNow: (product.fields["Qty On Hand"] ?? 0) + back, delta: back });
      itemsReturned += back;
      detail.push(`${back}x ${product.fields["Product Name"]}`);
    }
  }
  // Singles on a wheel only leave if a spin hit them; on an auction show they
  // all sell. settleStreamSingles knows the difference, and is the same code
  // the approve path runs, so the two ways of closing a show cannot disagree.
  let singlesSold = 0;
  let singlesReturned = 0;
  let singlesHeld = 0;
  try {
    const s = await settleStreamSingles(params.id, String(stream.fields["Stream Type"] || "Surprise Set"));
    singlesSold = s.sold + s.legacy;
    singlesReturned = s.returned;
    singlesHeld = s.held;
    if (s.returned) detail.push(`${s.returned} single${s.returned === 1 ? "" : "s"} back in stock`);
    if (s.held) detail.push(`${s.held} single${s.held === 1 ? "" : "s"} held out for the next show`);
  } catch {} // singles table may not exist yet; nothing to do
  await atUpdate(T.streams, params.id, { "Items Returned": true });
  await stockAlert(stockChanges, "items returned - relist on Whatnot").catch(() => {});
  return NextResponse.json({ itemsReturned, detail, singlesSold, singlesReturned, singlesHeld, heldLines });
}
