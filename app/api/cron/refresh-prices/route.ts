import { NextResponse } from "next/server";
import { atList, T } from "@/lib/airtable";
import { fillRetailPrices, refreshSingleComps, tcgcsvBulkRefresh } from "@/lib/priceRefresh";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Nightly price refresh, triggered by Vercel Cron (see vercel.json).
// Sealed market prices from the TCGplayer mirror, MSRP autofill for blanks,
// and fresh condition comps for in-stock raw singles.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET) {
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (!String(req.headers.get("user-agent") || "").includes("vercel-cron")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const inventory = await atList(T.inventory, { filterByFormula: "{Active} = TRUE()" });
  const results = await tcgcsvBulkRefresh(inventory);
  const retailFilled = await fillRetailPrices(inventory);
  const singles = await refreshSingleComps(50);
  const priced = results.filter((r: any) => r.price !== null).length;
  return NextResponse.json({
    sealed: { priced, total: results.length },
    retailFilled,
    singles,
    ranAt: new Date().toISOString(),
  });
}
