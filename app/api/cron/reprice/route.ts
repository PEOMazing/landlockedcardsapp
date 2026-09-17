import { NextResponse } from "next/server";
import { refreshSingleComps } from "@/lib/priceRefresh";
import { listingsCanary } from "@/lib/pricingHealth";
import { recordAlertOnceADay } from "@/lib/alerts";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// The rolling reprice. Runs every 15 minutes and takes the cards that have
// gone longest without a check.
//
// This is what makes the prices current without anyone pressing anything. A
// once-nightly job meant a card hit at 8pm was priced on numbers from that
// morning, and a manual button only helps the person who remembers to press
// it. At this cadence the whole collection turns over in well under an hour.
//
// BATCH is deliberately modest. Two upstream calls per card against somebody
// else's public endpoints, and being a heavy guest is how a free data source
// stops being available. 40 every 15 minutes is ~2.7 cards a minute.
const BATCH = 40;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET) {
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (!String(req.headers.get("user-agent") || "").includes("vercel-cron")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const singles = await refreshSingleComps(BATCH);

  // Cheap shape check on the way past. If condition pricing has silently gone
  // away, every card this job touches from here on is getting a blended
  // number, so it is worth knowing before the next 40 are written.
  let canary = null;
  try {
    canary = await listingsCanary();
    if (!canary.ok) {
      // Deduped in the alerts table, not in memory: this route runs 96 times a
      // day across however many serverless instances Vercel decides to spin up.
      await recordAlertOnceADay("price", "condition-pricing-down", `Condition pricing is down - ${canary.detail}`, { canary });
    }
  } catch {
    // never fail the reprice over its own health check
  }

  return NextResponse.json({ singles, canary, ranAt: new Date().toISOString() });
}
