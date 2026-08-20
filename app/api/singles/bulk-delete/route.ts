import { NextResponse } from "next/server";
import { atDeleteBatch, atList, isRecId, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

// Bulk-remove singles from the inventory.
// Body: { ids: string[] }
// Same walls as the single-card DELETE: company cards are admin only, a
// collector may clear their own cards, and anything sitting on a stream is
// left alone so the show set stays intact. Every id we refuse comes back with
// a reason so the UI can say what it skipped instead of silently dropping it.
export const dynamic = "force-dynamic";

const MAX = 200;

export async function POST(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!me.isTeam && !me.isCollector) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  const raw: string[] = Array.isArray(b?.ids) ? b.ids.map((x: any) => String(x)) : [];
  const ids = Array.from(new Set(raw.filter(isRecId)));
  if (ids.length === 0) return NextResponse.json({ error: "no valid card ids" }, { status: 400 });
  if (ids.length > MAX) return NextResponse.json({ error: `too many cards at once - ${MAX} max per delete` }, { status: 400 });

  // pull the records in as few calls as we can; ids are validated above, so
  // they are safe to drop into a filterByFormula
  const found = new Map<string, Record<string, any>>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const formula = `OR(${chunk.map((id) => `RECORD_ID() = '${id}'`).join(",")})`;
    const rows = await atList(T.singles, { filterByFormula: formula });
    for (const r of rows) found.set(r.id, r.fields);
  }

  const ok: string[] = [];
  const skipped: { id: string; name: string; reason: string }[] = [];

  for (const id of ids) {
    const fields = found.get(id);
    if (!fields) { skipped.push({ id, name: "", reason: "not found" }); continue; }
    const name = String(fields["Card Name"] || "card");
    const owner = fields["Owner Rec Id"] || "";
    const ownsIt = owner !== "" && owner === me.streamer?.id;
    if (!ownsIt && !me.isAdmin) { skipped.push({ id, name, reason: "not yours to delete" }); continue; }
    if (fields["Status"] === "In Stream") { skipped.push({ id, name, reason: "on a stream - remove the line first" }); continue; }
    ok.push(id);
  }

  let deleted: string[] = [];
  if (ok.length) {
    try {
      deleted = await atDeleteBatch(T.singles, ok);
    } catch (e: any) {
      return NextResponse.json({ error: String(e.message || "delete failed"), deleted: [], skipped }, { status: 500 });
    }
  }
  // anything Airtable did not confirm stays in the list, so the UI keeps it
  const confirmed = new Set(deleted);
  for (const id of ok) {
    if (!confirmed.has(id)) skipped.push({ id, name: String(found.get(id)?.["Card Name"] || "card"), reason: "delete failed" });
  }

  return NextResponse.json({ deleted, count: deleted.length, skipped });
}
