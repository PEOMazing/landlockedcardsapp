import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import StatTile from "@/components/ui/StatTile";
import { atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { isSlab } from "@/lib/slab";
import LinkClient, { type LinkRow } from "./LinkClient";

export const dynamic = "force-dynamic";

// lk-v1. The cards with no TCGplayer product behind them.
//
// This list is the honest end of the set-name work. The automatic path got 11
// of the 24 cards that had no art, all by correcting a set name. The rest
// cannot be found by any rule that is safe: searching by card name and number
// with the set ignored was measured against the live mirror and returns
// confidently wrong products, which on a page a buyer reads is worse than a
// blank.
//
// Sorted dearest first, because the cost of an unlinked card scales with the
// card. A $900 slab that never reprices is a real exposure; a 20 cent common
// that never reprices is a rounding error, and the two should not be the same
// amount of work away from each other.
export default async function LinkPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isManager) redirect("/singles");

  const rows = await atList(T.singles, {
    filterByFormula: "AND({Card Name} != '', OR({Status} = 'In Stock', {Status} = 'In Stream'), {Card ID} = '')",
  }).catch(() => [] as any[]);

  const all: LinkRow[] = (rows as any[]).map((r) => ({
    id: r.id,
    cardNo: typeof r.fields["Card No"] === "number" ? r.fields["Card No"] : null,
    name: String(r.fields["Card Name"] || ""),
    setName: String(r.fields["Set Name"] || ""),
    number: String(r.fields["Card Number"] || ""),
    condition: String(r.fields["Condition"] || "Raw"),
    language: String(r.fields["Language"] || ""),
    comp: typeof r.fields["Comp"] === "number" ? r.fields["Comp"] : null,
    image: String(r.fields["Image URL"] || ""),
  }));
  all.sort((a, b) => (b.comp ?? -1) - (a.comp ?? -1));

  const slabs = all.filter((r) => isSlab(r.condition));
  const noArt = all.filter((r) => !r.image);
  const value = all.reduce((a, r) => a + (r.comp || 0), 0);

  return (
    <>
      <Nav isAdmin={me.isAdmin} isManager={me.isManager} name={me.streamer?.fields?.["Name"] || "Team"} />
      <main className="max-w-6xl mx-auto p-6 space-y-5">
        <div>
          <h1 className="t-page">Link to TCGplayer</h1>
          <p className="text-dim text-sm mt-1">
            Cards with no TCGplayer product behind them. An unlinked card is frozen: it does not
            reprice on the rolling pass, it has no condition-specific sold comp, and it never
            reaches the graded sweep. Most of these came in from a Collectr export whose set names
            TCGplayer does not use, and the ones left are the ones no rule can fix safely. Paste
            the product link once and the card joins the rest of the collection.
          </p>
        </div>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Cards to link" value={String(all.length)} size="md" tone={all.length > 0 ? "warn" : undefined} />
          <StatTile label="Comp sitting on them" value={`$${Math.round(value).toLocaleString("en-US")}`} size="md" />
          <StatTile label="Of those, graded" value={String(slabs.length)} size="md" />
          <StatTile label="Of those, no picture" value={String(noArt.length)} size="md" />
        </section>

        <LinkClient rows={all} />

        <p className="text-dim text-xs">
          Linking writes the product id, the art and the printing qualifier, and a rarity only if
          the record had none. It does not touch the comp, the set, the number or the card name:
          those are what somebody typed with the card in their hand, and a product page is not
          better evidence about the object in the sleeve than the person looking at it.
        </p>
      </main>
    </>
  );
}
