import { NextResponse } from "next/server";
import { atList, T } from "@/lib/airtable";
import { recordSnapshot, refreshSingleComps, resnapshotOpenLines, tcgcsvBulkRefresh } from "@/lib/priceRefresh";
import { pricingHealth } from "@/lib/pricingHealth";
import { recordAlert } from "@/lib/alerts";

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
  const singles = await refreshSingleComps(150);
  const openLines = await resnapshotOpenLines();
  const snapshot = await recordSnapshot();

  // Checked AFTER the refresh, so it grades the state the refresh actually
  // left behind. An alert is raised rather than an error thrown: the run did
  // its job, the point is that somebody finds out the same morning instead of
  // discovering a month of frozen prices by spot-checking a card by hand.
  let health = null;
  try {
    health = await pricingHealth();
    if (!health.healthy) {
      await recordAlert(
        "price",
        health.canary.ok
          ? `Pricing needs attention: ${health.problems[0]}`
          : "Condition pricing is down - comps are falling back to blended prices",
        { problems: health.problems, canary: health.canary, coverage: health.coverage }
      );
    }
  } catch {
    // the health check is the last thing to run; it must never fail the refresh
  }

  const priced = results.filter((r: any) => r.price !== null).length;
  return NextResponse.json({
    sealed: { priced, total: results.length },
    singles,
    snapshot: { date: snapshot.date, total: snapshot.total },
    openLines,
    health,
    ranAt: new Date().toISOString(),
  });
}
