import { NextResponse } from "next/server";
import { atList, atUpdate, T, AtRecord } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

// Pluggable market price providers.
// TCGplayer's API is closed to new developers, so pick via PRICE_PROVIDER env:
//   "pricecharting" - live today. Paid API at pricecharting.com, covers sealed Pokemon.
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
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const providerName = (process.env.PRICE_PROVIDER || "pricecharting").toLowerCase();
  const provider = PROVIDERS[providerName];
  if (!provider) {
    return NextResponse.json({ error: `Unknown PRICE_PROVIDER: ${providerName}` }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const rows = await atList(T.inventory, { filterByFormula: "{Active} = TRUE()" });
  const targets: AtRecord[] = body.id ? rows.filter((r) => r.id === body.id) : rows;
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
