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

// ---------------- sealed product name search ----------------
//
// sl-v1. Until now sealed product could only be matched by pasting a
// TCGplayer link, because the only name search in the app is
// searchTcgcsvCards, and that one throws away every product with no collector
// number or rarity - which is every sealed item in the mirror. So a box of
// Prismatic Evolutions was findable by link and unfindable by name, even
// though it sits in the same group file as the cards, two fields away.
//
// The hard part is not the filter, it is reach. The mirror has roughly 220
// English and 460 Japanese groups and no search endpoint, so a name search
// over all of them would be about 1,350 file reads. The card search dodges
// that by only ever looking at the newest sixteen English sets, which is why
// it cannot find a Shining Fates tin.
//
// Sealed names carry their own set, though. People do not type "Elite Trainer
// Box", they type "Prismatic Evolutions Elite Trainer Box" - the set is in the
// product name because that is how the product is named. So score the 680
// group NAMES (one cheap, cached read per catalog) against the query, load
// only the groups that scored, and fall back to the newest sets when nothing
// scored at all. That reaches the whole catalog for the price of a couple of
// dozen file reads, and the 12h group cache means the second search is free.

// Words that are noise in a query but common in no haystack. Typing "pokemon"
// in front of a box name should not be able to return nothing, which is what
// happens when every token is required and one of them appears nowhere.
const SEALED_FILLER = new Set(["pokemon", "pokémon", "tcg", "the", "a", "an", "pack", "sealed"]);

const normSealed = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// "pack" is filler for matching but kept in the raw list, because a sealed
// search for "booster pack" should still prefer a product called one.
export function sealedTokens(q: string): { all: string[]; need: string[] } {
  const all = normSealed(q).split(" ").filter(Boolean);
  const need = all.filter((t) => !SEALED_FILLER.has(t));
  return { all, need: need.length > 0 ? need : all };
}

const extValue = (p: any, key: string): string => {
  const e = (p?.extendedData || []).find((x: any) => x.name === key);
  return e ? String(e.value) : "";
};

// A product with no collector number and no rarity is sealed. That is the
// exact complement of the card test in tcgcsvCards, on purpose: one rule,
// two callers, no product that is both or neither.
export function isSealedProduct(p: any): boolean {
  const name = String(p?.name || "");
  if (!name) return false;
  if (extValue(p, "Number") || extValue(p, "Rarity")) return false;
  if (/^code card/i.test(name)) return false;
  return true;
}

// How well a group name answers the query. Scored on the group name alone,
// since the point is to decide which files are worth reading before any
// product in them has been seen.
export function groupNameScore(group: TcgGroup, need: string[]): number {
  const hay = normSealed(group.name);
  const words = new Set(hay.split(" ").filter(Boolean));
  const abbr = normSealed(group.abbreviation || "");
  let score = 0;
  for (const t of need) {
    if (words.has(t)) score += 2;
    else if (hay.includes(t)) score += 1;
    else if (abbr && abbr === t) score += 2;
  }
  return score;
}

export const SEALED_GROUP_BUDGET = 24;

// TCGplayer's junk drawers, always read whatever the query says.
//
// Found against a real collection: a "Costco Prismatic Evolutions 8-Pack Mini
// Tins" names its set in its own name, so scoring sends the search straight to
// SV: Prismatic Evolutions, where the product is not. Retailer exclusives,
// repackaged blisters and promo bundles live in these groups instead, filed by
// what they are rather than what is inside them. Two of the biggest line items
// in that collection, about $1,600 of it, were in here.
//
// Three groups, six file reads, cached for twelve hours. The card search pays
// the same toll for the same reason.
const SEALED_ALWAYS = [/^miscellaneous cards/, /^blister exclusives$/, /^deck exclusives$/];

// Which group files to open, in order. Groups whose names the query named come
// first; the newest English sets backfill, so a bare "elite trainer box" still
// returns this year's boxes rather than nothing.
export function rankSealedGroups(
  groups: { group: TcgGroup; categoryId: number }[],
  need: string[],
  budget = SEALED_GROUP_BUDGET,
): { group: TcgGroup; categoryId: number }[] {
  const jpWanted = need.some((t) => t === "japanese" || t === "japan" || t === "jp");
  const scored = groups
    .map((g) => ({ ...g, score: groupNameScore(g.group, need) }))
    // A Japanese group needs more than one weak hit to earn a read, unless the
    // query asked for Japanese. "Base Set (Japanese)" should not outrank
    // "Base Set" for someone holding an English box.
    .filter((g) => g.score > 0 && (jpWanted || g.categoryId === 3 || g.score >= 4))
    // English ahead of Japanese on an equal score, always. Half the Japanese
    // groups are named after their English counterpart with "(Japanese)" on
    // the end, so they tie on every token and then win on being newer, which
    // would have quietly sent an English Base Set box to the Japanese set.
    // When the query does say Japanese, the word itself is in the group name
    // and carries that group clear on score, so this never gets in the way.
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.categoryId === 3) - Number(a.categoryId === 3) ||
        (b.group.groupId || 0) - (a.group.groupId || 0),
    );

  const always = groups.filter(
    (g) => g.categoryId === 3 && SEALED_ALWAYS.some((re) => re.test(normSealed(g.group.name))),
  );

  const out: { group: TcgGroup; categoryId: number }[] = [];
  const taken = new Set<number>();
  // The named set goes first, since that is usually the right answer, but the
  // junk drawers keep their places in the budget rather than being crowded out
  // by a query that happened to name a set with many near-matches.
  const scoredRoom = Math.max(1, budget - always.length);
  for (const g of scored) {
    if (out.length >= scoredRoom) break;
    if (taken.has(g.group.groupId)) continue;
    taken.add(g.group.groupId);
    out.push({ group: g.group, categoryId: g.categoryId });
  }
  for (const g of always) {
    if (out.length >= budget) break;
    if (taken.has(g.group.groupId)) continue;
    taken.add(g.group.groupId);
    out.push(g);
  }
  const newest = groups
    .filter((g) => g.categoryId === 3 && !taken.has(g.group.groupId))
    .sort((a, b) => (b.group.groupId || 0) - (a.group.groupId || 0));
  for (const g of newest) {
    if (out.length >= budget) break;
    taken.add(g.group.groupId);
    out.push(g);
  }
  return out;
}

