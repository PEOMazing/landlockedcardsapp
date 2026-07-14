// Collectr export parsing and classification, shared by the in-app importer
// and the inbound email webhook. A row with a card number is a single (graded
// if Grade is not "Ungraded"); a row without one is a sealed product.

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
  const iName = col(["product name", "card name", "name"]);
  if (iName < 0) return { portfolios: {}, skipped: grid.length - 1, nonPokemon: 0 };
  const iQty = col(["quantity", "qty"]);
  const iPortfolio = col(["portfolio"]);
  const iCategory = col(["category"]);
  const iSet = col(["set"]);
  const iNumber = col(["card number", "number"]);
  const iRarity = col(["rarity"]);
  const iVariance = col(["variance", "printing"]);
  const iGrade = col(["grade"]);
  const iCond = col(["card condition", "condition"]);
  const iBuy = col(["average cost paid", "cost paid", "buy price", "cost", "price paid"]);
  const iMarket = col(["market price", "market value"]);
  const iNotes = col(["notes"]);
  const iAdded = col(["date added"]);

  const portfolios: ClassifiedPortfolios["portfolios"] = {};
  let skipped = 0, nonPokemon = 0;
  for (const r of grid.slice(1)) {
    const name = (r[iName] || "").trim();
    if (!name) { skipped++; continue; }
    // One game at a time for now: One Piece and other categories are counted
    // and reported, not silently dropped.
    const cat = iCategory >= 0 ? (r[iCategory] || "").trim().toLowerCase() : "pokemon";
    if (cat && cat !== "pokemon") { nonPokemon++; continue; }
    const pf = iPortfolio >= 0 ? (r[iPortfolio] || "").trim() || "default" : "default";
    if (!portfolios[pf]) portfolios[pf] = { sealed: [], singles: [] };
    const qty = Math.max(1, parseInt(r[iQty]) || 1);
    const buy = iBuy >= 0 ? money(r[iBuy]) : undefined;
    const market = iMarket >= 0 ? money(r[iMarket]) : undefined;
    const number = iNumber >= 0 ? (r[iNumber] || "").trim() : "";
    const dateAdded = iAdded >= 0 ? (r[iAdded] || "").trim() : "";
    if (number) {
      const variance = iVariance >= 0 ? (r[iVariance] || "").trim() : "";
      portfolios[pf].singles.push({
        name, qty, buy, comp: market, number,
        setName: iSet >= 0 ? (r[iSet] || "").trim() : "",
        rarity: iRarity >= 0 ? (r[iRarity] || "").trim() : "",
        printing: /reverse/i.test(variance) ? "Reverse" : /holo/i.test(variance) ? "Holo" : "",
        condition: mapCondition(iGrade >= 0 ? r[iGrade] : "", iCond >= 0 ? r[iCond] : ""),
        notes: iNotes >= 0 ? (r[iNotes] || "").trim() : "",
        dateAdded,
      });
    } else {
      portfolios[pf].sealed.push({ name, qty, buy, market, dateAdded });
    }
  }
  return { portfolios, skipped, nonPokemon };
}
