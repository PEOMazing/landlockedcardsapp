// CSV export parsing and classification, shared by the in-app importer and the
// inbound email webhook. A row with a card number is a single (graded if Grade
// is not "Ungraded"); a row without one is a sealed product.
//
// Two shapes are understood:
//   Collectr   - Product Name / Quantity / Market Price / Card Condition
//   TCGplayer  - Product Name / Add to Quantity / TCG Market Price / Condition
// TCGplayer prices are per SKU, so the price on the row already reflects that
// row's condition and printing - no NM-basis discount is applied to them.
//
// cl-v2. Three things a TCGplayer export carries that this threw away, all
// found by running a real 48-row file through it before importing:
//
//   1. "Pokemon Japan" is a Product Line of its own, and the category check
//      read anything that was not exactly "pokemon" as a different GAME. So
//      every Japanese card was counted as non-Pokemon and silently set aside -
//      4 cards and $198.80 on that one file, reported only as "4 non-Pokemon
//      rows" next to a promise about One Piece support.
//
//   2. Nothing set Language, so even once those rows were let in they would
//      have landed as English. That is the expensive direction to be wrong in:
//      modern Japanese prints trade at a fraction of their English
//      counterparts, which is why lib/gradedSales filters on language at all.
//      An English comp on a Japanese card does not drift, it multiplies.
//
//   3. Column one of the file is the TCGplayer PRODUCT ID - the exact link the
//      rest of the app is built on - and it went in the bin. Every imported
//      card therefore arrived with no Card ID, which means no rolling
//      reprice, no condition-specific sold comp and no graded sweep. The slab
//      investigation had already shown what that costs: 68 of 70 slabs
//      unlinked and unpriceable, for the same reason.
//
// The product id is carried out of here as an id plus a SLUG, built from the
// Product Line and Set Name columns in the shape TCGplayer puts in a URL. That
// is not a new mechanism: getTcgcsvCardByProductId already takes a slug for
// exactly this, because a bare product id has to be hunted through the newest
// sixteen English sets and a slug names one group out of six hundred. The CSV
// has the same information in columns that a pasted URL has in its path.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export const money = (v: string) => {
  const n = parseFloat(String(v || "").replace(/[$,]/g, ""));
  return isNaN(n) || n <= 0 ? undefined : Math.round(n * 100) / 100;
};

export function mapCondition(grade: string, cardCondition: string): string {
  const g = String(grade || "").toUpperCase();
  if (g && !g.startsWith("UNGRADED")) {
    if (g.startsWith("PSA 10")) return "PSA 10";
    if (g.startsWith("PSA 9")) return "PSA 9";
    if (g.startsWith("PSA 8")) return "PSA 8";
    if (g.startsWith("CGC 10")) return "CGC 10";
    if (g.startsWith("CGC 9.5")) return "CGC 9.5";
    if (g.startsWith("BGS 9.5")) return "BGS 9.5";
    return "Other";
  }
  const c = String(cardCondition || "").toLowerCase();
  if (c.includes("light")) return "LP";
  if (c.includes("moderate")) return "MP";
  if (c.includes("heav")) return "HP";
  if (c.includes("damag")) return "DM";
  return "NM";
}

/** The TCGplayer catalogs we handle, as they appear in the Product Line column
 *  and as TCGplayer spells them in a URL. Order matters: the longer prefix is
 *  tested first, or "Pokemon Japan" matches as plain "Pokemon". */
const PRODUCT_LINES: { line: string; slug: string; language: string }[] = [
  { line: "pokemon japan", slug: "pokemon-japan", language: "Japanese" },
  { line: "pokemon", slug: "pokemon", language: "" },
];

/** Whether this Product Line is a Pokemon catalog at all.
 *
 *  A blank line is treated as Pokemon, because that is what the Collectr
 *  exports look like and this importer has always assumed it. */
export function isPokemonLine(productLine: string): boolean {
  const v = String(productLine || "").trim().toLowerCase();
  return !v || PRODUCT_LINES.some((p) => v === p.line || v.startsWith(p.line + " "));
}

/** The language a row is in, read from the catalog first and the condition
 *  second. Blank means English, which is how the Language column is read
 *  everywhere else - the exception gets marked, not the rule.
 *
 *  Two places say it because the two exports disagree about where to put it:
 *  the Product Line column says "Pokemon Japan", and the per-SKU condition
 *  says "Near Mint - Japanese". A file can carry either or both. */
