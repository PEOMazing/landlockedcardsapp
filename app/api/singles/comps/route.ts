import { NextResponse } from "next/server";
import { T, atGet, atUpdate, isRecId } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { recompSingle } from "@/lib/comp";

export const maxDuration = 300;

// Re-comp a batch of cards in one pass.
//
// Nothing here touches the record id or the Card No, so every sticker already
// printed keeps working: the QR encodes the record id and the big number is an
// Airtable autoNumber. A refresh can move a card's price bucket, which is what
// the Printed Bucket stamp and the re-sticker filter are for.
//
// Capped per call because each card can cost two upstream requests, and a
// serverless function that runs long enough to be killed mid-batch leaves the
// inventory half-repriced with no way to tell which half.
const CAP = 60;

export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const all: string[] = Array.isArray(body.ids) ? body.ids.filter((i: any) => isRecId(String(i))) : [];
  if (all.length === 0) return NextResponse.json({ error: "no cards given" }, { status: 400 });

  const ids = all.slice(0, CAP);
  const updated: { id: string; before: number | null; after: number }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  // Estimated comps that moved a card a long way. These are the ones worth a
  // human look, so they come back named rather than buried in a count.
  const review: { id: string; name: string; condition: string; before: number | null; after: number }[] = [];
  let linked = 0;
  let estimated = 0;

  // Sequential on purpose. The sales feed is somebody else's API and we are a
  // guest on it; hammering it in parallel is how a free data source stops
  // being a free data source.
  for (const id of ids) {
    try {
      const rec = await atGet(T.singles, id);
      const r = await recompSingle(rec);
      if (!r.ok || !r.fields) {
        skipped.push({ id, reason: r.reason || "no price" });
        continue;
      }
      await atUpdate(T.singles, id, r.fields);
      if (r.linked) linked++;
      if (r.estimated) estimated++;
      if (r.needsReview) {
        review.push({
          id,
          name: String(rec.fields["Card Name"] || "Card"),
          condition: String(rec.fields["Condition"] || ""),
          before: r.before ?? null,
          after: r.comp as number,
        });
      }
      updated.push({ id, before: r.before ?? null, after: r.comp as number });
    } catch (e: any) {
      skipped.push({ id, reason: String(e?.message || e).slice(0, 120) });
    }
  }

  return NextResponse.json({
    updated: updated.length,
    skipped: skipped.length,
    linked,
    estimated,
    remaining: Math.max(0, all.length - ids.length),
    changes: updated,
    review,
    reasons: skipped.slice(0, 20),
  });
}
