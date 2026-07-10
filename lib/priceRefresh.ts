import { atCreate, atList, atUpdate, T, AtRecord } from "./airtable";
import { conditionSoldComp, tcgProductIdFromCardId } from "./tcgcsvCards";

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

export async function tcgcsvBulkRefresh(targets: AtRecord[]) {
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

  const priced = new Map<string, { price: number; matched: string; url: string; image: string }>();
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
          priced.set(recId, { price: Math.round(mkt * 100) / 100, matched: best.name, url: best.url || "", image: best.imageUrl || "" });
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
      if (hit.image && !rec.fields["Image URL"]) fields["Image URL"] = hit.image;
      await atUpdate(T.inventory, recId, fields);
    }
    results.push({ id: recId, name: rec.fields["Product Name"], matched: hit?.matched ?? null, price: hit?.price ?? null });
  }
  return results;
}
// -------------------------------------------------------------------------

// ---------------- retail (MSRP) autofill ----------------
// Walmart-fulfilled Pokemon sells at MSRP, so a category table gives the same
// numbers with no scraping. Only fills blanks; hand edits are never touched.
export function msrpFor(name: string, category: string): number | null {
  const n = String(name).toLowerCase();
  if (n.includes("ultra premium")) return 119.99;
  if (category === "Super Premium Collection") return 79.99;
  if (category === "Booster Pack") return 4.49;
  if (category === "Booster Bundle") return 26.94;
  if (category === "Elite Trainer Box") return n.includes("pokemon center") ? 54.99 : 49.99;
  if (category === "Booster Box") return 161.64;
  return null; // collections, tins, blisters vary too much - enter by hand
}

export async function fillRetailPrices(targets: AtRecord[]): Promise<number> {
  let filled = 0;
  for (const r of targets) {
    if (r.fields["Retail Price"] !== undefined && r.fields["Retail Price"] !== null) continue;
    const msrp = msrpFor(r.fields["Product Name"] || "", r.fields["Category"]?.name || r.fields["Category"] || "");
    if (msrp === null) continue;
    try {
      await atUpdate(T.inventory, r.id, { "Retail Price": msrp });
      filled++;
    } catch {}
  }
  return filled;
}

// ---------------- nightly singles comp refresh ----------------
// re-comps raw in-stock singles from fresh condition sales, capped per run
export async function refreshSingleComps(cap = 50): Promise<{ updated: number; checked: number }> {
  const RAWISH = new Set(["Raw", "NM", "LP", "MP", "HP", "DM"]);
  let rows: AtRecord[] = [];
  try {
    rows = await atList(T.singles, {
      filterByFormula: "AND({Status} = 'In Stock', NOT({Card ID} = BLANK()))",
    });
  } catch {
    return { updated: 0, checked: 0 };
  }
  let updated = 0, checked = 0;
  for (const rec of rows) {
    if (checked >= cap) break;
    const cond = String(rec.fields["Condition"] || "Raw");
    if (!RAWISH.has(cond)) continue;
    const pid = tcgProductIdFromCardId(String(rec.fields["Card ID"] || ""));
    if (!pid) continue;
    checked++;
    const sold = await conditionSoldComp(pid, cond);
    if (!sold) continue;
    try {
      await atUpdate(T.singles, rec.id, {
        "Comp": sold.price,
        "Comp Source": `TCGplayer solds (${cond}, median of ${sold.sales})`,
        "Comp Date": new Date().toISOString().slice(0, 10),
        "Comp Detail": JSON.stringify(sold.detail),
      });
      updated++;
    } catch {}
  }
  return { updated, checked };
}


// ---------------- nightly portfolio snapshots ----------------
// One record per day capturing total value and per-item prices, written after
// each reprice. Powers the trend chart, day-over-day deltas, and top movers.
export type SnapItem = { n: string; p: number; img?: string };
export type Snapshot = {
  date: string;
  total: number;
  sealed: number;
  singles: number;
  items: Record<string, SnapItem>;
};

export async function recordSnapshot(): Promise<Snapshot> {
  const [inventory, singlesRows] = await Promise.all([
    atList(T.inventory, { filterByFormula: "{Active} = TRUE()" }),
    atList(T.singles, { filterByFormula: "NOT({Status} = 'Sold')" }),
  ]);
  const items: Record<string, SnapItem> = {};
  let sealed = 0, singles = 0;
  for (const r of inventory) {
    const qty = r.fields["Qty On Hand"] ?? 0;
    const m = r.fields["Market Price"] ?? 0;
    sealed += m * qty;
    if (m > 0) items[`i:${r.id}`] = { n: r.fields["Product Name"] || "", p: m, img: r.fields["Image URL"] || undefined };
  }
  for (const r of singlesRows) {
    const qty = r.fields["Qty"] ?? 1;
    const c = r.fields["Comp"] ?? 0;
    singles += c * qty;
    if (c > 0) items[`s:${r.id}`] = { n: r.fields["Card Name"] || "", p: c, img: r.fields["Image URL"] || undefined };
  }
  const snap: Snapshot = {
    date: new Date().toISOString().slice(0, 10),
    total: Math.round((sealed + singles) * 100) / 100,
    sealed: Math.round(sealed * 100) / 100,
    singles: Math.round(singles * 100) / 100,
    items,
  };
  const existing = await atList(T.snapshots, { filterByFormula: `{Date} = '${snap.date}'` }).catch(() => []);
  const fields = {
    "Date": snap.date,
    "Total Market": snap.total,
    "Sealed Market": snap.sealed,
    "Singles Market": snap.singles,
    "Items": JSON.stringify(snap.items),
  };
  if (existing[0]) await atUpdate(T.snapshots, existing[0].id, fields);
  else await atCreate(T.snapshots, fields);
  return snap;
}

export async function getSnapshots(n = 30): Promise<Snapshot[]> {
  const rows = await atList(T.snapshots, {
    "sort[0][field]": "Date",
    "sort[0][direction]": "desc",
    maxRecords: String(n),
  }).catch(() => []);
  return rows
    .map((r) => {
      let items: Record<string, SnapItem> = {};
      try { items = r.fields["Items"] ? JSON.parse(r.fields["Items"]) : {}; } catch {}
      return {
        date: r.fields["Date"] || "",
        total: r.fields["Total Market"] ?? 0,
        sealed: r.fields["Sealed Market"] ?? 0,
        singles: r.fields["Singles Market"] ?? 0,
        items,
      };
    })
    .reverse();
}

// biggest per-item price changes between two snapshots
export function topMovers(prev: Snapshot, latest: Snapshot, count = 3) {
  const moves: { key: string; n: string; img?: string; from: number; to: number; delta: number; pct: number }[] = [];
  for (const [key, cur] of Object.entries(latest.items)) {
    const old = prev.items[key];
    if (!old || old.p <= 0) continue;
    const delta = Math.round((cur.p - old.p) * 100) / 100;
    if (delta === 0) continue;
    moves.push({ key, n: cur.n, img: cur.img, from: old.p, to: cur.p, delta, pct: Math.round((delta / old.p) * 1000) / 10 });
  }
  moves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return moves.slice(0, count);
}
