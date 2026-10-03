import { atList, T } from "./airtable";
import { committedByProduct, committedHoldsByProduct, OpenLine } from "./stockSplit";

/** One show holding units of one product. */
export type ShowHold = {
  streamId: string;
  title: string;
  /** ISO date, or "" on a show with no date set yet. */
  date: string;
  /** Units of this product still on that show. */
  qty: number;
};

// How many units of each sealed product are sitting on a show right now, and
// which shows those are.
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
async function readOpenLines(): Promise<{ lines: OpenLine[]; streams: Map<string, { title: string; date: string }> }> {
  const streamRows = await atList(T.streams, {
    filterByFormula: "{Items Returned} != TRUE()",
    "fields[]": ["Title", "Stream Date"],
  });
  const streams = new Map<string, { title: string; date: string }>();
  for (const s of streamRows) {
    streams.set(s.id, {
      title: String(s.fields["Title"] || "Untitled show"),
      date: String(s.fields["Stream Date"] || ""),
    });
  }
  if (streamRows.length === 0) return { lines: [], streams };

  // Filtered by stream rather than read whole. Every line ever written is
  // thousands of rows and this runs on an inventory page load; open shows are
  // a handful.
  const ors = streamRows.map((s) => `{Stream Rec Id} = '${s.id}'`).join(", ");
  const lineRows = await atList(T.lines, {
    filterByFormula: `OR(${ors})`,
    "fields[]": ["Stream Rec Id", "Product", "Qty", "Qty Hit", "Is Store Purchase"],
  });

  const lines: OpenLine[] = [];
  for (const l of lineRows) {
    const pid = l.fields["Product"]?.[0];
    if (!pid) continue; // a line typed free-hand with no product behind it
    lines.push({
      productId: String(pid),
      qty: Number(l.fields["Qty"] || 0),
      qtyHit: Number(l.fields["Qty Hit"] || 0),
      // every line here belongs to an open show by construction
      returned: false,
      isStore: !!l.fields["Is Store Purchase"],
      streamId: String(l.fields["Stream Rec Id"] || ""),
    });
  }
  return { lines, streams };
}

export async function openCommitmentsByProduct(): Promise<Map<string, number>> {
  const { lines } = await readOpenLines();
  return committedByProduct(lines);
}

/** The same commitments, with the shows named.
 *
 *  Returned as plain arrays rather than Maps because this crosses the wire to
 *  the inventory table, where each product carries its own short list.
 *
 *  Sorted soonest first: the question behind the click is nearly always "when
 *  do I get these back", and the next show is the answer. A show with no date
 *  sorts last rather than to 1970. */
export async function openHoldsByProduct(): Promise<Map<string, ShowHold[]>> {
  const { lines, streams } = await readOpenLines();
  const out = new Map<string, ShowHold[]>();
  for (const [productId, byStream] of committedHoldsByProduct(lines)) {
    const holds: ShowHold[] = [];
    for (const [streamId, qty] of byStream) {
      const s = streams.get(streamId);
      holds.push({
        streamId,
        // A line whose stream row is missing still has to show up. It is a unit
        // that is off the shelf, and silently dropping it would make the panel
        // add up to less than the number that opened it.
        title: s?.title || "Show not found",
        date: s?.date || "",
        qty,
      });
    }
    holds.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.title.localeCompare(b.title));
    out.set(productId, holds);
  }
  return out;
}
