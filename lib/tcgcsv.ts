import { PokeCard } from "./pokemon";

// tcgcsv.com mirrors TCGplayer's full catalog nightly, including sets that
// pokemontcg.io has not caught up on yet. This client searches single cards
// across the newest sets and hydrates picks for the singles inventory.
// Card ids are namespaced "tcgcsv-{groupId}-{productId}" so the singles API
// can route hydration to the right source.

const TCGCSV = "https://tcgcsv.com/tcgplayer/3"; // category 3 = Pokemon
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; LandLockedCards/1.0; +https://landlockedcards.app)",
  "Accept": "application/json",
};
const RECENT_GROUPS = 10; // newest sets searched for singles
const TTL = 1000 * 60 * 60 * 12;

const cache: {
  groups?: { at: number; data: any[] };
  group: Map<number, { at: number; cards: PokeCard[] }>;
} = { group: new Map() };

const norm = (x: string) => String(x).toLowerCase().replace(/\s+/g, " ").trim();
const stripPrefix = (name: string) => String(name).replace(/^[A-Za-z0-9]{1,7}:\s*/, "");

async function jget(path: string): Promise<any> {
  const res = await fetch(`${TCGCSV}${path}`, { cache: "no-store", headers: HEADERS });
  if (!res.ok) throw new Error(`tcgcsv ${path}: ${res.status}`);
  return res.json();
}

async function getGroups(): Promise<any[]> {
  if (cache.groups && Date.now() - cache.groups.at < TTL) return cache.groups.data;
  const data = (await jget("/groups")).results || [];
  cache.groups = { at: Date.now(), data };
  return data;
}

// single cards have a Number in extendedData; sealed product does not
function isCard(p: any): boolean {
  return Array.isArray(p.extendedData) && p.extendedData.some((d: any) => d.name === "Number");
}

function ext(p: any, key: string): string {
  const d = (p.extendedData || []).find((x: any) => x.name === key);
  return d?.value || "";
}

async function loadGroupCards(g: any): Promise<PokeCard[]> {
  const hit = cache.group.get(g.groupId);
  if (hit && Date.now() - hit.at < TTL) return hit.cards;
  const [prods, prices] = await Promise.all([
    jget(`/${g.groupId}/products`),
    jget(`/${g.groupId}/prices`),
  ]);
  const marketById = new Map<number, { price: number; sub: string }>();
  for (const p of prices.results || []) {
    if (typeof p.marketPrice === "number" && p.marketPrice > 0 && !marketById.has(p.productId)) {
      marketById.set(p.productId, { price: p.marketPrice, sub: p.subTypeName || "" });
    }
  }
  const setName = stripPrefix(g.name);
  const cards: PokeCard[] = (prods.results || []).filter(isCard).map((p: any) => {
    const m = marketById.get(p.productId);
    return {
      id: `tcgcsv-${g.groupId}-${p.productId}`,
      name: p.name,
      number: ext(p, "Number").split("/")[0] || "",
      rarity: ext(p, "Rarity"),
      setId: `tcgcsv-${g.groupId}`,
      setName,
      image: p.imageUrl || "",
      imageLarge: p.imageUrl ? String(p.imageUrl).replace("_200w", "_400w") : "",
      market: m ? Math.round(m.price * 100) / 100 : null,
      variant: m?.sub || null,
      priceUpdated: null,
    };
  });
  cache.group.set(g.groupId, { at: Date.now(), cards });
  return cards;
}

// search single cards across the newest sets (the ones pokemontcg.io lags on)
export async function searchRecentTcgcsvCards(q: string): Promise<PokeCard[]> {
  const term = norm(q);
  if (!term) return [];
  const groups = (await getGroups())
    .filter((g: any) => !g.isSupplemental)
    .sort((a: any, b: any) => String(b.publishedOn || "").localeCompare(String(a.publishedOn || "")))
    .slice(0, RECENT_GROUPS);
  const out: PokeCard[] = [];
  for (let i = 0; i < groups.length; i += 4) {
    const chunk = groups.slice(i, i + 4);
    const loaded = await Promise.all(chunk.map((g: any) => loadGroupCards(g).catch(() => [] as PokeCard[])));
    for (const cards of loaded) {
      for (const c of cards) {
        if (norm(c.name).includes(term)) out.push(c);
      }
    }
  }
  return out.slice(0, 30);
}

export function isTcgcsvCardId(id: string): boolean {
  return /^tcgcsv-\d+-\d+$/.test(String(id));
}

export async function getTcgcsvCard(id: string): Promise<PokeCard | null> {
  const m = String(id).match(/^tcgcsv-(\d+)-(\d+)$/);
  if (!m) return null;
  const groupId = parseInt(m[1]);
  const groups = await getGroups();
  const g = groups.find((x: any) => x.groupId === groupId);
  if (!g) return null;
  const cards = await loadGroupCards(g);
  return cards.find((c) => c.id === id) || null;
}
