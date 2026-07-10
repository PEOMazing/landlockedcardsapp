import { PokeCard } from "./pokemon";

// Card search over tcgcsv.com, the nightly TCGplayer mirror. This covers the
// newest sets months before pokemontcg.io does, with market prices included.
// tcgcsv has no search endpoint (static files per set), so we load the most
// recent sets and filter in memory; warm serverless instances cache for 12h.

const TCGCSV = "https://tcgcsv.com/tcgplayer/3";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; LandLockedCards/1.0; +https://landlockedcards.app)",
  "Accept": "application/json",
};
const TTL = 1000 * 60 * 60 * 12;
const RECENT_SETS = 16;

type GroupCache = { at: number; prods: any[]; market: Map<number, number> };
const cache: { groups?: { at: number; data: any[] }; byGroup: Map<number, GroupCache> } = {
  byGroup: new Map(),
};

async function jget(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store", headers: HEADERS });
  if (!res.ok) throw new Error(`tcgcsv ${url}: ${res.status}`);
  return res.json();
}

async function allGroups(): Promise<any[]> {
  if (cache.groups && Date.now() - cache.groups.at < TTL) return cache.groups.data;
  const data = (await jget(`${TCGCSV}/groups`)).results || [];
  cache.groups = { at: Date.now(), data };
  return data;
}

async function recentGroups(): Promise<any[]> {
  const groups = await allGroups();
  // publishedOn is unreliable on tcgcsv (ancient sets carry far-future placeholder
  // dates), but groupId increments with catalog age, so newest sets sort last-in
  return groups
    .filter((g) => !g.isSupplemental)
    .sort((a, b) => (b.groupId || 0) - (a.groupId || 0))
    .slice(0, RECENT_SETS);
}

async function loadGroup(g: any): Promise<GroupCache | null> {
  const hit = cache.byGroup.get(g.groupId);
  if (hit && Date.now() - hit.at < TTL) return hit;
  try {
    const [pd, pc] = await Promise.all([
      jget(`${TCGCSV}/${g.groupId}/products`),
      jget(`${TCGCSV}/${g.groupId}/prices`),
    ]);
    const market = new Map<number, number>();
    for (const p of pc.results || []) {
      if (typeof p.marketPrice === "number" && p.marketPrice > 0 && !market.has(p.productId)) {
        market.set(p.productId, p.marketPrice);
      }
    }
    const entry = { at: Date.now(), prods: pd.results || [], market };
    cache.byGroup.set(g.groupId, entry);
    return entry;
  } catch {
    return null;
  }
}

const ext = (p: any, key: string): string => {
  const e = (p.extendedData || []).find((x: any) => x.name === key);
  return e ? String(e.value) : "";
};

// cards carry Number/Rarity in extendedData; sealed product does not
const isCard = (p: any) => !!ext(p, "Number") || !!ext(p, "Rarity");

function toCard(p: any, g: any, market: number | undefined): PokeCard {
  return {
    id: `tcg:${p.productId}:${g.groupId}`,
    name: p.name,
    number: (ext(p, "Number") || "").split("/")[0],
    rarity: ext(p, "Rarity"),
    setId: String(g.groupId),
    setName: g.name.replace(/^[A-Za-z0-9]{1,7}:\s*/, ""),
    image: p.imageUrl || "",
    imageLarge: (p.imageUrl || "").replace("_200w", "_400w"),
    market: typeof market === "number" ? Math.round(market * 100) / 100 : null,
    variant: "TCGplayer",
    priceUpdated: null,
  };
}

