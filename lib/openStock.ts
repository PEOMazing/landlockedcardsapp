import { atList, T } from "./airtable";
import { committedByProduct, OpenLine } from "./stockSplit";

// How many units of each sealed product are sitting on a show right now.
//
// Reads the lines rather than a stored column, on purpose: see the note at the
// top of stockSplit.ts. The job here is only to turn Airtable rows into the
// shape that file reasons about.
//
// "Open" means Items Returned is not set yet, and that is the only test. A
// soft-deleted show counts too even though it is in the trash, because its
// units have not been credited back to the shelf yet and the purge will do
// that later. Including it keeps onHand + onShows invariant across the purge:
// the units move from one column to the other instead of vanishing from the
// total for three days and making the business look like it owns less than it
// does.
export async function openCommitmentsByProduct(): Promise<Map<string, number>> {
  const streams = await atList(T.streams, {
    filterByFormula: "{Items Returned} != TRUE()",
    "fields[]": ["Title"],
  });
  if (streams.length === 0) return new Map();

  // Filtered by stream rather than read whole. Every line ever written is
  // thousands of rows and this runs on an inventory page load; open shows are
  // a handful.
  const ors = streams.map((s) => `{Stream Rec Id} = '${s.id}'`).join(", ");
  const lines = await atList(T.lines, {
    filterByFormula: `OR(${ors})`,
    "fields[]": ["Stream Rec Id", "Product", "Qty", "Qty Hit", "Is Store Purchase"],
  });

  const rows: OpenLine[] = [];
  for (const l of lines) {
    const pid = l.fields["Product"]?.[0];
    if (!pid) continue; // a line typed free-hand with no product behind it
    rows.push({
      productId: String(pid),
      qty: Number(l.fields["Qty"] || 0),
      qtyHit: Number(l.fields["Qty Hit"] || 0),
      // every line here belongs to an open show by construction
      returned: false,
      isStore: !!l.fields["Is Store Purchase"],
    });
  }
  return committedByProduct(rows);
}
