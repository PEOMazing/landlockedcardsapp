import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { atGet, isRecId, T } from "@/lib/airtable";
import QuickSell from "./QuickSell";
import { formatCardNo } from "@/lib/cardNo";

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
        cardNo: formatCardNo(f["Card No"]),
        name: String(f["Card Name"] || "").replace(/\s*-\s*[\w]+\/[\w]+\s*$/, ""),
        setName: f["Set Name"] || "",
        number: f["Number"] || "",
        condition: f["Condition"] || "",
        location: f["Location"] || "",
        printing: f["Printing"] || "",
        image: f["Image URL"] || "",
        comp: f["Comp"] ?? null,
        market: f["Market"] ?? null,
        marketBasis: f["Market Basis"] || "",
        // the productId out of the stored card id, for the tap-through link
        tcgProductId: (() => {
          const m = String(f["Card ID"] || "").match(/^tcg:(\d+):/);
          return m ? parseInt(m[1]) : null;
        })(),
        // the whole sales list, not just the newest, so the scan page can show
        // the working behind the price rather than asserting it
        sales: (() => {
          try {
            const d = f["Comp Detail"] ? JSON.parse(f["Comp Detail"]) : null;
            return Array.isArray(d) ? d.map((x: any) => ({ date: String(x.date), price: Number(x.price), qty: Number(x.qty) || 1 })) : [];
          } catch { return []; }
        })(),
        compSource: f["Comp Source"] || "",
        // the cheapest live asks, so a mislabeled graded card sitting in the
        // raw bucket is visible - nothing in the feed marks it as graded
        listings: (() => {
          try {
            const d = f["Listing Detail"] ? JSON.parse(f["Listing Detail"]) : null;
            return Array.isArray(d) ? d.map((x: any) => Number(x)).filter((n: number) => n > 0) : [];
          } catch { return []; }
        })(),
        status: f["Status"] || "In Stock",
        salePrice: f["Sale Price"] ?? null,
      }}
    />
  );
}
