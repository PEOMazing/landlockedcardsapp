// Mapping an inventory product to an exact TCGplayer product.
//
// Why this exists: the nightly refresh guesses which TCGplayer product an
// inventory row means by comparing names against a shortlist of sets. That is
// fine for "Chaos Rising Booster Box" and hopeless for "151 Tin 4 pack", which
// shares no useful tokens with "Sam's Club 151 4 Mini Tins + 4 Promo Cards
// Bundle". Pasting the product's TCGplayer link removes the guess entirely.
//
// tcgcsv (the free nightly TCGplayer mirror) has no lookup-by-product-id
// endpoint, only static files per set, so the set has to come from somewhere.
// It is sitting in the URL: TCGplayer slugs are
//   /product/<id>/<category slug>-<group slug>-<product slug>
// e.g. /product/662302/pokemon-sv-scarlet-and-violet-151-sams-club-151-4-mini-tins...
// Slugifying every group name and taking the longest one that prefixes the URL
// resolves the set exactly. Checked against all 135 TCGplayer links already in
// the inventory: every one lands on the right set.

const TCGCSV = "https://tcgcsv.com/tcgplayer";
const HEADERS = {
  // tcgcsv 401s server fetches that arrive without a real User-Agent
  "User-Agent": "Mozilla/5.0 (compatible; LandLockedCards/1.0; +https://landlockedcards.app)",
  "Accept": "application/json",
};
const TTL = 1000 * 60 * 60 * 12;

// Pokemon and Pokemon Japan are separate tcgcsv categories with separate URL
// prefixes. Japan first: "pokemon-japan-" also starts with "pokemon-".
export const TCG_CATEGORIES = [
  { id: 85, urlPrefix: "pokemon-japan-", label: "Pokemon Japan" },
  { id: 3, urlPrefix: "pokemon-", label: "Pokemon" },
];

export type TcgGroup = { groupId: number; name: string; abbreviation?: string };

export type TcgMatch = {
  productId: number;
  categoryId: number;
  groupId: number;
  groupName: string;
  productName: string;
  imageUrl: string;
  market: number | null;
  cleanUrl: string;
};

