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

// Looking a pasted line up against inventory.
//
// The old matcher answered with a product or with null, and null meant two very
// different things that need opposite responses:
//
//   nothing in inventory is called that        -> add the product, or fix the typo
//   several products could be called that      -> say which one you meant
//
// Both came back as "not in inventory", and that message is actively harmful on
// the second one. It tells you to create a product you already own, which is
// exactly how a second copy at $0 market gets made, which is the thing the
// alias system at the top of this file exists to prevent. The user does the
// damage, following instructions the app gave them.
//
// So the result says which case it is, and carries the candidates when it is
// the ambiguous one.

export type NameMatch =
  | { kind: "exact"; product: AtRecord }
  | { kind: "unique"; product: AtRecord }
  | { kind: "ambiguous"; candidates: AtRecord[] }
  | { kind: "none" };

// How long a name has to be before substring containment is evidence of
// anything. Without this, a product genuinely named "Tin" or "ETB" matches
// every pasted line that happens to contain those letters, and the paste picks
// up the wrong product silently, which is worse than failing.
//
// Six is above the common short-word traps (tin, etb, pack, box, lot) and below
// the shortest real product names, which run to multiple words.
export const MIN_FUZZY_LEN = 6;

const key = (s: unknown) => String(s || "").trim().toLowerCase();

export function matchProduct(name: string, inventory: AtRecord[]): NameMatch {
  const n = key(name);
  if (!n) return { kind: "none" };

  // An exact hit on any alias wins outright, and a current name beats a former
  // one when both records answer to the same string.
  const exact = inventory.filter((r) => productAliases(r).some((a) => key(a) === n));
  if (exact.length > 0) {
    const current = exact.find((r) => key(r.fields["Product Name"]) === n);
    return { kind: "exact", product: current ?? exact[0] };
  }

  const hits: AtRecord[] = [];
  for (const r of inventory) {
    for (const a of productAliases(r)) {
      const p = key(a);
      if (!p) continue;
      const pastedContainsProduct = p.length >= MIN_FUZZY_LEN && n.includes(p);
      const productContainsPasted = n.length >= MIN_FUZZY_LEN && p.includes(n);
      if (pastedContainsProduct || productContainsPasted) { hits.push(r); break; }
    }
  }

  if (hits.length === 1) return { kind: "unique", product: hits[0] };
  if (hits.length > 1) return { kind: "ambiguous", candidates: hits };
  return { kind: "none" };
}

/** The product a match landed on, or null when it did not land on one. */
export function matchedProduct(m: NameMatch): AtRecord | null {
  return m.kind === "exact" || m.kind === "unique" ? m.product : null;
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