export function languageFor(productLine: string, condition: string): string {
  const line = String(productLine || "").trim().toLowerCase();
  for (const p of PRODUCT_LINES) {
    if (p.language && (line === p.line || line.startsWith(p.line + " "))) return p.language;
  }
  const c = String(condition || "").toLowerCase();
  for (const lang of ["japanese", "korean", "chinese", "german", "french", "italian", "spanish", "portuguese"]) {
    if (c.includes(lang)) return lang[0].toUpperCase() + lang.slice(1);
  }
  return "";
}

const slugPart = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** The row rebuilt into the shape TCGplayer puts in a product URL:
 *  catalog, then set, then card. "pokemon-japan-sv5k-wild-force-gastly".
 *
 *  Only the catalog and the set actually matter - slugGroups matches the set
 *  by prefix and ignores the tail - but the card name goes on anyway so the
 *  value is the same thing a pasted link would have produced, and so a reader
 *  can tell at a glance which row built it.
 *
 *  Returns "" when there is no set to name, because a slug with no set in it
 *  narrows nothing and the caller is better off knowing that. */
export function tcgSlugFor(productLine: string, setName: string, productName = ""): string {
  const line = String(productLine || "").trim().toLowerCase();
  const cat = PRODUCT_LINES.find((p) => line === p.line || line.startsWith(p.line + " "))?.slug
    ?? (line ? slugPart(line) : "pokemon");
  const set = slugPart(setName);
  if (!set) return "";
  // The card name loses its trailing "- 080/071", which is bookkeeping rather
  // than part of the name and is not in the URL either.
  const card = slugPart(String(productName || "").replace(/\s*-\s*[0-9a-z]+(?:\/[0-9a-z]+)?\s*$/i, ""));
  return [cat, set, card].filter(Boolean).join("-");
}

/** Whether the Condition column is describing a CARD rather than a sealed box.
 *
 *  The card-number test is the main rule for telling a single from a sealed
 *  product and it is right nearly always, but it is wrong on an unnumbered
 *  promo: "Timeless Celebi" out of the 10th Movie Commemoration Set has no
 *  number, and read by number alone it imports as a sealed product. The
 *  condition settles it, because sealed product comes through as "Unopened"
 *  and never as a card grade. */
export function looksLikeCardCondition(condition: string): boolean {
  const c = String(condition || "").trim().toLowerCase();
  if (!c) return false;
  if (c.includes("unopened") || c.includes("sealed")) return false;
  return /near mint|lightly played|moderately played|heavily played|damaged|\bnm\b|\blp\b|\bmp\b|\bhp\b|psa|bgs|cgc|sgc/.test(c);
}

export type ClassifiedPortfolios = {
  portfolios: Record<string, { sealed: any[]; singles: any[] }>;
  skipped: number;
  nonPokemon: number;
};

