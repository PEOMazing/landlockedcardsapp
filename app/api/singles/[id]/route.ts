import { NextResponse } from "next/server";
import { atDelete, atGet, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { toSingle } from "@/lib/singles";

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
  if (b.name !== undefined) fields["Card Name"] = b.name;
  if (b.setName !== undefined) fields["Set Name"] = b.setName;
  if (b.number !== undefined) fields["Card Number"] = b.number;
  if (b.condition !== undefined) fields["Condition"] = b.condition;
  if (b.qty !== undefined) fields["Qty"] = Math.max(0, parseInt(b.qty) || 0);
  if (b.notes !== undefined) fields["Notes"] = b.notes;
  if (b.location !== undefined) fields["Location"] = String(b.location).trim().toUpperCase();
  if (b.language !== undefined) fields["Language"] = b.language;
  if (b.status !== undefined && ["In Stock", "In Stream", "Sold"].includes(b.status)) {
    fields["Status"] = b.status;
    if (b.status === "Sold") fields["Sold Date"] = new Date().toISOString().slice(0, 10);
    if (b.status === "In Stock") { fields["Sold Date"] = null; fields["Sale Price"] = null; }
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
  return NextResponse.json({ single: toSingle(rec, me.isAdmin || me.isCollector) });
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
