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

// ---------------- booking the same sale twice ----------------
//
// sd-v1. Store lines were deduped on the Whatnot order id alone, and a line
// created without one is invisible to that guard forever. Re-applying a show
// report then books every shelf sale again, so deleting the duplicates does
// not stick: they come back on the next apply, and the only evidence left is
// a deletion log.
//
// The fix is to fall back to what the line IS when it has no order id:
// product, units and price. That cannot be a plain set, because two different
// buyers each taking one pack at $15.99 are two real sales that look
// identical. So count them. Three existing lines matching a fingerprint
// absorb three incoming rows and the fourth books, which is right in both
// directions: a re-applied file books nothing, and a genuinely new sale of
// the same thing still books.

export const storeFingerprint = (productId: string, units: number, soldPrice: number): string =>
  `${productId}|${Math.max(1, Math.floor(Number(units) || 1))}|${(Number(soldPrice) || 0).toFixed(2)}`;

export type BookedIndex = { orders: Set<string>; counts: Map<string, number> };

/** Index the store lines a stream already has, by order id and by fingerprint. */
export function buildBookedIndex(lines: { fields: Record<string, any> }[]): BookedIndex {
  const orders = new Set<string>();
  const counts = new Map<string, number>();
  for (const l of lines) {
    const orderId = String(l.fields["Whatnot Order Id"] || "");
    if (orderId) orders.add(orderId);
    const productId = String(l.fields["Product"]?.[0] || "");
    if (!productId) continue;
    const key = storeFingerprint(productId, l.fields["Qty"], l.fields["Sold Price"]);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return { orders, counts };
}

/**
 * Has this row already been booked on this stream? Consumes one match when it
 * answers yes, so a file holding three identical sales is matched against
 * three existing lines and no further.
 */
export function alreadyBooked(
  index: BookedIndex,
  row: { productId: string; units: number; soldPrice: number; orderId?: string },
): boolean {
  const orderId = String(row.orderId || "");
  if (orderId && index.orders.has(orderId)) return true;
  const key = storeFingerprint(row.productId, row.units, row.soldPrice);
  const left = index.counts.get(key) || 0;
  if (left <= 0) return false;
  index.counts.set(key, left - 1);
  return true;
}

/** Remember a row this call just booked, so the same batch cannot book it twice. */
export function noteBooked(index: BookedIndex, row: { productId: string; units: number; soldPrice: number; orderId?: string }) {
  const orderId = String(row.orderId || "");
  if (orderId) index.orders.add(orderId);
  const key = storeFingerprint(row.productId, row.units, row.soldPrice);
  index.counts.set(key, (index.counts.get(key) || 0) + 1);
}

// How many rows in one upload may land on a single inventory product before
// the whole batch is refused.
//
// This is the guard that would have caught the real accident: 134 shelf sales
// of 134 different listings all booked against one Ultra Premium Collection,
// putting $30,000 of imaginary product cost on a show that took $3,500. Nobody
// sells 134 of one $225 box on a stream, so a fan-in that large is a
// mis-mapping every time, and refusing the batch costs one re-pick while
// booking it costs an afternoon of cleanup.
export const STORE_FAN_IN_MAX = 25;

export type FanIn = { productId: string; rows: number } | null;

/** The product too many rows in this batch point at, if there is one. */
export function fanInViolation(
  rows: { productId: string }[],
  max = STORE_FAN_IN_MAX,
): FanIn {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const id = String(r.productId || "");
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  let worst: FanIn = null;
  for (const [productId, n] of counts) {
    if (n > max && (!worst || n > worst.rows)) worst = { productId, rows: n };
  }
  return worst;
}

/**
 * The store lines on a show that are part of a mass mis-booking: no Whatnot
 * order id, and sharing a product with more than STORE_FAN_IN_MAX others.
 *
 * Both conditions matter. The order id is what a correctly booked sale always
 * carries now, and the group size is what separates an accident from real
 * trade: a hand-entered shelf sale is never one of twenty-six lines on the
 * same product, so this can never reach one.
 */
export function duplicateStoreLines<T extends { id: string; fields: Record<string, any> }>(
  lines: T[],
  max = STORE_FAN_IN_MAX,
): T[] {
  const candidates = lines.filter(
    (l) => !!l.fields["Is Store Purchase"] && !String(l.fields["Whatnot Order Id"] || "") && !!l.fields["Product"]?.[0],
  );
  const byProduct = new Map<string, T[]>();
  for (const l of candidates) {
    const key = String(l.fields["Product"][0]);
    byProduct.set(key, [...(byProduct.get(key) || []), l]);
  }
  const out: T[] = [];
  for (const group of byProduct.values()) if (group.length > max) out.push(...group);
  return out;
}
