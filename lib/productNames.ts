import { AtRecord } from "./airtable";

// Products get renamed - most often when a mapped product takes on its real
// TCGplayer name - but the names people type do not. Show sets pasted from
// memory, Collectr exports and portfolio imports all look products up by name,
// and every one of them CREATES a product when the lookup misses. A miss after
// a rename therefore does not fail loudly: it quietly makes a second copy of a
// product you already own, at $0 market, which then drags down profit over
// market on every show it lands in.
//
// So a product answers to its current name and to every name it has been
// renamed away from.

export function productAliases(r: AtRecord): string[] {
  const out: string[] = [];
  const current = String(r.fields["Product Name"] || "").trim();
  if (current) out.push(current);
  for (const f of String(r.fields["Former Names"] || "").split("\n")) {
    const t = f.trim();
    if (t) out.push(t);
  }
  return out;
}

// Lowercase name -> record. A current name always beats a former name when two
// products would otherwise claim the same key.
export function indexByName(records: AtRecord[]): Map<string, AtRecord> {
  const map = new Map<string, AtRecord>();
  for (const r of records) {
    const current = String(r.fields["Product Name"] || "").trim().toLowerCase();
    for (const a of productAliases(r)) {
      const k = a.toLowerCase();
      if (!map.has(k) || k === current) map.set(k, r);
    }
  }
  return map;
}

// Fields that rename a mapped product to its real TCGplayer name, keeping the
// name it had so nothing that looks products up by name breaks. Returns null
// when there is nothing to do, so callers can merge it into an update blindly.
//
// This runs wherever a product's exact TCGplayer identity is known: at the
// moment it is mapped, and on every refresh afterwards. A mapped product id
// cannot be the wrong product, so its name is a fact, not a guess.
export function renameFields(
  rec: { fields: Record<string, any> } | null | undefined,
  tcgName: string
): Record<string, any> | null {
  const proposed = String(tcgName || "").trim();
  if (!proposed) return null;
  const current = String(rec?.fields["Product Name"] || "").trim();
  if (!current || current === proposed) return null;

  const prior = String(rec?.fields["Former Names"] || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!prior.some((p) => p.toLowerCase() === current.toLowerCase())) prior.push(current);

  return { "Product Name": proposed, "Former Names": prior.join("\n") };
}
