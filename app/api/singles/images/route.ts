import { NextResponse } from "next/server";
import { T, atList, atUpdate } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { findCardImage, imageMismatch } from "@/lib/cardImage";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Card art maintenance: fill in what is missing, and replace what is wrong.
//
// Separate from the reprice on purpose. A card that cannot be priced still
// needs a picture: the sticker's QR is a point of sale, and a scan that opens
// a page with no card on it looks broken to whoever is holding the card,
// whatever the pricing engine thinks of it.
//
// Two jobs, because they fail differently:
//
//   fill    - the record has no image at all. Any art we can find beats none,
//             so this accepts the loose by-name match.
//   repair  - the record has art belonging to a different product than its
//             Card ID names. This one only accepts art read straight off the
//             Card ID. A wrong picture replaced by a differently wrong picture
//             is not a fix, and the loose resolver is exactly what would do
//             that, so repair refuses anything it cannot read from the link.
//
// Runs in bounded batches because it is doing upstream lookups per card, and
// reports what is left so the caller can decide whether to go again.
export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({} as any));
  const limit = Math.min(Math.max(parseInt(body?.limit) || 40, 1), 120);
  const mode: "fill" | "repair" | "all" =
    body?.mode === "repair" || body?.mode === "all" ? body.mode : "fill";

  const rows = await atList(T.singles);

  const missing = rows.filter((r) => !String(r.fields["Image URL"] || "").trim());
  const wrong = rows.filter((r) =>
    imageMismatch(String(r.fields["Image URL"] || ""), String(r.fields["Card ID"] || "")),
  );

  // Repairs go first in "all". They are the ones a customer is actively being
  // shown the wrong card for, and the batch limit should spend itself there
  // before it goes looking for art that was merely absent.
  const queue =
    mode === "fill" ? missing.map(tag("fill"))
    : mode === "repair" ? wrong.map(tag("repair"))
    : [...wrong.map(tag("repair")), ...missing.map(tag("fill"))];

  const batch = queue.slice(0, limit);

  let filled = 0;
  let repaired = 0;
  const stillBlank: string[] = [];
  const stillWrong: string[] = [];
  const changed: { cardNo: string; name: string; from: string; to: string }[] = [];

  for (const { rec, job } of batch) {
    const before = String(rec.fields["Image URL"] || "");

    let hit = null;
    try {
      hit = await findCardImage(rec);
    } catch {
      hit = null;
    }

    // Repair trusts the Card ID and nothing else.
    const usable = hit?.url && (job === "fill" || hit.source === "card-id") ? hit : null;

    if (usable && usable.url !== before) {
      try {
        await atUpdate(T.singles, rec.id, { "Image URL": usable.url });
        if (job === "repair") {
          repaired++;
          changed.push({
            cardNo: String(rec.fields["Card No"] ?? ""),
            name: String(rec.fields["Card Name"] || "?"),
            from: before,
            to: usable.url,
          });
        } else {
          filled++;
        }
        continue;
      } catch {
        // a write failing is not a reason to stop the batch
      }
    }

    const label = String(rec.fields["Set Name"] || "?") + " " + String(rec.fields["Card Number"] || "");
    if (job === "repair") stillWrong.push(label);
    else stillBlank.push(label);
  }

  return NextResponse.json({
    mode,
    checked: batch.length,
    filled,
    repaired,
    missingBefore: missing.length,
    wrongBefore: wrong.length,
    remaining: Math.max(0, queue.length - filled - repaired),
    stillBlank: stillBlank.slice(0, 40),
    stillWrong: stillWrong.slice(0, 40),
    changed: changed.slice(0, 40),
  });
}

const tag = (job: "fill" | "repair") => (rec: any) => ({ rec, job });
