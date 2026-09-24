import { atList, T } from "@/lib/airtable";
import { formatCardNo } from "@/lib/cardNo";
import ShareClient, { ShareCard } from "./ShareClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "LandLocked Cards - Singles",
  description: "Single cards currently in stock.",
};

// The list a customer gets sent.
//
// Public on purpose, and narrow on purpose. It reads Airtable on every load so
// it is never a stale snapshot, but it is built from a deliberate subset of
// the columns: what the card is, what condition it is in, and what it is
// worth. Buy price, sale price, notes, binder pocket and anything that belongs
// to a collector rather than the company never leave the server.
//
// In Stock only. A card on a stream or already sold is not something anyone
// should be asking about.
export default async function SharePage() {
  const rows = await atList(T.singles, {
    filterByFormula: "AND({Status} = 'In Stock', {Owner Rec Id} = BLANK())",
    "fields[]": [
      "Card Name", "Set Name", "Card Number", "Rarity", "Variant",
      "Condition", "Language", "Printing", "Comp", "Image URL", "Card No",
      "Order Pending",
    ],
    "sort[0][field]": "Card Name",
    "sort[0][direction]": "asc",
  }).catch(() => []);

  const cards: ShareCard[] = rows
    .map((r) => ({
      id: r.id,
      cardNo: formatCardNo(r.fields["Card No"]),
      name: String(r.fields["Card Name"] || ""),
      setName: String(r.fields["Set Name"] || ""),
      number: String(r.fields["Card Number"] || ""),
      rarity: String(r.fields["Rarity"] || ""),
      variant: String(r.fields["Variant"] || ""),
      condition: String(r.fields["Condition"] || ""),
      language: String(r.fields["Language"] || ""),
      printing: String(r.fields["Printing"] || ""),
      price: Number(r.fields["Comp"]) > 0 ? Number(r.fields["Comp"]) : null,
      image: String(r.fields["Image URL"] || ""),
      // somebody has already asked for this one; it stays listed so a second
      // buyer can decide for themselves whether to chance it
      pending: !!r.fields["Order Pending"],
    }))
    .filter((c) => c.name);

  return <ShareClient cards={cards} updated={new Date().toISOString()} />;
}
