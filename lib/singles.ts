import { AtRecord } from "./airtable";

// Shape an Airtable Singles record for the client. Buy price is admin-only,
// matching the sealed inventory.
export function toSingle(r: AtRecord, isAdmin: boolean) {
  const f = r.fields;
  return {
    id: r.id,
    name: f["Card Name"] || "",
    setName: f["Set Name"] || "",
    number: f["Card Number"] || "",
    cardId: f["Card ID"] || "",
    location: f["Location"] || "",
    rarity: f["Rarity"] || "",
    variant: f["Variant"] || "",
    condition: f["Condition"] || "Raw",
    comp: f["Comp"] ?? null,
    compSource: f["Comp Source"] || "",
    compDate: f["Comp Date"] || "",
    compDetail: (() => {
      try { return f["Comp Detail"] ? JSON.parse(f["Comp Detail"]) : null; } catch { return null; }
    })(),
    tcgProductId: (() => {
      const m = String(f["Card ID"] || "").match(/^tcg:(\d+):/);
      return m ? parseInt(m[1]) : null;
    })(),
    image: f["Image URL"] || "",
    qty: f["Qty"] ?? 1,
    status: f["Status"] || "In Stock",
    streamRecId: f["Stream Rec Id"] || "",
    salePrice: f["Sale Price"] ?? null,
    soldDate: f["Sold Date"] || "",
    entryComp: f["Entry Comp"] ?? null,
    printing: f["Printing"] || "",
    notes: f["Notes"] || "",
    addedBy: f["Added By"] || "",
    dateAdded: f["Date Added"] || "",
    ...(isAdmin ? { buy: f["Buy Price"] ?? 0 } : {}),
  };
}