const norm = (s: string) => String(s).toLowerCase().replace(/[.,'!]/g, "").replace(/\s+/g, " ").trim();

export async function searchTcgcsvCards(q: string): Promise<PokeCard[]> {
  const term = norm(q);
  if (!term) return [];
  const qTokens = term.split(" ").filter(Boolean);
  const groups = await recentGroups();
  const out: PokeCard[] = [];

  for (let i = 0; i < groups.length; i += 4) {
    const chunk = await Promise.all(groups.slice(i, i + 4).map((g) => loadGroup(g).then((d) => ({ g, d }))));
    for (const { g, d } of chunk) {
      if (!d) continue;
      for (const p of d.prods) {
        if (!isCard(p) || String(p.name).startsWith("Code Card")) continue;
        const n = norm(p.name);
        if (!qTokens.every((t) => n.includes(t))) continue;
        out.push(toCard(p, g, d.market.get(p.productId)));
        if (out.length >= 60) break;
      }
      if (out.length >= 60) break;
    }
  }
  // priced cards first: presale sets have no market yet and make bad picks
  out.sort((a, b) => Number(b.market !== null) - Number(a.market !== null));
  return out.slice(0, 30);
}

export async function getTcgcsvCard(id: string): Promise<PokeCard | null> {
  const m = String(id).match(/^tcg:(\d+):(\d+)$/);
  if (!m) return null;
  const productId = parseInt(m[1]), groupId = parseInt(m[2]);
  const g = (await allGroups()).find((x) => x.groupId === groupId);
  if (!g) return null;
  const d = await loadGroup(g);
  if (!d) return null;
  const p = d.prods.find((x) => x.productId === productId);
  return p ? toCard(p, g, d.market.get(productId)) : null;
}

// ---- per-condition comps from TCGplayer latest sales ----
// mpapi.tcgplayer.com serves the site's own sold-transaction feed. The median
// of recent sales in the chosen condition is the truest comp available; if a
// condition has no recent sales we fall back to a discount off NM market.
const CONDITION_NAMES: Record<string, string> = {
  NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played",
  HP: "Heavily Played", DM: "Damaged", Raw: "Near Mint",
};
// TCGplayer condition ids for server-side filtering of the sales feed
const CONDITION_IDS: Record<string, number> = { NM: 1, Raw: 1, LP: 2, MP: 3, HP: 4, DM: 5 };
const MAX_SALE_AGE_DAYS = 90; // older sales are too stale to anchor a comp

export type SoldSale = { date: string; price: number; qty: number };

export async function conditionSoldComp(
  productId: number,
  condition: string
): Promise<{ price: number; sales: number; detail: SoldSale[] } | null> {
  const condId = CONDITION_IDS[condition];
  if (!condId) return null;
  try {
    const res = await fetch(`https://mpapi.tcgplayer.com/v2/product/${productId}/latestsales`, {
      method: "POST",
      cache: "no-store",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ conditions: [condId], languages: [1], variants: [], listingType: "All", limit: 25 }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const cutoff = Date.now() - MAX_SALE_AGE_DAYS * 24 * 60 * 60 * 1000;
    const recent: SoldSale[] = (d?.data || [])
      .filter((x: any) =>
        typeof x.purchasePrice === "number" && x.purchasePrice > 0 &&
        x.orderDate && new Date(x.orderDate).getTime() >= cutoff)
      .slice(0, 10)
      .map((x: any) => ({ date: String(x.orderDate).slice(0, 10), price: x.purchasePrice, qty: x.quantity || 1 }));
    if (recent.length === 0) return null;
    const sorted = recent.map((x) => x.price).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return { price: Math.round(median * 100) / 100, sales: recent.length, detail: recent };
  } catch {
    return null;
  }
}

export function tcgProductIdFromCardId(id: string): number | null {
  const m = String(id).match(/^tcg:(\d+):(\d+)$/);
  return m ? parseInt(m[1]) : null;
}


// ---------------- vintage printings ----------------
// pokemontcg.io returns one printing-ambiguous price for pre-2003 sets, so
// per-printing prices come straight from the TCGplayer groups. Base Set is
// split across two groups: 604 is the standard Unlimited run, and 1663
// "Base Set (Shadowless)" holds the early run, where 1st Edition subtypes are
// the stamped print and everything else is the no-stamp Shadowless print.
// Every other 1st-edition-era set keeps both printings in one group.
export const PRINTING_ORDER = ["1st Edition", "Shadowless", "Unlimited"];

const VINTAGE_GROUPS: Record<string, { groupId: number; base: string }[]> = {
  base1: [
    { groupId: 604, base: "Unlimited" },
    { groupId: 1663, base: "Shadowless" },
  ],
  base2: [{ groupId: 635, base: "Unlimited" }],
  base3: [{ groupId: 630, base: "Unlimited" }],
  base5: [{ groupId: 1373, base: "Unlimited" }],
  gym1: [{ groupId: 1441, base: "Unlimited" }],
  gym2: [{ groupId: 1440, base: "Unlimited" }],
  neo1: [{ groupId: 1396, base: "Unlimited" }],
  neo2: [{ groupId: 1434, base: "Unlimited" }],
  neo3: [{ groupId: 1389, base: "Unlimited" }],
  neo4: [{ groupId: 1444, base: "Unlimited" }],
};

export const isVintageSet = (setId: string): boolean => !!VINTAGE_GROUPS[setId];

// "004/102", "4/102", and "4" all become "4" so pokemontcg.io card numbers
// line up with TCGplayer extendedData numbers
export function printingKey(rawNumber: string): string {
  const n = String(rawNumber || "").split("/")[0].trim();
  const i = parseInt(n, 10);
  return isNaN(i) ? n.toLowerCase() : String(i);
}

export type PrintingPrice = { label: string; market: number | null };

const vintageCache = new Map<string, { at: number; data: Map<string, PrintingPrice[]> }>();

export async function vintagePrintings(setId: string): Promise<Map<string, PrintingPrice[]> | null> {
  const groups = VINTAGE_GROUPS[setId];
  if (!groups) return null;
  const hit = vintageCache.get(setId);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  // number -> printing label -> best market price
  const byNum = new Map<string, Map<string, number>>();
  for (const { groupId, base } of groups) {
    try {
      const [pd, pc] = await Promise.all([
        jget(`${TCGCSV}/${groupId}/products`),
        jget(`${TCGCSV}/${groupId}/prices`),
      ]);
      const numById = new Map<number, string>();
      for (const prod of pd.results || []) {
        if (!isCard(prod)) continue;
        const key = printingKey(ext(prod, "Number"));
        if (key) numById.set(prod.productId, key);
      }
      for (const row of pc.results || []) {
        if (!(typeof row.marketPrice === "number" && row.marketPrice > 0)) continue;
        const key = numById.get(row.productId);
        if (!key) continue;
        const label = String(row.subTypeName || "").startsWith("1st Edition") ? "1st Edition" : base;
        const m = byNum.get(key) || new Map<string, number>();
        m.set(label, Math.max(m.get(label) || 0, row.marketPrice));
        byNum.set(key, m);
      }
    } catch {
      // one group failing should not blank the whole set
    }
  }

  const data = new Map<string, PrintingPrice[]>();
  for (const [key, m] of byNum) {
    const list = [...m.entries()]
      .map(([label, market]) => ({ label, market: Math.round(market * 100) / 100 }))
      .sort((a, b) => PRINTING_ORDER.indexOf(a.label) - PRINTING_ORDER.indexOf(b.label));
    data.set(key, list);
  }
  vintageCache.set(setId, { at: Date.now(), data });
  return data;
}
