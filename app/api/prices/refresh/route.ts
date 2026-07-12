import { NextResponse } from "next/server";
import { fillRetailPrices, recordSnapshot, tcgcsvBulkRefresh } from "@/lib/priceRefresh";
import { atList, atUpdate, T, AtRecord } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

export const maxDuration = 60;

// Pluggable market price providers, picked via PRICE_PROVIDER env:
//   "tcgcsv"        - DEFAULT, free, no key. tcgcsv.com mirrors TCGplayer's full catalog
//                     (sealed included) with prices refreshed nightly. Matches by product
//                     name against recent Pokemon sets and saves the TCGplayer URL back
//                     onto the record for exact matching on future runs.
//   "pricecharting" - paid API at pricecharting.com, covers sealed Pokemon.
//                     Set PRICECHARTING_TOKEN.
//   "collectr"      - Collectr has an API program (apply at getcollectr.com/api, approval
//                     is at their discretion). Once approved, set COLLECTR_API_KEY and
//                     fill in fetchCollectrPrice below with the endpoint from their docs.



type PriceResult = { matched: string | null; price: number | null };

async function fetchPriceChartingPrice(name: string): Promise<PriceResult> {
  const token = process.env.PRICECHARTING_TOKEN;
  if (!token) throw new Error("PRICECHARTING_TOKEN not set");
  const res = await fetch(
    `https://www.pricecharting.com/api/product?t=${token}&q=${encodeURIComponent("pokemon " + name)}`,
    { cache: "no-store" }
  );
  const data = await res.json();
  const cents = data["new-price"] ?? data["loose-price"]; // sealed = new-price, in pennies
  if (typeof cents === "number" && cents > 0) {
    return { matched: data["product-name"] || name, price: Math.round(cents) / 100 };
  }
  return { matched: null, price: null };
}

async function fetchCollectrPrice(name: string): Promise<PriceResult> {
  const key = process.env.COLLECTR_API_KEY;
  if (!key) throw new Error("COLLECTR_API_KEY not set");
  // TODO once your Collectr API access is approved: their developer docs will give you
  // the product search + price endpoint. Implement here following the PriceCharting
  // pattern above: search by name, return { matched, price } from the market price field.
  throw new Error("Collectr provider not configured yet - see comments in this file");
}

const PROVIDERS: Record<string, (name: string) => Promise<PriceResult>> = {
  pricecharting: fetchPriceChartingPrice,
  collectr: fetchCollectrPrice,
};

export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let providerName = (process.env.PRICE_PROVIDER || "tcgcsv").toLowerCase();
  // graceful fallback: pricecharting configured but no token means use the free provider
  if (providerName === "pricecharting" && !process.env.PRICECHARTING_TOKEN) providerName = "tcgcsv";

  const body = await req.json().catch(() => ({}));
  const rows = await atList(T.inventory, { filterByFormula: "{Active} = TRUE()" });
  const targets: AtRecord[] = body.id ? rows.filter((r) => r.id === body.id) : rows;

  if (providerName === "tcgcsv") {
    try {
      const results = await tcgcsvBulkRefresh(targets);
      await fillRetailPrices(targets);
      await recordSnapshot();
      return NextResponse.json({ provider: providerName, results });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
  }

  const provider = PROVIDERS[providerName];
  if (!provider) {
    return NextResponse.json({ error: `Unknown PRICE_PROVIDER: ${providerName}` }, { status: 400 });
  }
  const results: any[] = [];

  for (const r of targets) {
    const name = r.fields["Product Name"];
    try {
      const { matched, price } = await provider(name);
      if (price !== null) {
        await atUpdate(T.inventory, r.id, { "Market Price": price, "Price Checked": new Date().toISOString().slice(0, 10) });
      }
      results.push({ id: r.id, name, matched, price });
    } catch (e: any) {
      if (results.length === 0) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      results.push({ id: r.id, name, matched: null, price: null });
    }
  }
  return NextResponse.json({ provider: providerName, results });
}
