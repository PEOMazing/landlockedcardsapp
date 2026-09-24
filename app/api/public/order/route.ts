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

  const stamp = new Date().toISOString();
  const who = `${name} (${contact})`;
  const taken: { cardNo: string; name: string; price: number | null }[] = [];
  for (const r of rows) {
    try {
      // An existing pending flag is left as it was: the first person to ask is
      // the one whose name should still be on it when the payment arrives.
      if (!r.fields["Order Pending"]) {
        await atUpdate(T.singles, r.id, { "Order Pending": stamp, "Order Buyer": who });
      }
      taken.push({
        cardNo: formatCardNo(r.fields["Card No"]),
        name: String(r.fields["Card Name"] || ""),
        price: Number(r.fields["Comp"]) > 0 ? Number(r.fields["Comp"]) : null,
      });
    } catch {
      // the flag is a courtesy, not the order - a card that would not take it
      // still belongs on the list the buyer is about to pay for
      taken.push({
        cardNo: formatCardNo(r.fields["Card No"]),
        name: String(r.fields["Card Name"] || ""),
        price: Number(r.fields["Comp"]) > 0 ? Number(r.fields["Comp"]) : null,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    cards: taken,
    total: orderTotal(taken.map((t) => t.price)),
    // cards the cart asked for that are no longer for sale
    unavailable: ids.length - rows.length,
  });
}
