import { NextResponse } from "next/server";
import { T, atList, atUpdate, isRecId } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { bucketFor } from "@/lib/cardNo";

export const maxDuration = 60;

// Comfortably inside the minute at roughly 200ms a write.
const MAX_PER_CALL = 150;

// Called the moment labels actually go to the printer, recording which price
// bucket each sticker carries.
//
// Without this the app could show a live bucket but never know what is physically
// on the card, so a comp drifting from $49 to $52 would silently leave the card
// in the wrong box with a sticker saying otherwise. Storing what was printed is
// what makes a re-sticker list possible.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const all: string[] = Array.isArray(body.ids) ? body.ids.filter((i: any) => isRecId(String(i))) : [];
  if (all.length === 0) return NextResponse.json({ error: "no cards given" }, { status: 400 });

  // A stamp is one write per card and this function gets a minute, so a run
  // longer than that is cut here and the leftovers are handed back rather than
  // being lost to a timeout halfway through the loop. The caller sends the rest.
  const ids = all.slice(0, MAX_PER_CALL);

  // One read for the whole batch: comps come from the record rather than the
  // client, so a stale browser tab cannot stamp a bucket that was never true.
  // Two fields, because that is all a stamp decides on.
  const rows = await atList(T.singles, { "fields[]": ["Comp", "Printed Bucket"] });
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Two different questions, so two different fields.
  //
  // Printed Bucket answers "has the price drifted out of the box this card is
  // physically sitting in", and it is deliberately only written for cards that
  // have a bucket at all. That makes it useless for the other question - an
  // unpriced card that has been stickered twice still has a blank bucket - so
  // Label Printed is stamped for everything that went to the printer, priced
  // or not, and is the one thing the Never printed filter can trust.
  const now = new Date().toISOString();
  let stamped = 0;
  for (const id of ids) {
    const rec = byId.get(id);
    if (!rec) continue;
    const fields: Record<string, any> = { "Label Printed": now };
    const bucket = bucketFor(rec.fields["Comp"]);
    if (bucket && String(rec.fields["Printed Bucket"] || "") !== bucket) {
      fields["Printed Bucket"] = bucket;
    }
    await atUpdate(T.singles, id, fields);
    stamped++;
  }
  return NextResponse.json({ stamped, of: ids.length, remaining: all.length - ids.length });
}
