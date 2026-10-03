import { atDelete, atList, atUpdate, T, AtRecord } from "./airtable";
import { clampStock } from "./stock";

export const GRACE_HOURS = 72;

// Streams are soft-deleted: a Deleted At stamp hides them from every list,
// pay calculation, and dashboard. Within the grace window an admin can
// reinstate; after it, this purge runs (lazily, when the admin streams page
// loads) and hard-deletes the stream, returning product to stock first.
export async function listDeletedAndPurge(): Promise<AtRecord[]> {
  const deleted = await atList(T.streams, {
    filterByFormula: "NOT({Deleted At} = BLANK())",
    "sort[0][field]": "Deleted At",
    "sort[0][direction]": "desc",
  });
  const cutoff = Date.now() - GRACE_HOURS * 60 * 60 * 1000;
  const pending: AtRecord[] = [];
  for (const s of deleted) {
    const at = new Date(s.fields["Deleted At"]).getTime();
    if (isNaN(at) || at >= cutoff) {
      pending.push(s);
      continue;
    }
    await purgeStream(s);
  }
  return pending;
}

async function purgeStream(stream: AtRecord): Promise<void> {
  const lines = await atList(T.lines, {
    filterByFormula: `{Stream Rec Id} = '${stream.id}'`,
  });
  const itemsReturned = !!stream.fields["Items Returned"];
  for (const line of lines) {
    // Un-returned sealed product goes back on the shelf before the line dies,
    // but only the part of it that is still physically here.
    //
    // This used to put the line's whole Qty back, which invents stock twice
    // over. A line of 40 packs with 12 hit means 12 packs were ripped and
    // mailed to buyers: only 28 can come back. Crediting 40 cancels the
    // build's decrement entirely and leaves twelve packs on the books that
    // are in somebody else's house.
    //
    // Store purchases never came off this shelf in the first place when the
    // sale was pending (lib/storeSales.ts only decrements when there is stock
    // to take), so crediting them conjures product from nothing. Both close
    // paths already skip store lines; this was the one that did not.
    const productId = line.fields["Product"]?.[0];
    const isStore = !!line.fields["Is Store Purchase"];
    const back = Math.max(0, (line.fields["Qty"] || 0) - (line.fields["Qty Hit"] || 0));
    if (!itemsReturned && productId && !isStore && back > 0) {
      try {
        const inv = await atList(T.inventory, { filterByFormula: `RECORD_ID() = '${productId}'` });
        if (inv[0]) {
          const onHand = inv[0].fields["Qty On Hand"] ?? 0;
          await atUpdate(T.inventory, productId, { "Qty On Hand": clampStock(onHand + back) });
        }
      } catch {}
    }
    await atDelete(T.lines, line.id);
  }
  // singles that were on this stream and never sold go back in stock
  if (!itemsReturned) {
    try {
      const singles = await atList(T.singles, {
        filterByFormula: `AND({Stream Rec Id} = '${stream.id}', {Status} = 'In Stream')`,
      });
      for (const s of singles) {
        await atUpdate(T.singles, s.id, { "Status": "In Stock", "Stream Rec Id": "" });
      }
    } catch {}
  }
  await atDelete(T.streams, stream.id);
}
