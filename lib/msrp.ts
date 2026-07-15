// Pokemon TCG MSRP reference, verified May 2026 against Pokemon Center,
// Best Buy, and GameStop retail listings. Pokemon Center exclusive variants
// of standard products typically run $10 over standard retail (stamped promo).
// Update this table when TPCi moves prices.

export type MsrpEntry = { label: string; msrp: number | null; range?: [number, number]; note?: string };

// Mega Evolution era sets (late 2025 onward) whose booster bundles carry the
// raised $26.94 MSRP. Older Scarlet & Violet bundles are $23.94.
const ME_ERA = ["phantasmal flames", "ascended heroes", "perfect order", "chaos rising", "pitch black", "mega evolution"];

export const MSRP_TABLE: MsrpEntry[] = [
  { label: "Booster Pack (from display)", msrp: 3.99 },
  { label: "Sleeved Booster Pack", msrp: 5.0 },
  { label: "Booster Display Box (36 packs)", msrp: 143.64, note: "Pokemon Center tier $179.64" },
  { label: "Booster Bundle - Mega Evolution era", msrp: 26.94 },
  { label: "Booster Bundle - older S&V sets", msrp: 23.94 },
  { label: "Elite Trainer Box - standard retail", msrp: 49.99 },
  { label: "Elite Trainer Box - Pokemon Center", msrp: 59.99, note: "PC stamped promo" },
  { label: "Premium Collection / ex Box", msrp: 39.99 },
  { label: "Premium Poster Collection", msrp: 39.99 },
  { label: "Poster Collection (3 packs + foil)", msrp: 14.99 },
  { label: "Super-Premium Collection", msrp: 89.99 },
  { label: "Premium Figure Collection", msrp: 69.99 },
  { label: "Figure Collection (smaller)", msrp: null, range: [59, 65] },
  { label: "Ultra Premium Collection (UPC)", msrp: null, range: [119.99, 169.99] },
  { label: "Mini Tin (single)", msrp: 9.99 },
  { label: "Mini Tin Display (8-count)", msrp: 79.92 },
  { label: "Mini Tin Display (10-count)", msrp: 99.9 },
  { label: "Special Tin (Power / Charizard)", msrp: 24.99 },
  { label: "3-Pack Blister", msrp: 14.99 },
  { label: "Surprise Box", msrp: null, range: [19.99, 24.99] },
  { label: "First Partner Illustration", msrp: 15.99 },
  { label: "Pokemon Day Collection", msrp: 14.99 },
];

// Best-effort MSRP for a product by name. Returns null when the category is
// ambiguous or priced as a range - never guess a number we cannot stand behind.
export function msrpForName(rawName: string): { msrp: number; label: string } | null {
  const n = rawName.toLowerCase();
  const isPC = n.includes("pokemon center");
  const isME = ME_ERA.some((s) => n.includes(s));
  if (n.includes("elite trainer")) return { msrp: isPC ? 59.99 : 49.99, label: isPC ? "PC ETB" : "ETB" };
  if (n.includes("booster box") || n.includes("display box")) return { msrp: isPC ? 179.64 : 143.64, label: "Booster box" };
  if (n.includes("booster bundle")) return { msrp: isME ? 26.94 : 23.94, label: "Bundle" };
  if (n.includes("sleeved booster")) return { msrp: 5.0, label: "Sleeved pack" };
  if (n.includes("booster pack")) return { msrp: 3.99, label: "Pack" };
  if (n.includes("mini tin display")) return n.includes("10") ? { msrp: 99.9, label: "Mini tin display" } : { msrp: 79.92, label: "Mini tin display" };
  if (n.includes("mini tin")) return { msrp: 9.99, label: "Mini tin" };
  if (n.includes("premium poster")) return { msrp: 39.99, label: "Premium poster" };
  if (n.includes("poster collection")) return { msrp: 14.99, label: "Poster collection" };
  if (n.includes("super premium") || n.includes("super-premium")) return { msrp: 89.99, label: "Super-premium" };
  if (n.includes("premium figure")) return { msrp: 69.99, label: "Premium figure" };
  if (n.includes("premium collection") || / ex box| ex showcase/.test(n)) return { msrp: 39.99, label: "Premium collection" };
  if (n.includes("3-pack blister") || n.includes("3 pack blister")) return { msrp: 14.99, label: "3-pack blister" };
  if (n.includes("special collection")) return { msrp: 39.99, label: "Special collection" };
  if (n.includes("tin") && !n.includes("mini")) return { msrp: 24.99, label: "Tin" };
  if (n.includes("first partner")) return { msrp: 15.99, label: "First partner" };
  return null;
}