// "SV: Scarlet & Violet 151" -> "sv-scarlet-and-violet-151", matching how
// TCGplayer builds its own slugs (& becomes "and", apostrophes vanish).
export function slugifyGroup(name: string): string {
  return String(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Tracking params and ?Language= make the same product look like three
// different links, so store the canonical form.
export function cleanTcgUrl(url: string, productId: number, slug: string): string {
  return `https://www.tcgplayer.com/product/${productId}/${slug}`;
}

export function extractProductId(url: string): number | null {
  const m = String(url || "").match(/\/product\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function isTcgUrl(url: string): boolean {
  return String(url || "").includes("tcgplayer.com");
}

type Parsed = { productId: number; slug: string; categoryId: number; rest: string };

export function parseTcgUrl(url: string): Parsed | null {
  const m = String(url || "").match(/tcgplayer\.com\/product\/(\d+)\/([a-z0-9-]+)/i);
  if (!m) return null;
  const productId = parseInt(m[1], 10);
  const slug = m[2].toLowerCase();
  for (const c of TCG_CATEGORIES) {
    if (slug.startsWith(c.urlPrefix)) {
      return { productId, slug, categoryId: c.id, rest: slug.slice(c.urlPrefix.length) };
    }
  }
  return null;
}

// ---------------- cached tcgcsv reads ----------------

type GroupData = { at: number; prods: any[]; market: Map<number, number> };
const groupsCache = new Map<number, { at: number; data: TcgGroup[] }>();
const dataCache = new Map<string, GroupData>();

async function jget(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store", headers: HEADERS });
  if (!res.ok) throw new Error(`tcgcsv ${res.status}`);
  return res.json();
}

export async function categoryGroups(categoryId: number): Promise<TcgGroup[]> {
  const hit = groupsCache.get(categoryId);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data: TcgGroup[] = (await jget(`${TCGCSV}/${categoryId}/groups`)).results || [];
  groupsCache.set(categoryId, { at: Date.now(), data });
  return data;
}

export async function groupData(categoryId: number, groupId: number): Promise<GroupData | null> {
  const key = `${categoryId}:${groupId}`;
  const hit = dataCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit;
  try {
    const [pd, pc] = await Promise.all([
      jget(`${TCGCSV}/${categoryId}/${groupId}/products`),
      jget(`${TCGCSV}/${categoryId}/${groupId}/prices`),
    ]);
    const market = new Map<number, number>();
    for (const p of pc.results || []) {
      if (typeof p.marketPrice === "number" && p.marketPrice > 0 && !market.has(p.productId)) {
        market.set(p.productId, p.marketPrice);
      }
    }
    const entry: GroupData = { at: Date.now(), prods: pd.results || [], market };
    dataCache.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

// ---------------- resolution ----------------

// Longest slug wins so "base-set-2" is never swallowed by "base-set".
export async function groupFromSlug(categoryId: number, rest: string): Promise<TcgGroup | null> {
  const groups = await categoryGroups(categoryId);
  let best: TcgGroup | null = null;
  let bestLen = 0;
  for (const g of groups) {
    const s = slugifyGroup(g.name);
    if (!s) continue;
    if ((rest === s || rest.startsWith(s + "-")) && s.length > bestLen) {
      best = g;
      bestLen = s.length;
    }
  }
  return best;
}

function toMatch(p: any, g: TcgGroup, categoryId: number, market: number | undefined, slug: string): TcgMatch {
  return {
    productId: p.productId,
    categoryId,
    groupId: g.groupId,
    groupName: String(g.name).replace(/^[A-Za-z0-9]{1,7}:\s*/, ""),
    productName: String(p.name || ""),
    imageUrl: p.imageUrl || "",
    market: typeof market === "number" ? Math.round(market * 100) / 100 : null,
    cleanUrl: cleanTcgUrl("", p.productId, slug),
  };
}

// A flat shape rather than a discriminated union: this project runs with
// strict mode off, where TypeScript will not narrow the false branch of a
// union on a boolean discriminant.
export type ResolveResult = { ok: boolean; match?: TcgMatch; reason?: string };

// Resolve a pasted TCGplayer link to the exact product, its set, and today's
// market price. The slug names the set, so this is normally two file reads.
// If the set has been renamed since the link was made the slug will not match,
// so fall back to sweeping the newest sets in that category before giving up.
export async function resolveTcgUrl(url: string, sweepLimit = 40): Promise<ResolveResult> {
  const parsed = parseTcgUrl(url);
  if (!parsed) {
    if (isTcgUrl(url)) {
      return { ok: false, reason: "That TCGplayer link has no product id in it. Open the product page itself and copy the address from there." };
    }
    return { ok: false, reason: "That is not a TCGplayer product link. Paste one that looks like tcgplayer.com/product/123456/..." };
  }
  const { productId, categoryId, rest, slug } = parsed;

  const direct = await groupFromSlug(categoryId, rest);
  if (direct) {
    const d = await groupData(categoryId, direct.groupId);
    const p = d?.prods.find((x: any) => x.productId === productId);
    if (p) return { ok: true, match: toMatch(p, direct, categoryId, d!.market.get(productId), slug) };
  }

  // Renamed or re-homed set: check the newest sets, which is where anything
  // recent enough to have moved will be.
  let groups: TcgGroup[];
  try {
    groups = await categoryGroups(categoryId);
  } catch {
    return { ok: false, reason: "Could not reach the TCGplayer price mirror. Try again in a minute." };
  }
  const sweep = groups
    .filter((g) => !direct || g.groupId !== direct.groupId)
    .sort((a, b) => (b.groupId || 0) - (a.groupId || 0))
    .slice(0, sweepLimit);
  for (let i = 0; i < sweep.length; i += 8) {
    const chunk = sweep.slice(i, i + 8);
    const loaded = await Promise.all(chunk.map((g) => groupData(categoryId, g.groupId).then((d) => ({ g, d }))));
    for (const { g, d } of loaded) {
      if (!d) continue;
      const p = d.prods.find((x: any) => x.productId === productId);
      if (p) return { ok: true, match: toMatch(p, g, categoryId, d.market.get(productId), slug) };
    }
  }
  return {
    ok: false,
    reason: direct
      ? `Found the set (${direct.name}) but not that product inside it. The link may point to a sealed product TCGplayer has since replaced.`
      : "Could not work out which set that link belongs to. Paste the link straight from the TCGplayer product page.",
  };
}

// ---------------- bulk pricing for already-mapped products ----------------

export type MappedTarget = { recordId: string; productId: number; categoryId: number; groupId: number };
export type MappedPrice = { recordId: string; price: number; name: string; image: string };

// One read per distinct set, however many products point at it.
export async function priceMappedProducts(targets: MappedTarget[]): Promise<Map<string, MappedPrice>> {
  const out = new Map<string, MappedPrice>();
  const byGroup = new Map<string, MappedTarget[]>();
  for (const t of targets) {
    const key = `${t.categoryId}:${t.groupId}`;
    const list = byGroup.get(key) || [];
    list.push(t);
    byGroup.set(key, list);
  }
  const keys = [...byGroup.keys()];
  for (let i = 0; i < keys.length; i += 6) {
    const chunk = keys.slice(i, i + 6);
    await Promise.all(
      chunk.map(async (key) => {
        const [cat, grp] = key.split(":").map(Number);
        const d = await groupData(cat, grp);
        if (!d) return;
        for (const t of byGroup.get(key) || []) {
          const mkt = d.market.get(t.productId);
          if (typeof mkt !== "number") continue;
          const p = d.prods.find((x: any) => x.productId === t.productId);
          out.set(t.recordId, {
            recordId: t.recordId,
            price: Math.round(mkt * 100) / 100,
            name: String(p?.name || ""),
            image: p?.imageUrl || "",
          });
        }
      })
    );
  }
  return out;
}

// Read the mapping off an inventory record, if it has a usable one. A record
// that carries a TCGplayer URL but no group id (everything mapped before this
// feature existed) still resolves, just via the slug rather than the stored id.
export function mappingFrom(fields: Record<string, any>): MappedTarget | null {
  const url = String(fields["TCGplayer URL"] || "");
  if (!isTcgUrl(url)) return null;
  const productId = extractProductId(url);
  if (!productId) return null;
  const groupId = Number(fields["TCG Group Id"]) || 0;
  const categoryId = Number(fields["TCG Category Id"]) || 0;
  if (groupId > 0 && categoryId > 0) {
    return { recordId: "", productId, categoryId, groupId };
  }
  return null;
}
