import { NextResponse } from "next/server";
import { T, atCreateBatch, atGet, atUpdate, isRecId } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { toSingle } from "@/lib/singles";
import { claimSlots, slotFields } from "@/lib/slots";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Turn one record holding N cards into N records holding one card each.
//
// The rest of the app assumes one record is one physical card: Card No is the
// number printed on a sticker, the QR resolves to a record, and Mark sold sells
// that record. A Qty 27 row breaks all three at once - it prints one label for
// 27 cards, every copy of that label scans to the same page, and selling one
// marks the whole stack sold.
//
// Splitting is the fix rather than printing 27 identical stickers, because the
// sticker is an identity, not a price tag.
const MAX_SPLIT = 60;

// Airtable's own batch ceiling. Chunking is done here rather than inside
// atCreateBatch because this route has to know how many rows actually landed
// when a chunk fails - see the loop below.
const CHUNK = 10;

// Everything that describes the card and what it is worth. Card No is left out
// on purpose: it is an Airtable autoNumber, so each new row gets its own, which
// is the entire point.
//
// Also deliberately absent: Label Printed and Printed Bucket, because the new
// rows genuinely have never been stickered and should show up under Never
// printed; and Sale Price, Sold Date and Stream Rec Id, which belong to one
// specific card's history and must not be cloned onto its siblings.
//
// Status is absent too, and the copies are forced In Stock instead - see the
// status guard below for why.
const CARRY = [
  "Card Name", "Set Name", "Card Number", "Card ID", "Rarity", "Variant",
  // Location is deliberately not carried: a pocket holds one card, so every
  // copy is filed into an empty one of its own below.
  "Condition", "Language", "Printing", "Image URL", "Notes",
  "Comp", "Comp Source", "Comp Date", "Comp Detail", "Entry Comp",
  "Market", "Market Basis", "Listing Detail",
  "Buy Price", "Owner Rec Id", "Revenue Bucket", "Added By", "Date Added",
];

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const rec = await atGet(T.singles, params.id).catch(() => null);
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Same ownership wall as PATCH. Splitting restructures a card into many
  // records and cannot be undone in one click, so it must not be reachable by
  // someone who is not allowed to edit the card in the first place - and a
  // collector must be able to split their own.
  const owner = rec.fields["Owner Rec Id"] || "";
  const ownsIt = owner !== "" && owner === me.streamer?.id;
  if (owner === "" && !me.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (owner !== "" && !ownsIt && !me.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // In Stock only. A sold lot's Sale Price belongs to the whole stack and this
  // route has no way to apportion it, so splitting one would leave siblings
  // marked Sold with no sale price and a full buy price each - which reads to
  // the P&L as a pile of zero-dollar sales at full cost. A card on a stream has
  // the same problem with its stream line.
  const status = String(rec.fields["Status"] || "In Stock");
  if (status !== "In Stock") {
    return NextResponse.json(
      { error: `only In Stock cards can be split - this one is ${status}` },
      { status: 400 }
    );
  }

  const qty = Math.floor(Number(rec.fields["Qty"]) || 1);
  if (qty <= 1) return NextResponse.json({ error: "this card is already a single record" }, { status: 400 });
  if (qty > MAX_SPLIT) {
    return NextResponse.json(
      { error: `${qty} is more than this will split at once (${MAX_SPLIT}) - lower the quantity first` },
      { status: 400 }
    );
  }

  const copy: Record<string, any> = { Qty: 1, Status: "In Stock" };
  for (const f of CARRY) {
    const v = rec.fields[f];
    if (v !== undefined && v !== null && v !== "") copy[f] = v;
  }

  // Create a chunk, then immediately take those cards off the original.
  //
  // The count is conserved after every single write, which is the property
  // worth paying an extra request per chunk for. Doing all the creates first
  // and decrementing once at the end looks tidier and is wrong: atCreateBatch
  // throws on a failed chunk and discards the rows earlier chunks already
  // wrote, so a failure halfway would leave real records in the table that
  // this route does not know about and the original still claiming all N -
  // the same cards counted twice, invisibly.
  //
  // Buy Price and Comp are per card everywhere they are used (every total
  // reads qty * buy and qty * comp), so carrying both across unchanged leaves
  // total spend and total value exactly where they were.
  const want = qty - 1;
  // One empty pocket per copy, taken in one read so the copies cannot be handed
  // the same one. A collector's cards are not in the company binder. If the
  // pool cannot be read the copies are created unfiled, which the slots
  // backfill picks up - better than refusing to split the card.
  const copySlots = owner === "" ? await claimSlots(want) : [];
  let created = 0;
  let remaining = qty;
  let stoppedBecause = "";

  for (let i = 0; i < want; i += CHUNK) {
    const n = Math.min(CHUNK, want - i);
    try {
      await atCreateBatch(
        T.singles,
        Array.from({ length: n }, (_, k) => ({ ...copy, ...(copySlots[i + k] ? slotFields(copySlots[i + k]) : {}) })),
      );
    } catch (e: any) {
      // The chunk is all-or-nothing at Airtable, so nothing from it landed.
      stoppedBecause = String(e?.message || e).slice(0, 200);
      console.error("split: create chunk failed", params.id, stoppedBecause);
      break;
    }
    created += n;
    try {
      await atUpdate(T.singles, params.id, { Qty: qty - created });
      remaining = qty - created;
    } catch (e: any) {
      // The copies exist but the original still claims them. This is the one
      // state that double-counts, so it is worth one retry before giving up
      // and saying so plainly rather than reporting success.
      console.error("split: decrement failed, retrying", params.id, String(e?.message || e).slice(0, 200));
      try {
        await atUpdate(T.singles, params.id, { Qty: qty - created });
        remaining = qty - created;
      } catch (e2: any) {
        stoppedBecause = `created ${created} copies but could not lower the original's quantity: ${String(e2?.message || e2).slice(0, 160)}`;
        console.error("split: decrement failed twice", params.id, stoppedBecause);
        return NextResponse.json(
          { error: stoppedBecause, created, of: want, complete: false, needsManualFix: true },
          { status: 502 }
        );
      }
    }
  }

  if (created === 0) {
    return NextResponse.json(
      { error: `could not create the copies - nothing was changed${stoppedBecause ? ` (${stoppedBecause})` : ""}` },
      { status: 502 }
    );
  }

  const fresh = await atGet(T.singles, params.id).catch(() => null);
  return NextResponse.json({
    created,
    of: want,
    complete: created === want,
    ...(stoppedBecause ? { stoppedBecause } : {}),
    single: toSingle(fresh || { ...rec, fields: { ...rec.fields, Qty: remaining } }, me.isAdmin || me.isCollector),
  });
}