// TCGplayer's own slug shape, rebuilt from the two names: category prefix,
// then the group, then the product. Built from the RAW group name, before the
// "SV: " style prefix is stripped for display, because that prefix is part of
// the real slug and parseTcgUrl has to be able to read the set back out of it.
export function sealedUrlSlug(rawGroupName: string, productName: string, categoryId: number): string {
  const prefix = TCG_CATEGORIES.find((c) => c.id === categoryId)?.urlPrefix || "pokemon-";
  return `${prefix}${slugifyGroup(rawGroupName)}-${slugifyGroup(productName)}`;
}

export type SealedHit = TcgMatch & { nameScore: number };

// Products inside one already-loaded group that answer the query. Every needed
// token has to appear in the product name or its set name, the same rule the
// card search uses, so "prismatic evolutions etb" works and so does "etb"
// typed while looking at the Prismatic Evolutions row.
export function sealedMatches(
  prods: any[],
  market: Map<number, number>,
  group: TcgGroup,
  categoryId: number,
  tokens: { all: string[]; need: string[] },
): SealedHit[] {
  const setHay = normSealed(group.name);
  const out: SealedHit[] = [];
  for (const p of prods) {
    if (!isSealedProduct(p)) continue;
    const nameHay = normSealed(p.name);
    const hay = `${nameHay} ${setHay}`;
    if (!tokens.need.every((t) => hay.includes(t))) continue;
    // Relevance is how much of the query landed in the product's own name
    // rather than in the set name. "Surging Sparks Booster Box" beats
    // "Surging Sparks Booster Bundle" for a box, and both beat a sleeve pack
    // that only matched on the set.
    const nameScore = tokens.all.reduce((n, t) => n + (nameHay.includes(t) ? 1 : 0), 0);
    out.push({
      ...toMatch(p, group, categoryId, market.get(p.productId), sealedUrlSlug(group.name, p.name, categoryId)),
      nameScore,
    });
  }
  return out;
}

// Closest first: everything the query asked for by name, then priced before
// unpriced, then the shortest name, which is the one with nothing extra
// bolted on. A tie on all three keeps the mirror's own order.
export function sortSealedHits(hits: SealedHit[]): SealedHit[] {
  return [...hits].sort(
    (a, b) =>
      b.nameScore - a.nameScore ||
      Number(b.market !== null) - Number(a.market !== null) ||
      a.productName.length - b.productName.length,
  );
}

export type SealedSearch = { hits: SealedHit[]; groupsRead: number; truncated: boolean };

export async function searchTcgSealed(q: string, budget = SEALED_GROUP_BUDGET): Promise<SealedSearch> {
  const tokens = sealedTokens(q);
  if (tokens.need.length === 0) return { hits: [], groupsRead: 0, truncated: false };

  const pool: { group: TcgGroup; categoryId: number }[] = [];
  for (const c of TCG_CATEGORIES) {
    const gs = await categoryGroups(c.id).catch(() => [] as TcgGroup[]);
    for (const g of gs) pool.push({ group: g, categoryId: c.id });
  }
  if (pool.length === 0) throw new Error("tcgcsv groups unavailable");

  const picked = rankSealedGroups(pool, tokens.need, budget);
  const hits: SealedHit[] = [];
  let groupsRead = 0;
  for (let i = 0; i < picked.length; i += 6) {
    const chunk = picked.slice(i, i + 6);
    const loaded = await Promise.all(
      chunk.map((g) => groupData(g.categoryId, g.group.groupId).then((d) => ({ ...g, d }))),
    );
    for (const { group, categoryId, d } of loaded) {
      if (!d) continue;
      groupsRead++;
      hits.push(...sealedMatches(d.prods, d.market, group, categoryId, tokens));
    }
    // Stop early once there is plenty: the groups are already in relevance
    // order, so later files are the long shots.
    if (hits.length >= 60) break;
  }
  const sorted = sortSealedHits(hits);
  return { hits: sorted.slice(0, 20), groupsRead, truncated: sorted.length > 20 };
}