export function classifyCollectrCsv(text: string): ClassifiedPortfolios {
  const grid = parseCsv(text);
  if (grid.length < 2) return { portfolios: {}, skipped: 0, nonPokemon: 0 };
  const header = grid[0].map((h) => h.trim());
  const col = (want: string[]) => header.findIndex((h) => want.some((w) => h.toLowerCase().startsWith(w)));
  // Some exports carry several candidates for one value - TCGplayer ships both
  // Total Quantity and Add to Quantity, and only one of them is filled in. Keep
  // every match in the order asked for and read the first that has a value.
  const colsFor = (want: string[]) =>
    want
      .map((w) => header.findIndex((h) => h.toLowerCase().startsWith(w)))
      .filter((i) => i >= 0)
      .filter((i, n, a) => a.indexOf(i) === n);
  const firstOf = (r: string[], idxs: number[]) => {
    for (const i of idxs) {
      const v = (r[i] || "").trim();
      if (v !== "") return v;
    }
    return "";
  };
  const iName = col(["product name", "card name", "name"]);
  if (iName < 0) return { portfolios: {}, skipped: grid.length - 1, nonPokemon: 0 };
  const isTcg = header.some((h) => /^tcg/i.test(h.trim()));
  const qtyCols = colsFor(["quantity", "qty", "total quantity", "add to quantity"]);
  const iPortfolio = col(["portfolio"]);
  // TCGplayer names the game column "Product Line"
  const iCategory = col(["category", "product line"]);
  const iSet = col(["set"]);
  const iNumber = col(["card number", "number"]);
  const iRarity = col(["rarity"]);
  const iVariance = col(["variance", "printing"]);
  const iGrade = col(["grade"]);
  const iCond = col(["card condition", "condition"]);
  const iBuy = col(["average cost paid", "cost paid", "buy price", "cost", "price paid"]);
  // market first, then the seller's own listed price, then low as a floor
  const marketCols = colsFor([
    "market price", "market value", "tcg market price",
    "tcg marketplace price", "tcg low price with shipping", "tcg low price",
  ]);
  const imageCols = colsFor(["photo url", "image url", "image"]);
  const iNotes = col(["notes"]);
  const iAdded = col(["date added"]);
  // cl-v2. The TCGplayer product id. Deliberately NOT matched on a bare
  // "product id" prefix alone would also hit "Product Line" and "Product
  // Name", so the exact header is checked first and the loose forms after.
  const iProductId = (() => {
    const exact = header.findIndex((h) => /^product\s*id$/i.test(h.trim()));
    if (exact >= 0) return exact;
    return header.findIndex((h) => /^(tcgplayer\s*product\s*id|tcg\s*product\s*id)$/i.test(h.trim()));
  })();

  const portfolios: ClassifiedPortfolios["portfolios"] = {};
  let skipped = 0, nonPokemon = 0;
  for (const r of grid.slice(1)) {
    const name = (r[iName] || "").trim();
    if (!name) { skipped++; continue; }
    // One game at a time for now: One Piece and other categories are counted
    // and reported, not silently dropped.
    // cl-v2. Every Pokemon catalog, not only the one spelled exactly
    // "Pokemon". "Pokemon Japan" is the same game in a different catalog and
    // was being set aside as though it were One Piece.
    const line = iCategory >= 0 ? (r[iCategory] || "").trim() : "";
    if (!isPokemonLine(line)) { nonPokemon++; continue; }
    const pf = iPortfolio >= 0 ? (r[iPortfolio] || "").trim() || "default" : "default";
    if (!portfolios[pf]) portfolios[pf] = { sealed: [], singles: [] };
    const qty = Math.max(1, parseInt(firstOf(r, qtyCols)) || 1);
    const buy = iBuy >= 0 ? money(r[iBuy]) : undefined;
    const market = money(firstOf(r, marketCols));
    const imageUrl = firstOf(r, imageCols);
    const number = iNumber >= 0 ? (r[iNumber] || "").trim() : "";
    const dateAdded = iAdded >= 0 ? (r[iAdded] || "").trim() : "";
    const setName = iSet >= 0 ? (r[iSet] || "").trim() : "";
    const rawCond = iCond >= 0 ? (r[iCond] || "").trim() : "";
    const pid = iProductId >= 0 ? parseInt((r[iProductId] || "").trim(), 10) : NaN;
    const productId = Number.isFinite(pid) && pid > 0 ? pid : undefined;
    // A number means a card. So does a card-shaped condition on a row with no
    // number, which is what an unnumbered promo looks like - see
    // looksLikeCardCondition.
    if (number || looksLikeCardCondition(rawCond)) {
      const variance = iVariance >= 0 ? (r[iVariance] || "").trim() : "";
      const condition = mapCondition(iGrade >= 0 ? r[iGrade] : "", rawCond);
      portfolios[pf].singles.push({
        name, qty, buy, comp: market, number,
        setName,
        rarity: iRarity >= 0 ? (r[iRarity] || "").trim() : "",
        printing: /reverse/i.test(variance) ? "Reverse" : /holo/i.test(variance) ? "Holo" : "",
        condition,
        imageUrl,
        // TCGplayer quotes per SKU, so the row price is already this condition
        compSource: isTcg ? `TCGplayer export (market, ${condition})` : "Collectr import (market)",
        notes: iNotes >= 0 ? (r[iNotes] || "").trim() : "",
        dateAdded,
        // cl-v2. Blank for English, matching how the Language column is read
        // everywhere else: the exception is marked, the rule is not.
        language: languageFor(line, rawCond),
        // cl-v2. The link, and the slug that makes looking it up one group
        // load instead of a hunt through the catalog.
        productId,
        tcgSlug: productId ? tcgSlugFor(line, setName, name) : "",
      });
    } else {
      portfolios[pf].sealed.push({ name, qty, buy, market, imageUrl, dateAdded });
    }
  }
  return { portfolios, skipped, nonPokemon };
}
