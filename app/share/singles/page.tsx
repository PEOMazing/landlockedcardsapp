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
// the columns: what the card is, what condition it is in, where it sits, and
// what it is worth. Buy price, sale price, notes and anything that belongs to
// a collector rather than the company never leave the server.
//
// Slot is on the list deliberately, having started off it. It is the big
// number printed on the sticker and the pocket the card is physically in, so
// it is what anyone actually pulling an order reads. Treating it as a secret
// protected nothing: it is already printed on the front of every card in the
// binder and encoded in the QR that this page links to.
//
// In Stock only. A card on a stream or already sold is not something anyone
// should be asking about.
export default async function SharePage() {
  const rows = await atList(T.singles, {
    filterByFormula: "AND({Status} = 'In Stock', {Owner Rec Id} = BLANK())",
    "fields[]": [
      "Card Name", "Set Name", "Card Number", "Rarity", "Variant",
      "Condition", "Language", "Printing", "Comp", "Image URL", "Card No",
      "Order Pending", "Slot",
    ],
    "sort[0][field]": "Card Name",
    "sort[0][direction]": "asc",
  }).catch(() => []);

  const cards: ShareCard[] = rows
    .map((r) => ({
      id: r.id,
      cardNo: formatCardNo(r.fields["Card No"]),
      // Plain, not zero-padded: the sticker prints it plain and a card in
      // pocket 80 reading "0080" here is a second thing to mentally translate
      // while holding a binder. Blank when the card is not filed in one.
      slot: Number(r.fields["Slot"]) > 0 ? String(Math.floor(Number(r.fields["Slot"]))) : "",
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
