import { NextResponse } from "next/server";
import { atGet, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { recompSingle } from "@/lib/comp";
import { toSingle } from "@/lib/singles";

// Refresh one card's comp. All the judgement lives in lib/comp.ts so this and
// the bulk route cannot disagree about what a card is worth.
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!me.isTeam && !me.isCollector) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  // Single-card refresh is always a deliberate act - someone clicked Refresh
  // comp, or scanned a sticker and is about to quote a price off it - so it
  // never serves a cached floor. The batch routes are where the cache earns
  // its keep.
  const rec = await atGet(T.singles, params.id);
  const r = await recompSingle(rec, { live: true });
  if (!r.ok || !r.fields) return NextResponse.json({ error: r.reason || "comp refresh failed" }, { status: 400 });

  const updated = await atUpdate(T.singles, params.id, r.fields);
  return NextResponse.json({ single: toSingle(updated, me.isAdmin), linked: r.linked });
}
