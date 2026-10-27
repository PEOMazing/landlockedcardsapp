import { NextResponse } from "next/server";
import { atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { bucketFor } from "@/lib/cardNo";
import { recompSingle } from "@/lib/comp";
import { isSlab } from "@/lib/slab";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// cb-v1. What switching the comp basis would do, without doing it.
//
// Asked for before the switch rather than after, and the reason is the second
// order effect rather than the prices themselves. A comp is what decides a
// card's price BAND, the band is the letter printed on its sticker, and a card
// whose band moves needs a new sticker and a new pocket. Flipping the basis
// across the binder and only then discovering that two hundred cards want
// reprinting is a bad afternoon. So: run the new rule over everything, write
// nothing, and count the stickers.
//
// Runs in batches because each card is upstream lookups and there are around
// nine hundred of them. The caller walks it with ?after= until done is true.
//
// Nothing here writes. recompSingle is pure with respect to Airtable - it
// returns the fields it WOULD set and the caller does the writing - so a
// preview is just that call with the result read instead of saved.
const TIME_BUDGET_MS = 240_000;
const EXPECTED_CARD_MS = 4_000;

export async function GET(req: Request) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get("limit") || "") || 80));
  const after = parseInt(url.searchParams.get("after") || "") || 0;

  const rows = await atList(T.singles, {
    filterByFormula: "AND({Card Name} != '', OR({Status} = 'In Stock', {Status} = 'In Stream'))",
  }).catch(() => [] as any[]);

  // Raw, unlocked, and in a stable order so the cursor means something.
  const pool = (rows as any[])
    .filter((r) => !isSlab(String(r.fields["Condition"] || "")))
    .filter((r) => !r.fields["Comp Locked"])
    .map((r) => ({ r, no: Number(r.fields["Card No"]) || 0 }))
    .sort((a, b) => a.no - b.no)
    .filter((x) => x.no > after);

  const batch = pool.slice(0, limit);
  const startedAt = Date.now();

  let checked = 0;
  let moved = 0;
  let rebanded = 0;
  let failed = 0;
  let oldTotal = 0;
  let newTotal = 0;
  const bigMoves: any[] = [];
  const bands: any[] = [];
  const basisMix: Record<string, number> = { market: 0, sales: 0, other: 0 };
  let last = after;

  for (const { r, no } of batch) {
    if (Date.now() - startedAt > TIME_BUDGET_MS - EXPECTED_CARD_MS) break;
    last = no;
    const before = typeof r.fields["Comp"] === "number" ? r.fields["Comp"] : null;

    let res;
    try {
      res = await recompSingle(r, { marketBasis: true });
    } catch {
      failed++;
      continue;
    }
    if (!res.ok) { failed++; continue; }

    checked++;
    const after$ = Number(res.comp) || 0;
    const src = String(res.fields?.["Comp Source"] || "");
    basisMix[src.includes("market") ? "market" : src.includes("solds") ? "sales" : "other"]++;

    if (before !== null) oldTotal += before;
    newTotal += after$;

    const bandBefore = bucketFor(before);
    const bandAfter = bucketFor(after$);
    if (bandBefore !== bandAfter) {
      rebanded++;
      if (bands.length < 60) {
        bands.push({
          no, name: r.fields["Card Name"], cond: r.fields["Condition"],
          before, after: after$, from: bandBefore, to: bandAfter,
        });
      }
    }

    if (before !== null && before !== after$) {
      moved++;
      const delta = after$ - before;
      if (Math.abs(delta) >= 5 && bigMoves.length < 60) {
        bigMoves.push({
          no, name: r.fields["Card Name"], set: r.fields["Set Name"], cond: r.fields["Condition"],
          before, after: after$, delta: Math.round(delta * 100) / 100, source: src.slice(0, 80),
        });
      }
    }
  }

  const remaining = pool.length - checked;
  return NextResponse.json({
    dryRun: true,
    checked, failed, moved, rebanded,
    // The two totals are over the SAME cards - only the ones this batch
    // actually priced - so they can be compared directly.
    oldTotal: Math.round(oldTotal * 100) / 100,
    newTotal: Math.round(newTotal * 100) / 100,
    delta: Math.round((newTotal - oldTotal) * 100) / 100,
    basisMix,
    bigMoves: bigMoves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    bands,
    cursor: last,
    remaining,
    done: remaining <= 0,
  });
}
