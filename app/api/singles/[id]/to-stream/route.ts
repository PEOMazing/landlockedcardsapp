import { NextResponse } from "next/server";
import { atCreate, atGet, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";
import { formatCardNo } from "@/lib/cardNo";
import { isRawCondition, recompSingle } from "@/lib/comp";
import { claimForStream, unavailableReason, undoClaim } from "@/lib/streamSingles";

// How recently a comp has to have been checked for the add to trust it.
const FRESH_MS = 10 * 60 * 1000;

// Put a single onto a stream's show set. The comp snapshots in as the line's
// market price and the buy price snapshots as cost, so the pay engine and all
// metrics treat it exactly like a sealed product line.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const b = await req.json();
  if (!b.streamId || !isRecId(b.streamId)) return NextResponse.json({ error: "streamId required" }, { status: 400 });

  let [single, stream] = await Promise.all([atGet(T.singles, params.id), atGet(T.streams, b.streamId)]);
  if (!ownsStream(me, stream)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (stream.fields["Items Returned"]) {
    return NextResponse.json({ error: "items were already returned for this stream" }, { status: 400 });
  }
  const why = unavailableReason(single);
  if (why) return NextResponse.json({ error: why }, { status: 400 });

  // Take the card off the market before doing anything slow with it. See the
  // note on claimForStream: the reprice below used to sit between the in-stock
  // check and the write that acts on it, and a second click arriving inside
  // that gap put the same physical card on the set twice.
  const claim = claimForStream(single, b.streamId);
  single = await atUpdate(T.singles, params.id, claim.fields);

  try {
    // Re-price at the moment it goes on the stream. This snapshot becomes the
    // line's market price, which drives spot value and what the streamer gets
    // paid, so it is the single worst number in the app to let go stale, and a
    // failure here falls through to the stored comp rather than blocking the card.
    //
    // Skipped when the comp was already checked in the last few minutes. A live
    // reprice is three calls to somebody else's API and it dominates the time an
    // add takes; building a 40-card wheel was paying that 40 times over for
    // prices that had not moved since the last one. A card checked minutes ago is
    // not stale by any definition that matters to a show starting tonight.
    const checkedAt = Date.parse(String(single.fields["Comp Checked"] || ""));
    const fresh = Number.isFinite(checkedAt) && Date.now() - checkedAt < FRESH_MS;
    let repriced = false;
    if (!fresh && isRawCondition(String(single.fields["Condition"] || "Raw"))) {
      try {
        const r = await recompSingle(single, { live: true });
        if (r.ok && r.fields) { single = await atUpdate(T.singles, params.id, r.fields); repriced = true; }
      } catch {
        // stored comp it is - a pricing hiccup must not stop a card going live
      }
    }

    if (single.fields["Comp"] === undefined || single.fields["Comp"] === null) {
      await undoClaim(params.id, claim).catch(() => {});
      return NextResponse.json({ error: "set a comp on this card first - it drives spot value and pay" }, { status: 400 });
    }

    // The binder slot leads the line so a hit tells whoever is packing exactly
    // which pocket to open, without reading the card name back against a binder.
    // Slot, not Card No: the slot is the big number printed on the sticker and
    // the one written on the binder spine. Card No is the permanent id and is
    // printed small under the QR, so it is the fallback for a card that is not
    // filed in a binder yet.
    const cardNo = formatCardNo(single.fields["Slot"] ?? single.fields["Card No"]);
    const name = [
      cardNo ? `[${cardNo}]` : "",
      single.fields["Condition"] ? String(single.fields["Condition"]) : "",
      single.fields["Card Name"] || "Card",
      single.fields["Card Number"] ? `#${single.fields["Card Number"]}` : "",
      single.fields["Set Name"] || "",
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
      // the link back to the card, so closing the show can tell a hit card from
      // an unhit one and removing the line can put the card back on the shelf
      "Single Rec Id": params.id,
      // a copy off a multi-copy record goes back as Qty + 1, not a Status flip
      "Single Copy": claim.copy,
    });

    return NextResponse.json({ ok: true, repriced, comp: single.fields["Comp"] ?? null });
  } catch (e: any) {
    // The card is claimed but never made it onto a set, so it has to go back on
    // the shelf. Leaving it In Stream would strand it: invisible in the picker
    // and attached to no line that could release it.
    await undoClaim(params.id, claim).catch(() => {});
    return NextResponse.json(
      { error: String(e?.message || e) || "could not add that card" },
      { status: 500 },
    );
  }
}
