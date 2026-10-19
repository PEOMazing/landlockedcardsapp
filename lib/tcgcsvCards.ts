import { PokeCard } from "./pokemon";

// Card search over tcgcsv.com, the nightly TCGplayer mirror. This covers the
// newest sets months before pokemontcg.io does, with market prices included.
// tcgcsv has no search endpoint (static files per set), so we load the most
// recent sets and filter in memory; warm serverless instances cache for 12h.

// tcgcsv splits Pokemon into two catalogs: 3 is English, 85 is Pokemon Japan.
// Reading only 3 is why every Japanese single failed to match. The cards were
// never missing from the mirror, the app was only ever looking in one drawer.
//
// Group ids are unique across both catalogs - checked against the live lists,
// 220 English and 459 Japanese groups with zero overlapping ids - so a group
// id stays safe as a cache key and as half of a stored card id. Every group
// object carries its own categoryId, so the path to a group's files is always
// rebuildable from the group itself and never has to be remembered separately.
const TCGCSV = "https://tcgcsv.com/tcgplayer";
const EN_CAT = 3;
const JP_CAT = 85;
const CATEGORIES = [EN_CAT, JP_CAT];
const catPath = (g: any) => `${TCGCSV}/${Number(g?.categoryId) || EN_CAT}`;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; LandLockedCards/1.0; +https://landlockedcards.app)",
  "Accept": "application/json",
};
const TTL = 1000 * 60 * 60 * 12;
const RECENT_SETS = 16;

type GroupCache = {
  at: number;
  prods: any[];
  market: Map<number, number>;
  // marketPrice per printing, because a card that exists as both Holofoil and
  // Reverse Holofoil has two very different prices under one productId
  bySub: Map<number, Map<string, number>>;
};
const cache: { groups?: { at: number; data: any[] }; byGroup: Map<number, GroupCache> } = {
  byGroup: new Map(),
};

async function jget(url: string): Promise<any> {
  const res = await fetch(url, { next: { revalidate: 43200 }, headers: HEADERS });
  if (!res.ok) throw new Error(`tcgcsv ${url}: ${res.status}`);
  return res.json();
}

async function allGroups(): Promise<any[]> {
  if (cache.groups && Date.now() - cache.groups.at < TTL) return cache.groups.data;
  const lists = await Promise.all(
    CATEGORIES.map((c) =>
      jget(`${TCGCSV}/${c}/groups`).then((r) => r.results || []).catch(() => [] as any[])
    )
  );
  const data = lists.flat();
  // Do not cache a catalog that came back empty. A 12h cache of nothing would
  // turn one bad minute upstream into half a day of "could not match this card",
  // and the whole point of this list is that it is the ground truth.
  if (data.length === 0) throw new Error("tcgcsv groups: both catalogs empty");
  cache.groups = { at: Date.now(), data };
  return data;
}

// Groups that stay searchable no matter their age or their supplemental flag.
//
// mc-v1. TCGplayer files stamped prerelease promos in its junk-drawer groups,
// not with the set they came from: "Umbreon ex - 060/131 (Prismatic Evolutions
// Stamp)" lives in Miscellaneous Cards & Products. That group is BOTH flagged
// supplemental and sitting on a low groupId, so the two filters below excluded
// it twice over and no amount of typing could surface it in the add-a-card box.
// pokemontcg.io does not carry TCGplayer-only products at all, so the
// pokemontcg.io fallback in /api/pokemon/cards could not cover the gap either -
// the card was simply unreachable from search while being perfectly reachable
// from a CSV import, which goes through resolveSingleToTcg and sees every group.
//
// Matched on name rather than a hardcoded groupId so this survives tcgcsv
// renumbering, and kept to four entries on purpose: every group added here
// costs two more HTTP fetches on a cold instance, and this route has a 60s
// budget. The real fix for breadth is a cached name index over all groups
// rather than a newest-N window; this is the narrow version of that.
const EVERGREEN_GROUPS = [
  /^miscellaneous cards/,
  /^blister exclusives$/,
  /^deck exclusives$/,
  /^league and championship cards$/,
];

