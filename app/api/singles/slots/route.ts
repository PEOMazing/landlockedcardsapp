import { NextResponse } from "next/server";
import { atList, atUpdate, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { nextFreeSlots, slotFields } from "@/lib/slots";

export const maxDuration = 60;

// Files cards that have no binder pocket yet. Safe to re-run: it only fills
// blanks, and a card already in a pocket is left where it is.
//
// mode "cardNo" is the one-time pass over a collection that was stickered
// before slots existed. Every card keeps the number already on its sticker, so
// nothing is reprinted and nothing moves. Only right while the sticker and
// Card No still agree, which is why it is not the default.
//
// mode "pack" is the everyday one: cards loaded straight into Airtable arrive
// with no pocket, and these take the lowest empty ones. Cards added through the
// app claim a pocket as they are created and never reach this.
//
// Chunked, because filing a whole binder is more writes than one request has
// time for. Call it until remaining comes back 0.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}) as any);
  const mode = b?.mode === "cardNo" ? "cardNo" : "pack";
  const limit = Math.min(Math.max(parseInt(b?.limit) || 120, 1), 400);

  const rows = await atList(T.singles, { "fields[]": ["Slot", "Card No", "Status"] });
  const taken = rows.map((r) => Number(r.fields["Slot"])).filter((n) => Number.isInteger(n) && n > 0);
  // a sold card has left the binder, so it is owed nothing
  const needs = rows.filter((r) => !(Number(r.fields["Slot"]) > 0) && r.fields["Status"] !== "Sold");
  const batch = needs.slice(0, limit);

  const used = new Set(taken);
  let filed = 0;
  const failed: string[] = [];
  for (const r of batch) {
    const printed = Number(r.fields["Card No"]);
    // in cardNo mode a sticker number already standing in as someone else's
    // pocket falls through to the pool rather than two cards claiming one
    const keep = mode === "cardNo" && Number.isInteger(printed) && printed > 0 && !used.has(printed);
    const slot = keep ? printed : nextFreeSlots(used, 1)[0];
    used.add(slot);
    try {
      await atUpdate(T.singles, r.id, slotFields(slot));
      filed++;
    } catch {
      // the pocket goes back in the pool so the next pass can use it
      used.delete(slot);
      failed.push(r.id);
    }
  }
  return NextResponse.json({ mode, filed, failed: failed.length, remaining: needs.length - filed });
}
