import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { atGet, isRecId, T } from "@/lib/airtable";
import QuickSell from "./QuickSell";

export const dynamic = "force-dynamic";

// The page a printed label's QR resolves to: the card, its price, and one
// button to book the sale. The sticker is a point of sale.
export default async function LabelPage({ params }: { params: { id: string } }) {
  // public read-only: a customer scanning the sticker sees the card and its
  // live price. Only signed-in managers get the sell button.
  const me = await getMe().catch(() => null);
  if (!isRecId(params.id)) redirect(me ? "/singles" : "/sign-in");
  const rec = await atGet(T.singles, params.id).catch(() => null);
  if (!rec) redirect(me ? "/singles" : "/sign-in");
  const f = rec.fields;
  return (
    <QuickSell
      id={params.id}
      isManager={!!me?.isManager}
      card={{
        name: String(f["Card Name"] || "").replace(/\s*-\s*[\w]+\/[\w]+\s*$/, ""),
        setName: f["Set Name"] || "",
        number: f["Number"] || "",
        condition: f["Condition"] || "",
        location: f["Location"] || "",
        printing: f["Printing"] || "",
        image: f["Image URL"] || "",
        comp: f["Comp"] ?? null,
        status: f["Status"] || "In Stock",
        salePrice: f["Sale Price"] ?? null,
      }}
    />
  );
}
