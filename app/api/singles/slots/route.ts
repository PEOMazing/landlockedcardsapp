import { NextResponse } from "next/server";
import { atList, atUpdate, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { nextFreeSlots, slotAddress, slotFields } from "@/lib/slots";

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
// mode "repack" renumbers every card in the binder solid from pocket 1, in
// sticker-number order, overwriting where they sit now. It is for filling a
// binder the first time, where the holes a previous numbering left are just
// pages of flipping past empty pockets. It moves cards, so it is not something
// to run once the binder is physically filled.
//
// Chunked, because filing a whole binder is more writes than one request has
// time for. Call it until remaining comes back 0.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}) as any);
  const mode = ["cardNo", "repack", "addresses"].includes(b?.mode) ? b.mode : "pack";
  const limit = Math.min(Math.max(parseInt(b?.limit) || 120, 1), 400);

  const rows = await atList(T.singles, { "fields[]": ["Slot", "Location", "Card No", "Status"] });
  const taken = rows.map((r) => Number(r.fields["Slot"])).filter((n) => Number.isInteger(n) && n > 0);
  // a sold card has left the binder, so it is owed nothing
  const needs = rows.filter((r) => !(Number(r.fields["Slot"]) > 0) && r.fields["Status"] !== "Sold");
  const batch = needs.slice(0, limit);

  if (mode === "addresses") {
    // Rewrite the readable address on cards whose pocket has not moved, for
    // when the way an address is written changes. Nothing is refiled.
    const stale = rows.filter((r) => {
      const n = Number(r.fields["Slot"]);
      return n > 0 && r.fields["Location"] !== slotAddress(n);
    });
    let fixed = 0;
    for (const r of stale.slice(0, limit)) {
      try {
        await atUpdate(T.singles, r.id, slotFields(Number(r.fields["Slot"])));
        fixed++;
      } catch {}
    }
    return NextResponse.json({ mode, filed: fixed, failed: 0, remaining: stale.length - fixed });
  }

  if (mode === "repack") {
    // Targets are recomputed from the whole binder on every call and only the
    // cards not already on theirs are written, so the run converges however it
    // is chunked. Two cards can hold one pocket in the middle of a run; by the
    // last chunk nobody does.
    const live = rows.filter((r) => r.fields["Status"] !== "Sold");
    live.sort((x, y) => (Number(x.fields["Card No"]) || 0) - (Number(y.fields["Card No"]) || 0));
    const wrong = live
      .map((r, i) => ({ r, want: i + 1 }))
      .filter(({ r, want }) => Number(r.fields["Slot"]) !== want);
    let moved = 0;
    const stuck: string[] = [];
    for (const { r, want } of wrong.slice(0, limit)) {
      try {
        await atUpdate(T.singles, r.id, slotFields(want));
        moved++;
      } catch {
        stuck.push(r.id);
      }
    }
    return NextResponse.json({ mode, filed: moved, failed: stuck.length, remaining: wrong.length - moved });
  }

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
