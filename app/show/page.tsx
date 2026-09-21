import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { atList, T } from "@/lib/airtable";
import type { ShowCard } from "@/lib/showCatalog";
import ShowClient from "./ShowClient";

// The card show directory. Public on purpose: a QR on the table sends buyers
// here on their own phones, and the team gets the same page from the nav.
//
// Speed is the whole brief, so the page never makes a buyer wait on Airtable.
// The in-stock list is fetched once, cached for a minute, and baked into the
// page itself; the browser then filters it locally with no round trips. A card
// sold at the table drops off within a minute, and tapping any tile opens its
// live label page, which is always current.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Card Show - LandLocked Cards",
  description: "Every single we have in stock, searchable by set or Pokemon, with sticker numbers and prices.",
};

// Only what a buyer should see. Buy price, notes, location and owner are never
// requested, so they cannot leak onto a public page by accident.
const FIELDS = ["Card Name", "Set Name", "Card Number", "Condition", "Variant", "Comp", "Image URL", "Card No", "Qty", "Language"];

const loadCatalog = unstable_cache(
  async (): Promise<ShowCard[]> => {
    const rows = await atList(T.singles, {
      // company stock only: a collector's private cards have an Owner Rec Id
      filterByFormula: "AND({Status} = 'In Stock', {Owner Rec Id} = '')",
      "fields[]": FIELDS,
      pageSize: "100",
    });
    return rows.map((r) => {
      const f = r.fields;
      const lang = String(f["Language"] || "");
      const comp = Number(f["Comp"]);
      return {
        id: r.id,
        no: Number.isFinite(Number(f["Card No"])) && f["Card No"] !== undefined ? Number(f["Card No"]) : null,
        name: String(f["Card Name"] || ""),
        set: String(f["Set Name"] || ""),
        num: String(f["Card Number"] || ""),
        cond: String(f["Condition"] || ""),
        variant: String(f["Variant"] || ""),
        price: f["Comp"] !== undefined && f["Comp"] !== null && Number.isFinite(comp) && comp > 0 ? comp : null,
        img: String(f["Image URL"] || ""),
        qty: Math.max(1, Math.floor(Number(f["Qty"]) || 1)),
        lang: lang && lang !== "English" ? lang : "",
      };
    });
  },
  ["show-catalog-v1"],
  { revalidate: 60, tags: ["show-catalog"] }
);

export default async function ShowPage() {
  let cards: ShowCard[] = [];
  let failed = false;
  try {
    cards = await loadCatalog();
  } catch {
    failed = true;
  }
  return <ShowClient cards={cards} failed={failed} />;
}
