export const CATEGORIES = [
  "Elite Trainer Box",
  "Booster Box",
  "Booster Bundle",
  "Booster Pack",
  "Premium Collection",
  "Super Premium Collection",
  "Blister",
  "Graded Card",
  "Giveaway",
  "Other",
];

// best-guess category from a product name (used by CSV import)
export function categoryForName(name: string): string {
  const n = String(name).toLowerCase();
  if (n.includes("super premium")) return "Super Premium Collection";
  if (n.includes("booster bundle")) return "Booster Bundle";
  if (n.includes("elite trainer box")) return "Elite Trainer Box";
  if (n.includes("booster box")) return "Booster Box";
  if (n.includes("booster pack")) return "Booster Pack";
  if (n.includes("blister")) return "Blister";
  if (/premium collection|poster collection|figure collection|special collection|showcase|illustration collection|sticker collection|ex collection/.test(n)) return "Premium Collection";
  return "Other";
}