async function recentGroups(): Promise<any[]> {
  const groups = await allGroups();
  // publishedOn is unreliable on tcgcsv (ancient sets carry far-future placeholder
  // dates), but groupId increments with catalog age, so newest sets sort last-in
  //
  // English only, deliberately. This feeds the add-a-card search box, and the
  // two catalogs interleaved would push English sets out of the newest-16
  // window and change what that box returns. Matching an imported card goes
  // through resolveSingleToTcg, which does see both.
  const en = groups.filter((g) => Number(g.categoryId) === EN_CAT);
  const newest = en
    .filter((g) => !g.isSupplemental)
    .sort((a, b) => (b.groupId || 0) - (a.groupId || 0))
    .slice(0, RECENT_SETS);
  const taken = new Set(newest.map((g) => g.groupId));
  const evergreen = en.filter(
    (g) => !taken.has(g.groupId) && EVERGREEN_GROUPS.some((re) => re.test(setKey(g.name))),
  );
  return [...newest, ...evergreen];
}

async function loadGroup(g: any): Promise<GroupCache | null> {
  const hit = cache.byGroup.get(g.groupId);
  if (hit && Date.now() - hit.at < TTL) return hit;
  try {
    const [pd, pc] = await Promise.all([
      jget(`${catPath(g)}/${g.groupId}/products`),
      jget(`${catPath(g)}/${g.groupId}/prices`),
    ]);
    const market = new Map<number, number>();
    const bySub = new Map<number, Map<string, number>>();
    for (const p of pc.results || []) {
      if (!(typeof p.marketPrice === "number" && p.marketPrice > 0)) continue;
      if (!market.has(p.productId)) market.set(p.productId, p.marketPrice);
      const m = bySub.get(p.productId) || new Map<string, number>();
      m.set(String(p.subTypeName || ""), p.marketPrice);
      bySub.set(p.productId, m);
    }
    const entry = { at: Date.now(), prods: pd.results || [], market, bySub };
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

// TCGplayer's own shorthand for a set, in trailing parens: "(MCAP)", "(PRE)",
// "(SVP)". It is on screen when you copy a card's title and it exists in no
// field we hold, so it has to come off the query rather than be searched for.
const stripSetAbbrev = (s: string) => s.replace(/\(\s*[A-Za-z0-9]{2,6}\s*\)\s*$/, " ");

export async function searchTcgcsvCards(q: string): Promise<PokeCard[]> {
  const term = norm(stripSetAbbrev(q));
  if (!term) return [];
  // Punctuation-only tokens are dropped. The dash in a pasted title would
  // otherwise be a token, and "-" happens to be a substring of most product
  // names, so it matched everything and meant nothing.
  const qTokens = term.split(" ").filter((t) => /[a-z0-9]/.test(t));
  if (qTokens.length === 0) return [];
  const groups = await recentGroups();
  const out: PokeCard[] = [];

  for (let i = 0; i < groups.length; i += 4) {
    const chunk = await Promise.all(groups.slice(i, i + 4).map((g) => loadGroup(g).then((d) => ({ g, d }))));
    for (const { g, d } of chunk) {
      if (!d) continue;
      // Matched against the card name AND its set name. People paste what
      // TCGplayer showed them, and what TCGplayer shows them is the whole
      // line: "Umbreon ex - 060/131 (Prismatic Evolutions Stamp) -
      // Miscellaneous Cards & Products (MCAP)". Against the name alone, every
      // token past the product name was a token that could never match, so the
      // more precisely you identified the card the more certain you were to
      // get nothing back. Searching the set name too also makes "umbreon
      // prismatic" and "charizard 151" work, which is how people actually type.
      const setHay = norm(g.name);
      for (const p of d.prods) {
        if (!isCard(p) || String(p.name).startsWith("Code Card")) continue;
        const n = `${norm(p.name)} ${setHay}`;
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

// ---------------- card ids ----------------
//
// A card id is "tcg:<productId>:<groupId>" and, since the printings fix,
// optionally "tcg:<productId>:<groupId>:<subtype-slug>".
//
// The fourth part matters: one productId covers every printing of a card, so a
// Reverse Holofoil and a Holofoil share an id but not a price. Leafeon 7/100
// Majestic Dawn is $92 as a Holofoil and $44 as a Reverse. Without the subtype
// a refresh just took whichever printing happened to come first in the price
// file. Old three-part ids still parse, so nothing already stored breaks.
const CARD_ID = /^tcg:(\d+):(\d+)(?::([a-z0-9-]+))?$/;

export const subSlug = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function makeCardId(productId: number, groupId: number, subType?: string): string {
  const slug = subSlug(subType || "");
  return slug ? `tcg:${productId}:${groupId}:${slug}` : `tcg:${productId}:${groupId}`;
}

export function parseCardId(id: string): { productId: number; groupId: number; sub: string } | null {
  const m = String(id).match(CARD_ID);
  if (!m) return null;
  return { productId: parseInt(m[1]), groupId: parseInt(m[2]), sub: m[3] || "" };
}

// The printing a card in our inventory actually is. The Variant column is what
// the TCGplayer export wrote, so it is already in TCGplayer's own vocabulary.
export function subTypeForVariant(variant: string, rarity: string): string {
  const v = norm(variant);
  const r = norm(rarity);
  const foil =
    v.includes("holo") || v.includes("foil") ||
    r.includes("holo") || r.includes("ultra") || r.includes("secret");
  if (v.includes("reverse")) return "Reverse Holofoil";
  // "1st Edition" and "Unlimited" are print runs, and on WotC-era sets they are
  // the subtype names TCGplayer actually uses - sometimes on their own, and
  // sometimes with "Holofoil" attached. Both spellings have to be reachable or
  // an Unlimited card gets quoted at its 1st Edition price, which on Jungle and
  // Fossil is three to five times too much.
  if (v.includes("1st")) return foil ? "1st Edition Holofoil" : "1st Edition";
  if (v.includes("unlimited")) return foil ? "Unlimited Holofoil" : "Unlimited";
  return foil ? "Holofoil" : "Normal";
}

// How well a printing TCGplayer has matches the printing we are looking for.
// Shared words earn, unasked-for words cost. That ordering is what keeps a
// plain "Holofoil" request off the 1st Edition row: "Unlimited Holofoil"
// carries one word we did not ask for, "1st Edition Holofoil" carries two.
function subScore(want: string, have: string): number {
  const w = new Set(subSlug(want).split("-").filter(Boolean));
  const h = subSlug(have).split("-").filter(Boolean);
  let shared = 0;
  for (const t of h) if (w.has(t)) shared++;
  return shared * 2 - (h.length - shared);
}

// Pick the market price for the printing we hold, falling back through the
// other printings rather than returning nothing: a wrong-printing price beats
// a blank comp, and the caller records which printing it used.
//
// The fallback used to be "whichever printing came first in the price file",
// which is not a choice so much as an accident, and on old sets that accident
// was consistently 1st Edition - the expensive one. Now the closest printing by
// name wins, and a tie goes to the cheaper of them. Guessing high puts a price
// on a sticker that no buyer will pay and that we would have to honour; guessing
// low costs a few dollars of margin on a card a human can still look at.
export function pickPrinting(
  available: Iterable<[string, number]>,
  want: string,
): { price: number; sub: string } | null {
  const subs = [...available];
  if (subs.length === 0) return null;
  const slug = subSlug(want);
  for (const [name, price] of subs) if (subSlug(name) === slug) return { price, sub: name };

  let best: { price: number; sub: string; score: number } | null = null;
  for (const [name, price] of subs) {
    const score = subScore(want, name);
    if (!best || score > best.score || (score === best.score && price < best.price)) {
      best = { price, sub: name, score };
    }
  }
  return best ? { price: best.price, sub: best.sub } : null;
}

function marketFor(d: GroupCache, productId: number, want: string): { price: number; sub: string } | null {
  const subs = d.bySub.get(productId);
  if (!subs || subs.size === 0) return null;
  return pickPrinting(subs, want);
}

export async function getTcgcsvCard(id: string): Promise<PokeCard | null> {
  const parsed = parseCardId(id);
  if (!parsed) return null;
  const { productId, groupId, sub } = parsed;
  const g = (await allGroups()).find((x) => x.groupId === groupId);
  if (!g) return null;
  const d = await loadGroup(g);
  if (!d) return null;
  const p = d.prods.find((x) => x.productId === productId);
  if (!p) return null;
  const hit = sub ? marketFor(d, productId, sub) : null;
  const card = toCard(p, g, hit ? hit.price : d.market.get(productId));
  if (hit) card.variant = hit.sub;
  return card;
}

/** A card from a TCGplayer product id alone, with no group to narrow it.
 *
 *  si-v1. A pasted TCGplayer URL carries the product id and nothing else -
 *  /product/517049/pokemon-ultra-prism-darkrai-prism-star - so getTcgcsvCard,
 *  which needs the groupId too, cannot answer. This scans for it.
 *
 *  Same chunked walk searchTcgcsvCards already does, and cheaper in practice
 *  because a product id is unique: the first group holding it ends the search,
 *  where a name search has to read every group to rank what it found.
 *
 *  Null when nothing matches, which the caller must treat as "ask the person
 *  to check the link" rather than falling back to a guess. Attaching the wrong
 *  product to a slab is silent and permanent. */
export async function getTcgcsvCardByProductId(
  productId: number,
  slug?: string,
): Promise<PokeCard | null> {
  if (!Number.isFinite(productId) || productId <= 0) return null;
  // si-v2. The slug off the pasted URL first, then the recent-sets window.
  //
  // The window alone was the whole bug: it is the newest sixteen ENGLISH sets,
  // which is the right list for a search box and the wrong list for a link
  // somebody is holding in their hand. Paste a Japanese card, or anything
  // older than about a year, and the id was unfindable no matter how correct
  // it was. The set was never missing from the mirror; the lookup was looking
  // in sixteen drawers out of six hundred and seventy-nine.
  //
  // The slug fixes that without scanning the catalog, because TCGplayer builds
  // it out of the catalog name and the set name - "pokemon-japan-expansion-
  // pack-blastoise" is Japanese, set "Expansion Pack". That is one group to
  // load instead of hundreds.
  const tried = new Set<number>();
  const pools = [slugGroups(await allGroups(), String(slug || "")), await recentGroups()];
  for (const pool of pools) {
    const groups = pool.filter((g) => !tried.has(g.groupId));
    for (const g of groups) tried.add(g.groupId);
    for (let i = 0; i < groups.length; i += 4) {
      const chunk = await Promise.all(
        groups.slice(i, i + 4).map((g) => loadGroup(g).then((d) => ({ g, d }))),
      );
      for (const { g, d } of chunk) {
        if (!d) continue;
        const p = d.prods.find((x) => x.productId === productId);
        if (p) return toCard(p, g, d.market.get(productId));
      }
    }
  }
  return null;
}

/** tcgcsv group names turned into the shape TCGplayer puts in a URL.
 *  "SM12a: TAG TEAM GX: Tag All Stars" -> "sm12a-tag-team-gx-tag-all-stars" */
const slugify = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** The groups a pasted product slug could belong to, best guess first.
 *
 *  Longest name wins, because set names nest: "base-set" is a prefix of
 *  "base-set-2", and matching the short one first would send the lookup to
 *  the wrong set and quietly find nothing. */
export function slugGroups(groups: any[], slug: string): any[] {
  const s = slugify(slug);
  if (!s) return [];
  const cat = s.startsWith("pokemon-japan-") ? JP_CAT : s.startsWith("pokemon-") ? EN_CAT : 0;
  const rest = s.replace(/^pokemon-japan-/, "").replace(/^pokemon-/, "");
  return groups
    .filter((g) => {
      if (cat && Number(g.categoryId) !== cat) return false;
      const gs = slugify(g.name);
      return !!gs && rest.startsWith(`${gs}-`);
    })
    .sort((a, b) => slugify(b.name).length - slugify(a.name).length);
}

// ---------------- resolving an unlinked single ----------------
//
// Cards that came in from a TCGplayer or Collectr export carry a set name, a
// card number and a variant, but no card id, so nothing could ever reprice
// them - not the nightly job, which filters on Card ID, and not the per-card
// Refresh comp button, which errors out. This finds the id from what the
// export did give us.

// "7/100", "007/100" and "7" all mean card 7. Promo numbers like "DP45" and
// "HGSS07" are compared as-is, uppercased.
const numKey = (raw: string): string => {
  const n = String(raw || "").split("/")[0].trim().toUpperCase();
  const i = parseInt(n, 10);
  return !isNaN(i) && /^\d+$/.test(n) ? String(i) : n;
};

// Set names drift between sources, in three ways that all actually occur in
// our data:
//   "League & Championship Cards" vs "League and Championship Cards"
//   "SV: Paldean Fates" vs "Paldean Fates"   (tcgcsv prefixes the era code)
//   "Pokemon Base Set" vs "Base Set"
// so compare on a flattened form rather than the raw string.
//   "XY - Evolutions" vs "Evolutions"        (a second prefix style, with a dash)
//   "SV: Scarlet & Violet Promo Cards" vs "Scarlet & Violet Promo"
//   "Team Rocket (Japanese)" vs "Team Rocket" (a language marker, not a name)
//
// The dash form is worth calling out: it is why every XY and SM era set in the
// collection failed to match. The colon form was handled and the dash form was
// not, and nothing downstream could tell the difference between "this set does
// not exist" and "this set is spelled with a dash".
export const setKey = (s: string) =>
  norm(s)
    // a trailing language marker says which catalog, not which set
    .replace(/\s*\((?:japanese|jp|jpn)\)\s*$/, "")
    // era code in front of the name, both separators that actually occur:
    // "SV: Paldean Fates", "S12a: VSTAR Universe", "S-P: Sword & Shield Promos",
    // "XY - Evolutions", "SM - Celestial Storm"
    .replace(/^[a-z0-9-]{1,7}:\s*/, "")
    .replace(/^[a-z0-9]{1,5}\s+-\s+/, "")
    // Japanese high-class packs carry a second prefix behind the era code
    .replace(/^high class pack:\s*/, "")
    .replace(/^the\s+/, "")
    .replace(/\s*&\s*/g, " and ")
    .replace(/^(pokemon|pok.mon)\s+/, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    // promo sets are spelled three ways across sources for the same thing
    .replace(/\bpromos\b/g, "promo")
    .replace(/\bpromo cards\b/g, "promo")
    .trim();

// Where the two sources genuinely disagree on the name rather than its shape.
// Most of these are different English translations of the same Japanese set,
// which no amount of normalising will reconcile. A key maps to every spelling
// worth trying; the category preference below decides between them when a name
// exists in both catalogs.
const SET_ALIASES: Record<string, string[]> = {
  "hot air arena": ["heat wave arena"],
  "terastal festival ex": ["terastal fest ex"],
  "vending series 1 blue": ["vending machine cards series 1 blue"],
  "vending series 2 red": ["vending machine cards series 2 red"],
  "vending series 3 green": ["vending machine cards series 3 green"],
  "unnumbered promo 2000": ["unnumbered promotional cards"],
  // "151" is a set name in both catalogs under two unrelated spellings
  "151": ["scarlet and violet 151", "card 151"],
  // English SM promos are "SM Promos"; the Japanese ones keep the long name,
  // so both spellings are listed and the catalog order picks the right one
  "sun and moon promo": ["sm promo"],
  // the Japanese Team Rocket set goes by its Japanese name
  "team rocket": ["rocket gang"],
  // Awakening Legends is the Japanese Neo Revelation. Listing it as an alias is
  // safe rather than clever: an English Neo Revelation card matches in the
  // English catalog first and never reaches this spelling.
  "neo revelation": ["awakening legends"],
  "explosive flame walker": ["explosive walker"],
};

export type TcgResolution = { cardId: string; productId: number; groupId: number; subType: string; market: number | null; productName: string; image: string };

// The card's own name, with each source's decoration taken off.
//
// tcgcsv hangs the card number off the product name ("Pikachu - 027",
// "Paras - 001/172") and our imports hang a language tag off theirs
// ("Marnie (JP)"). Neither is part of the card's name. What IS part of it is
// the parenthetical printing qualifier - "(Cosmos Holo)", "(Pokemon Center
// Exclusive)" - which is the only thing telling two products with the same
// number apart, so the brackets come off but the words stay.
//
// The number has to be removed from the middle as well as the end, because
// the qualifier sits behind it: "Pawmi - 040 (Cosmos Holo)" has to reduce to
// the same thing as our "Pawmi Cosmos Holo".
const cardNameKey = (s: string) =>
  norm(s)
    .replace(/\s*\((?:jp|jpn|japanese)\)\s*$/, "")
    .replace(/\s+-\s+[0-9a-z]+(?:\/[0-9a-z]+)?(?=\s*\(|$)/, "")
    .replace(/[()]/g, "")
    // the same printing, spelled differently on either side
    .replace(/\bholofoil\b/g, "holo")
    .replace(/\bcosmo holo\b/g, "cosmos holo")
    .replace(/\s+/g, " ")
    .trim();

export async function resolveSingleToTcg(input: {
  setName: string; number: string; name: string; variant?: string; rarity?: string;
  /** The Language column, when the record has one. Only ever used to choose
   *  between two catalogs that both have a set by this name - never to rule a
   *  card out, because the imported tag is not reliable enough for that: some
   *  plainly Japanese sets arrive tagged English. */
  language?: string;
  /** Take the first of several equally good matches instead of refusing.
   *  Only ever set by the image lookup, where the candidates are the same card
   *  in different printings and so share the same art. Pricing must never set
   *  this: there the difference between those printings is the whole point. */
  allowAmbiguous?: boolean;
}): Promise<TcgResolution | null> {
  const base = setKey(input.setName);
  if (!base) return null;
  const wants = [base, ...(SET_ALIASES[base] || [])];

  // Japanese first when anything says Japanese - the language column, or the
  // set name carrying its own marker - otherwise English first. Both catalogs
  // are always tried, so a wrong tag costs an ordering, not a match.
  const saysJp = /japanese|japan|\bjp\b/i.test(`${input.language || ""} ${input.setName}`);
  const order = saysJp ? [JP_CAT, EN_CAT] : [EN_CAT, JP_CAT];

  const groups = await allGroups();
  let g: any = null;
  for (const cat of order) {
    const inCat = groups.filter((x) => Number(x.categoryId) === cat);
    for (const w of wants) {
      const hit = inCat.find((x) => setKey(x.name) === w)
        || inCat.find((x) => setKey(x.name).replace(/^ex /, "") === w.replace(/^ex /, ""));
      if (hit) { g = hit; break; }
    }
    if (g) break;
  }
  if (!g) return null;
  const d = await loadGroup(g);
  if (!d) return null;

  const key = numKey(input.number);
  const cards = d.prods.filter(isCard);
  let hits = key ? cards.filter((p) => numKey(ext(p, "Number")) === key) : [];

  // Number is the reliable key, but promos and reprints can repeat one, so the
  // card name breaks ties. Name alone is the last resort.
  if (hits.length > 1) {
    const n = cardNameKey(input.name);
    const byName = hits.filter((p) => cardNameKey(p.name) === n);
    if (byName.length > 0) hits = byName;
  }
  // Name search over the whole set whenever the number did not land on exactly
  // one product. The number is not always usable: the junk-drawer groups store
  // it as "19/147", so everything numbered 19 in any set collides, and promo
  // and unnumbered sets often have no usable number at all. In those the name
  // with its printing qualifier is the more specific key of the two.
  if (hits.length !== 1) {
    const n = cardNameKey(input.name);
    const byName = cards.filter((p) => cardNameKey(p.name) === n);
    if (byName.length > 0) hits = byName;
  }
  // Two products still matching the same number and name is genuinely
  // ambiguous - guessing would write a wrong price with full confidence.
  if (hits.length > 1 && input.allowAmbiguous) hits = [hits[0]];
  if (hits.length !== 1) return null;

  const p = hits[0];
  const wantSub = subTypeForVariant(input.variant || "", input.rarity || ext(p, "Rarity"));
  const hit = marketFor(d, p.productId, wantSub);
  const subType = hit ? hit.sub : wantSub;
  return {
    cardId: makeCardId(p.productId, g.groupId, subType),
    productId: p.productId,
    groupId: g.groupId,
    subType,
    market: hit ? Math.round(hit.price * 100) / 100 : null,
    productName: p.name,
    image: p.imageUrl || "",
  };
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

/** The printing a sold row is for, or "" when the row does not say.
 *
 *  TCGplayer has moved this field around and it is not in their docs, so every
 *  name it has been seen under is checked rather than betting on one. */
export function saleVariant(x: any): string {
  for (const k of ["variant", "variantName", "subTypeName", "printing", "productConditionName"]) {
    const v = String(x?.[k] || "").trim();
    if (v) return v;
  }
  return "";
}

/** Keep only the sales for the printing we actually hold.
 *
 *  A Normal and a Reverse Holofoil share one productId, so an unfiltered sold
 *  list mixes two cards that trade at completely different prices. On HS
 *  Metapod that meant four regular sales around $2.76 drowning the one real
 *  Reverse sale at $20, and the Reverse sale then being thrown out as an
 *  outlier - a $3 comp on a card whose own printing was listing at $19.
 *
 *  If not one row carries a printing, the shape has changed and filtering
 *  would silently discard every sale, so the rows are passed through. Wrong
 *  in the old way beats pricing nothing at all, and the health canary is what
 *  is meant to catch that case. */
export function salesForPrinting(rows: any[], printing: string): any[] {
  const want = subSlug(printing || "");
  if (!want) return rows;
  if (!rows.some((x) => saleVariant(x))) return rows;
  return rows.filter((x) => {
    const got = saleVariant(x);
    return got ? subSlug(got) === want : false;
  });
}

export async function conditionSoldComp(
  productId: number,
  condition: string,
  printing = ""
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
    const recent: SoldSale[] = salesForPrinting(d?.data || [], printing)
      .filter((x: any) =>
        typeof x.purchasePrice === "number" && x.purchasePrice > 0 &&
        x.orderDate && new Date(x.orderDate).getTime() >= cutoff)
      .slice(0, 10)
      .map((x: any) => ({ date: String(x.orderDate).slice(0, 10), price: x.purchasePrice, qty: x.quantity || 1 }));
    // No sale of this printing is not the same as no sale. Returning null
    // sends the comp to the live floor, which IS printing-aware, instead of
    // to the other printing's sales.
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
  const p = parseCardId(id);
  return p ? p.productId : null;
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
        jget(`${TCGCSV}/${EN_CAT}/${groupId}/products`),
        jget(`${TCGCSV}/${EN_CAT}/${groupId}/prices`),
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
