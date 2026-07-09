import { NextResponse } from "next/server";
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

// ---------------- tcgcsv (free nightly TCGplayer mirror) ----------------
const TCGCSV = "https://tcgcsv.com/tcgplayer/3"; // category 3 = Pokemon
// tcgcsv rejects requests without a real User-Agent (server fetches get 401 otherwise)
const TCGCSV_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; LandLockedCards/1.0; +https://landlockedcards.app)",
  "Accept": "application/json",
};
const MAX_GROUPS_PER_RUN = 30;

const norm = (s: string) =>
  String(s).toLowerCase().replace(/[\u2013\u2014]/g, "-").replace(/[.,'!\u2019]/g, "").replace(/\s+/g, " ").trim();
const tokens = (s: string) =>
  norm(s).split(/[^a-z0-9&]+/).filter((t) => t && !["pokemon", "tcg", "the"].includes(t));

function extractProductId(url: string): number | null {
  const m = String(url || "").match(/\/product\/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

// score a tcgcsv product against an inventory name; higher is better, 0 = no match
function matchScore(invName: string, prodName: string): number {
  const a = norm(invName), b = norm(prodName);
  if (a === b) return 100;
  // tcgcsv name containing the full inventory name is safe; the reverse only counts
  // when the tcgcsv name is most of the inventory name (stops "Sinistea" the card
  // from matching "... Single Pack Blister [Sinistea]" the product)
  if (b.includes(a)) return 80;
  if (a.includes(b) && b.length >= a.length * 0.6) return 70;
  const at = tokens(invName), bt = new Set(tokens(prodName));
  if (at.length === 0) return 0;
  const hit = at.filter((t) => bt.has(t)).length;
  return hit === at.length ? 60 : hit / at.length >= 0.8 ? 40 : 0;
}

async function tcgcsvBulkRefresh(targets: AtRecord[]) {
  const results: any[] = [];
  const pending = new Map<string, AtRecord>(targets.map((r) => [r.id, r]));
  const idByRecord = new Map<string, number>(); // known TCGplayer product ids
  for (const r of targets) {
    const pid = extractProductId(r.fields["TCGplayer URL"]);
    if (pid) idByRecord.set(r.id, pid);
  }

  const groupsRes = await fetch(`${TCGCSV}/groups`, { cache: "no-store", headers: TCGCSV_HEADERS });
  if (!groupsRes.ok) throw new Error(`tcgcsv groups: ${groupsRes.status}`);
  const groups: any[] = (await groupsRes.json()).results || [];

  // pick only groups that plausibly contain our products: shared name tokens with
  // any inventory item, plus the catch-all groups where one-off products live
  const ALWAYS = new Set(["Miscellaneous Cards & Products", "World Championship Decks", "First Partner Pack", "Blister Exclusives"]);
  const productTokenSets = targets.map((r) => new Set(tokens(r.fields["Product Name"])));
  const scored = groups.map((g) => {
    // strip short set-code prefixes like "ME04:", "SV10:", "SWSH12:"
    const stripped = String(g.name).replace(/^[A-Za-z0-9]{1,7}:\s*/, "");
    const gTokens = tokens(stripped);
    let score = 0;
    for (const pt of productTokenSets) {
      const shared = gTokens.filter((t) => pt.has(t));
      const strongNum = shared.some((t) => /^\d{3,}$/.test(t));
      if ((gTokens.length > 0 && shared.length === gTokens.length) || shared.length >= 2 || strongNum) {
        score += shared.length + (strongNum ? 2 : 0);
      }
    }
    return { g, score };
  });
  const candidates = [
    ...scored.filter((x) => ALWAYS.has(x.g.name)).map((x) => x.g),
    ...scored.filter((x) => x.score > 0 && !ALWAYS.has(x.g.name))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_GROUPS_PER_RUN)
      .map((x) => x.g),
  ];

  const priced = new Map<string, { price: number; matched: string; url: string }>();
  // fetch candidate groups in parallel chunks to stay well inside the time limit
  const groupData: { g: any; prods: any[]; prices: any[] }[] = [];
  for (let i = 0; i < candidates.length; i += 4) {
    const chunk = candidates.slice(i, i + 4);
    const settled = await Promise.all(chunk.map(async (g) => {
      try {
        const [pr, pc] = await Promise.all([
          fetch(`${TCGCSV}/${g.groupId}/products`, { cache: "no-store", headers: TCGCSV_HEADERS }),
          fetch(`${TCGCSV}/${g.groupId}/prices`, { cache: "no-store", headers: TCGCSV_HEADERS }),
        ]);
        if (!pr.ok || !pc.ok) return null;
        return { g, prods: (await pr.json()).results || [], prices: (await pc.json()).results || [] };
      } catch { return null; }
    }));
    for (const x of settled) if (x) groupData.push(x);
  }
  for (const { prods, prices } of groupData) {
    const marketById = new Map<number, number>();
    for (const p of prices) {
      if (typeof p.marketPrice === "number" && p.marketPrice > 0 && !marketById.has(p.productId)) {
        marketById.set(p.productId, p.marketPrice);
      }
    }
    for (const [recId, rec] of pending) {
      if (priced.has(recId)) continue;
      const knownId = idByRecord.get(recId);
      let best: any = null, bestScore = 0;
      for (const prod of prods) {
        if (knownId && prod.productId === knownId) { best = prod; bestScore = 100; break; }
        if (knownId) continue; // exact-id records only match their id
        const sc = matchScore(rec.fields["Product Name"], prod.name);
        if (sc > bestScore) { best = prod; bestScore = sc; }
      }
      if (best && bestScore >= 60) {
        const mkt = marketById.get(best.productId);
        if (typeof mkt === "number") {
          priced.set(recId, { price: Math.round(mkt * 100) / 100, matched: best.name, url: best.url || "" });
        }
      }
    }
  }

  for (const [recId, rec] of pending) {
    const hit = priced.get(recId);
    if (hit) {
      const fields: Record<string, any> = {
        "Market Price": hit.price,
        "Price Checked": new Date().toISOString().slice(0, 10),
      };
      if (hit.url && !rec.fields["TCGplayer URL"]) fields["TCGplayer URL"] = hit.url;
      await atUpdate(T.inventory, recId, fields);
    }
    results.push({ id: recId, name: rec.fields["Product Name"], matched: hit?.matched ?? null, price: hit?.price ?? null });
  }
  return results;
}
// -------------------------------------------------------------------------

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

  let providerName = (process.env.PRICE_PROVIDER || "tcgcsv").toLowerCase();
  // graceful fallback: pricecharting configured but no token means use the free provider
  if (providerName === "pricecharting" && !process.env.PRICECHARTING_TOKEN) providerName = "tcgcsv";

  const body = await req.json().catch(() => ({}));
  const rows = await atList(T.inventory, { filterByFormula: "{Active} = TRUE()" });
  const targets: AtRecord[] = body.id ? rows.filter((r) => r.id === body.id) : rows;

  if (providerName === "tcgcsv") {
    try {
      const results = await tcgcsvBulkRefresh(targets);
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
