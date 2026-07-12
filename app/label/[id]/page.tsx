import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { atGet, isRecId, T } from "@/lib/airtable";
import QuickSell from "./QuickSell";

export const dynamic = "force-dynamic";

// The page a printed label's QR resolves to: the card, its price, and one
// button to book the sale. The sticker is a point of sale.
export default async function LabelPage({ params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!isRecId(params.id)) redirect("/singles");
  const rec = await atGet(T.singles, params.id).catch(() => null);
  if (!rec) redirect("/singles");
  const f = rec.fields;
  return (
    <QuickSell
      id={params.id}
      isManager={me.isManager}
      card={{
        name: String(f["Card Name"] || "").replace(/\s*-\s*[\w]+\/[\w]+\s*$/, ""),
        setName: f["Set Name"] || "",
        number: f["Number"] || "",
        condition: f["Condition"] || "",
        printing: f["Printing"] || "",
        image: f["Image URL"] || "",
        comp: f["Comp"] ?? null,
        status: f["Status"] || "In Stock",
        salePrice: f["Sale Price"] ?? null,
      }}
    />
  );
}
