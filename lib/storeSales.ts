import { atCreate, atGet, atUpdate, T, type AtRecord } from "./airtable";
import { recordAlert, stockAlert } from "./alerts";
import { clampStock, shortBy, takeStock } from "./stock";

// Store sales: things a buyer bought straight off the shelf during a show
// (Buy It Now on Whatnot), as opposed to what the wheel landed on. Each one is
// its own line on the stream, flagged Is Store Purchase, so it never counts
// toward spins or the show set.
//
// Stock rule for store lines: what has come off the shelf is Qty Hit, not Qty.
// A sale that has enough on hand is booked complete (Qty Hit = Qty) and the
// units come off inventory right away. A sale that does not is still logged,
// because the money came in and the packs are gone, but it waits with Qty Hit
// at 0 and nothing taken off the shelf. That keeps stock from going negative
// and leaves a visible "cannot complete set" flag until someone fixes the
// count and completes it.

export type StoreSaleResult = { id: string; name: string; units: number; pending: boolean; onHand: number };

const streamName = (stream: AtRecord) =>
  String(stream.fields["Title"] || "").replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, "") || String(stream.fields["Stream Date"] || "");

/** Book one store sale. Always creates the line; takes stock only when there is enough. */
export async function recordStoreSale(
  stream: AtRecord,
  product: AtRecord,
  input: { units: number; soldPrice: number; orderId?: string }
): Promise<StoreSaleResult> {
  const name = String(product.fields["Product Name"] || "");
  const onHand = clampStock(product.fields["Qty On Hand"]);
  const units = Math.max(1, Math.floor(Number(input.units) || 1));
  const pending = onHand < units;
  const line = await atCreate(T.lines, {
    "Line": `${units}x ${name} (store)`,
    "Qty": units,
    "Qty Hit": pending ? 0 : units,
    "Buy Price Snapshot": product.fields["Buy Price"] ?? 0,
    "Market Price Snapshot": product.fields["Market Price"] ?? 0,
    "Is Store Purchase": true,
    "Sold Price": Math.max(0, Number(input.soldPrice) || 0),
    "Stream": [stream.id],
    "Stream Rec Id": stream.id,
    "Product": [product.id],
    ...(input.orderId ? { "Whatnot Order Id": String(input.orderId) } : {}),
  });
  if (!pending) {
    const qtyNow = takeStock(onHand, units);
    await atUpdate(T.inventory, product.id, { "Qty On Hand": qtyNow });
    await stockAlert([{ name, qtyNow, delta: -units }], "store sale").catch(() => {});
  } else {
    await recordAlert(
      "stock",
      `Cannot complete set: ${name} is ${shortBy(onHand, units)} short for a store sale on ${streamName(stream)}`,
      { source: "store sale waiting on inventory", streamId: stream.id, lineId: line.id, needed: units, items: [{ name, qtyNow: onHand, delta: 0 }] }
    ).catch(() => {});
  }
  return { id: line.id, name, units, pending, onHand };
}

export const isPendingStoreLine = (l: AtRecord) =>
  !!l.fields["Is Store Purchase"] && (l.fields["Qty Hit"] || 0) < (l.fields["Qty"] || 0);

/** Finish a store sale that was waiting on inventory. */
export async function completeStoreSale(line: AtRecord): Promise<{ ok: true; name: string; units: number } | { ok: false; error: string }> {
  if (!isPendingStoreLine(line)) return { ok: false, error: "that store sale is already complete" };
  const productId = line.fields["Product"]?.[0];
  if (!productId) return { ok: false, error: "that store sale has no product - match it to an inventory item first" };
  const product = await atGet(T.inventory, productId);
  const name = String(product.fields["Product Name"] || "");
  const need = (line.fields["Qty"] || 0) - (line.fields["Qty Hit"] || 0);
  const onHand = clampStock(product.fields["Qty On Hand"]);
  if (onHand < need) {
    return { ok: false, error: `Cannot complete set: ${name} has ${onHand} on hand, ${need} needed. Update inventory first.` };
  }
  const qtyNow = takeStock(onHand, need);
  await atUpdate(T.inventory, productId, { "Qty On Hand": qtyNow });
  await atUpdate(T.lines, line.id, { "Qty Hit": line.fields["Qty"] || 0 });
  await stockAlert([{ name, qtyNow, delta: -need }], "store sale completed").catch(() => {});
  return { ok: true, name, units: need };
}

/** Remember a hand-made match so the same listing title finds this product next time. */
export async function rememberWhatnotName(product: AtRecord, listing: string) {
  const title = String(listing || "").trim();
  if (!title) return;
  const prior = String(product.fields["Whatnot Names"] || "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (prior.some((p) => p.toLowerCase() === title.toLowerCase())) return;
  await atUpdate(T.inventory, product.id, { "Whatnot Names": [...prior, title].join("\n").slice(0, 90000) }).catch(() => {});
}
