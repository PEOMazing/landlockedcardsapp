import { NextResponse } from "next/server";
import { atDelete, atGet, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { toSingle } from "@/lib/singles";
import { clearedSlotFields, reclaimSlot } from "@/lib/slots";
import { altIdFromUrl, altSoldUrl, isAltShareLink, resolveAltShareLink } from "@/lib/alt";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  // ownership wall: company cards need a manager; a collector's card needs its owner
  const existing = await atGet(T.singles, params.id).catch(() => null);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owner = existing.fields["Owner Rec Id"] || "";
  const ownsIt = owner !== "" && owner === me.streamer?.id;
  if (owner === "" && !me.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (owner !== "" && !ownsIt && !me.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json();
  // collectors track, they do not run sales
  if (ownsIt && !me.isTeam && (b.status !== undefined || b.salePrice !== undefined)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const fields: Record<string, any> = {};
  // set when a card came back to a different pocket than the one on its sticker
  let refiled: number | null = null;
  if (b.name !== undefined) fields["Card Name"] = b.name;
  if (b.setName !== undefined) fields["Set Name"] = b.setName;
  if (b.number !== undefined) fields["Card Number"] = b.number;
  if (b.condition !== undefined) fields["Condition"] = b.condition;
  if (b.qty !== undefined) fields["Qty"] = Math.max(0, parseInt(b.qty) || 0);
  if (b.notes !== undefined) fields["Notes"] = b.notes;
  // ALT card page for a slab. Any ALT link works - a share link from the
  // phone app, a research page, a sold page - and is stored as the sold tab.
  // Blank clears it so Check price falls back to the ALT search.
  if (b.altLink !== undefined) {
    const raw = String(b.altLink || "").trim();
    if (!raw) fields["ALT Link"] = null;
    else {
      const id = altIdFromUrl(raw) || (isAltShareLink(raw) ? await resolveAltShareLink(raw) : null);
      if (!id) return NextResponse.json({ error: "That does not look like an ALT card link. Open the card on ALT and copy its link." }, { status: 400 });
      fields["ALT Link"] = altSoldUrl(id);
    }
  }
  if (b.location !== undefined) fields["Location"] = String(b.location).trim().toUpperCase();
  if (b.language !== undefined) fields["Language"] = b.language;
  if (b.status !== undefined && ["In Stock", "In Stream", "Sold"].includes(b.status)) {
    fields["Status"] = b.status;
    if (b.status === "Sold") {
      fields["Sold Date"] = new Date().toISOString().slice(0, 10);
      // The card has left the binder, so its pocket is free for the next one in.
      // Which pocket it was is kept, because that number is printed on the card.
      Object.assign(fields, clearedSlotFields(existing.fields["Slot"]));
    }
    if (b.status === "In Stock") {
      fields["Sold Date"] = null;
      fields["Sale Price"] = null;
      // A card coming back from sold needs filing again, and it goes back to the
      // pocket printed on its sticker if that is still empty. A card coming back
      // off a stream never gave its pocket up and is left alone. Collector cards
      // are not in the company binder at all.
      if (owner === "" && !(Number(existing.fields["Slot"]) > 0)) {
        const back = await reclaimSlot(existing.fields["Last Slot"]);
        Object.assign(fields, back.fields);
        refiled = back.slot && !back.kept ? back.slot : null;
      }
    }
  }
  if (b.salePrice !== undefined) fields["Sale Price"] = Math.max(0, parseFloat(b.salePrice) || 0);
  if (b.comp !== undefined) {
    fields["Comp"] = Math.max(0, parseFloat(b.comp) || 0);
    fields["Comp Source"] = b.compSource || "manual";
    fields["Comp Date"] = new Date().toISOString().slice(0, 10);
  }
  // buy price: admin for company cards, the owner for their own collection
  if (b.buyPrice !== undefined) {
    if (!me.isAdmin && !(ownsIt && me.isCollector)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    fields["Buy Price"] = Math.max(0, parseFloat(b.buyPrice) || 0);
  }
  const rec = await atUpdate(T.singles, params.id, fields);
  return NextResponse.json({
    single: toSingle(rec, me.isAdmin || me.isCollector),
    // the sticker on this card now says the wrong pocket
    ...(refiled ? { refiled } : {}),
  });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const rec = await atGet(T.singles, params.id);
  const owner = rec.fields["Owner Rec Id"] || "";
  const ownsIt = owner !== "" && owner === me.streamer?.id;
  // company cards: admin only. A collector may delete their own cards.
  if (!ownsIt && !me.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (rec.fields["Status"] === "In Stream") {
    return NextResponse.json({ error: "card is on a stream - remove the line first" }, { status: 400 });
  }
  await atDelete(T.singles, params.id);
  return NextResponse.json({ ok: true });
}
