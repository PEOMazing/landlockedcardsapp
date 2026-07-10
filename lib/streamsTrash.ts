import { atDelete, atList, atUpdate, T, AtRecord } from "./airtable";

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
    // un-returned sealed product goes back on the shelf before the line dies
    const productId = line.fields["Product"]?.[0];
    if (!itemsReturned && productId) {
      try {
        const inv = await atList(T.inventory, { filterByFormula: `RECORD_ID() = '${productId}'` });
        if (inv[0]) {
          const onHand = inv[0].fields["Qty On Hand"] ?? 0;
          await atUpdate(T.inventory, productId, { "Qty On Hand": onHand + (line.fields["Qty"] || 0) });
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
