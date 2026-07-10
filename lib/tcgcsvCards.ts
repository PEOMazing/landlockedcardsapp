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
const RECENT_SETS = 14;

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
  return groups
    .filter((g) => !g.isSupplemental)
    .sort((a, b) => String(b.publishedOn || "").localeCompare(String(a.publishedOn || "")))
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
        if (!isCard(p)) continue;
        const n = norm(p.name);
        if (!qTokens.every((t) => n.includes(t))) continue;
        out.push(toCard(p, g, d.market.get(p.productId)));
        if (out.length >= 30) return out;
      }
    }
  }
  return out;
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
