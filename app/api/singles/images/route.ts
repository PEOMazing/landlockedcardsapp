import { NextResponse } from "next/server";
import { T, atList, atUpdate } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { findCardImage } from "@/lib/cardImage";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Fill in missing card art, for every single that has none.
//
// Separate from the reprice on purpose. A card that cannot be priced still
// needs a picture: the sticker's QR is a point of sale, and a scan that opens
// a page with no card on it looks broken to whoever is holding the card,
// whatever the pricing engine thinks of it.
//
// Runs in bounded batches because it is doing upstream lookups per card, and
// reports what is left so the caller can decide whether to go again.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({} as any));
  const limit = Math.min(Math.max(parseInt(body?.limit) || 40, 1), 120);

  const rows = await atList(T.singles);
  const missing = rows.filter((r) => !String(r.fields["Image URL"] || "").trim());
  const batch = missing.slice(0, limit);

  let filled = 0;
  const stillBlank: string[] = [];
  for (const rec of batch) {
    let hit = null;
    try {
      hit = await findCardImage(rec);
    } catch {
      hit = null;
    }
    if (hit?.url) {
      try {
        await atUpdate(T.singles, rec.id, { "Image URL": hit.url });
        filled++;
        continue;
      } catch {
        // a write failing is not a reason to stop the batch
      }
    }
    stillBlank.push(String(rec.fields["Set Name"] || "?") + " " + String(rec.fields["Card Number"] || ""));
  }

  return NextResponse.json({
    checked: batch.length,
    filled,
    missingBefore: missing.length,
    remaining: Math.max(0, missing.length - filled),
    stillBlank: stillBlank.slice(0, 40),
  });
}
