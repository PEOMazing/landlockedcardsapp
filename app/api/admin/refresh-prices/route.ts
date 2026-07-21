import { NextResponse } from "next/server";
import { atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { refreshSingleComps, resnapshotOpenLines, tcgcsvBulkRefresh } from "@/lib/priceRefresh";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// The same pipeline the nightly cron runs, on demand: sealed markets from the
// TCGplayer mirror, singles comps, and live-board re-snapshots. Admin only -
// no waiting for 3am when prices move during the day.
export async function POST() {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const inventory = await atList(T.inventory, { filterByFormula: "{Active} = TRUE()" });
  const results = await tcgcsvBulkRefresh(inventory);
  const singles = await refreshSingleComps(150);
  const openLines = await resnapshotOpenLines();
  const priced = results.filter((r: any) => r.price !== null).length;
  return NextResponse.json({
    ok: true,
    sealed: { priced, total: results.length },
    singles,
    openLines,
    ranAt: new Date().toISOString(),
  });
}
