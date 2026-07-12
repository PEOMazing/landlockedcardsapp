// Pokemon TCG API (pokemontcg.io v2) client.
// Free API. Works without a key at low rate limits; set POKEMONTCG_API_KEY
// (free signup at dev.pokemontcg.io) for 20k requests/day.
// Card records carry TCGplayer market prices, which we use as raw-card comps.

const API = "https://api.pokemontcg.io/v2";

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.POKEMONTCG_API_KEY) h["X-Api-Key"] = process.env.POKEMONTCG_API_KEY;
  return h;
}

export type PokeSet = {
  id: string;
  name: string;
  series: string;
  releaseDate: string;
  total: number;
  symbol?: string;
  logo?: string;
};

export type PokeCard = {
  id: string;
  name: string;
  number: string;
  rarity: string;
  setId: string;
  setName: string;
  image?: string;
  imageLarge?: string;
  market: number | null;
  variant: string | null;
  priceUpdated: string | null;
  printings?: { label: string; market: number | null }[];
};

// serverless best-effort caches: warm instances skip refetching
const cache: { sets?: { at: number; data: PokeSet[] }; cards: Map<string, { at: number; data: PokeCard[] }> } = {
  cards: new Map(),
};
const TTL = 1000 * 60 * 60 * 12; // 12 hours

async function pget(path: string, params: Record<string, string>): Promise<any> {
  const q = new URLSearchParams(params);
  const res = await fetch(`${API}${path}?${q}`, { headers: headers(), next: { revalidate: 86400 } });
  if (!res.ok) throw new Error(`pokemontcg.io ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function pgetAll(path: string, params: Record<string, string>): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  while (true) {
    const d = await pget(path, { ...params, page: String(page), pageSize: "250" });
    out.push(...(d.data || []));
    if (out.length >= (d.totalCount || 0) || (d.data || []).length === 0) break;
    page++;
    if (page > 20) break; // safety
  }
  return out;
}

// Pull the best market price off a card's tcgplayer block. Cards can have
// several print variants; prefer the premium print since that is what we
// typically stock as singles.
export function extractMarket(card: any): { market: number | null; variant: string | null; updated: string | null } {
  const prices = card?.tcgplayer?.prices;
  if (!prices) return { market: null, variant: null, updated: null };
  const order = ["holofoil", "reverseHolofoil", "normal", "1stEditionHolofoil", "1stEditionNormal", "unlimitedHolofoil"];
  const keys = [...order.filter((k) => prices[k]), ...Object.keys(prices).filter((k) => !order.includes(k))];
  for (const k of keys) {
    const m = prices[k]?.market ?? prices[k]?.mid ?? null;
    if (typeof m === "number" && m > 0) {
      return { market: Math.round(m * 100) / 100, variant: k, updated: card?.tcgplayer?.updatedAt || null };
    }
  }
  return { market: null, variant: null, updated: card?.tcgplayer?.updatedAt || null };
}

function toCard(c: any): PokeCard {
  const p = extractMarket(c);
  return {
    id: c.id,
    name: c.name,
    number: c.number || "",
    rarity: c.rarity || "",
    setId: c.set?.id || "",
    setName: c.set?.name || "",
    image: c.images?.small,
    imageLarge: c.images?.large,
    market: p.market,
    variant: p.variant,
    priceUpdated: p.updated,
  };
}

export async function listSets(): Promise<PokeSet[]> {
  if (cache.sets && Date.now() - cache.sets.at < TTL) return cache.sets.data;
  const rows = await pgetAll("/sets", { orderBy: "-releaseDate" });
  const data: PokeSet[] = rows.map((s: any) => ({
    id: s.id,
    name: s.name,
    series: s.series || "",
    releaseDate: s.releaseDate || "",
    total: s.total || 0,
    symbol: s.images?.symbol,
    logo: s.images?.logo,
  }));
  cache.sets = { at: Date.now(), data };
  return data;
}

export async function listSetCards(setId: string): Promise<PokeCard[]> {
  const hit = cache.cards.get(setId);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const rows = await pgetAll("/cards", {
    q: `set.id:${setId}`,
    orderBy: "number",
    select: "id,name,number,rarity,images,tcgplayer,set",
  });
  const data = rows.map(toCard);
  // API sorts numbers as strings; resort numerically where possible
  data.sort((a, b) => {
    const na = parseInt(a.number), nb = parseInt(b.number);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return a.number.localeCompare(b.number);
  });
  cache.cards.set(setId, { at: Date.now(), data });
  return data;
}

export async function searchCards(q: string): Promise<PokeCard[]> {
  const term = q.trim().replace(/"/g, "");
  if (!term) return [];
  // single word gets a prefix wildcard; multi-word gets a phrase match
  const query = term.includes(" ") ? `name:"${term}"` : `name:${term}*`;
  const d = await pget("/cards", {
    q: query,
    orderBy: "-set.releaseDate",
    pageSize: "30",
    select: "id,name,number,rarity,images,tcgplayer,set",
  });
  return (d.data || []).map(toCard);
}

export async function getCard(id: string): Promise<PokeCard | null> {
  try {
    const d = await pget(`/cards/${encodeURIComponent(id)}`, { select: "id,name,number,rarity,images,tcgplayer,set" });
    return d.data ? toCard(d.data) : null;
  } catch {
    return null;
  }
}
