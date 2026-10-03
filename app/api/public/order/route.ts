import { NextResponse } from "next/server";
import { atList, atUpdate, isRecId, T } from "@/lib/airtable";
import { formatCardNo } from "@/lib/cardNo";
import { orderTotal } from "@/lib/venmo";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// One order from the public stock list.
//
// This endpoint is open, because the whole point is a page that works for
// someone with no account. That means anyone who finds the URL can flag cards
// as pending, so it is deliberately small: it can set two fields, on cards that
// are In Stock and company owned, and nothing else. It cannot change a price,
// cannot mark anything Sold, and cannot touch a collector's cards.
//
// The cap is the other half of that. A cart of forty is already an unusually
// big order; a request for four hundred is somebody playing with the endpoint,
// and flagging the whole binder pending would be a genuine nuisance to undo.
const MAX_CARDS = 40;

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}) as any);
  const ids: string[] = Array.isArray(b?.ids) ? b.ids.filter(isRecId).slice(0, MAX_CARDS) : [];
  const name = String(b?.name || "").trim().slice(0, 80);
  const contact = String(b?.contact || "").trim().slice(0, 80);
  if (ids.length === 0) return NextResponse.json({ error: "no cards" }, { status: 400 });
  if (!name || !contact) return NextResponse.json({ error: "name and contact required" }, { status: 400 });

  // Read before writing, so an order can only ever be placed against a card
  // that is actually for sale right now. A cart built ten minutes ago may name
  // something that has since sold, and that card should quietly drop out rather
  // than take the whole order down with it.
  const rows = await atList(T.singles, {
    filterByFormula: `AND({Status} = 'In Stock', {Owner Rec Id} = BLANK(), OR(${ids
      .map((id) => `RECORD_ID() = '${id}'`)
      .join(", ")}))`,
    "fields[]": ["Card Name", "Card No", "Comp", "Order Pending"],
  }).catch(() => [] as any[]);

  if (rows.length === 0) return NextResponse.json({ error: "none of those cards are available" }, { status: 409 });

  // There is no orders table. `Order Pending` IS the order, so a card is only
  // this buyer's if the flag went on for this buyer, in this request.
  //
  // Both of the old exceptions put a card the buyer does not have into the
  // list they were about to pay for. A card already flagged for someone else
  // was deliberately not re-flagged, correctly, and then listed anyway. A card
  // whose write threw was listed too, on the reasoning that the flag is a
  // courtesy rather than the order. With no orders table that reasoning is
  // backwards: the flag is the only record that exists.
  //
  // Either way two strangers got a Venmo link for the same card, paid, and
  // left nothing behind to say which of them should be refunded. So the total
  // is built from what was actually reserved, and everything else is named.
  const stamp = new Date().toISOString();
  const who = `${name} (${contact})`;
  const card = (r: (typeof rows)[number]) => ({
    cardNo: formatCardNo(r.fields["Card No"]),
    name: String(r.fields["Card Name"] || ""),
    price: Number(r.fields["Comp"]) > 0 ? Number(r.fields["Comp"]) : null,
  });

  const held: ReturnType<typeof card>[] = [];
  const justTaken: ReturnType<typeof card>[] = [];
  for (const r of rows) {
    if (r.fields["Order Pending"]) {
      // Someone got here first. Their name stays on it.
      justTaken.push(card(r));
      continue;
    }
    try {
      await atUpdate(T.singles, r.id, { "Order Pending": stamp, "Order Buyer": who });
      held.push(card(r));
    } catch {
      justTaken.push(card(r));
    }
  }

  if (held.length === 0) {
    return NextResponse.json(
      { error: "those cards were all claimed in the last few minutes - refresh to see what is still here" },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    cards: held,
    total: orderTotal(held.map((t) => t.price)),
    // Asked for but already sold before the read.
    unavailable: ids.length - rows.length,
    // Still listed, but claimed by someone else between the page loading and
    // this click. Separate from `unavailable` because the buyer may well want
    // to ask about these, where a sold card is simply gone.
    justTaken,
  });
}
