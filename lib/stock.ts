import { AtRecord } from "@/lib/airtable";

// The stock floor: a deduction may never drive Qty On Hand below zero.
//
// Every path that pulls stock for a stream reads the current Qty On Hand and
// writes back value - qty. Without a floor those writes go negative, and a
// negative on-hand silently corrupts spot value, break-even and the snapshot.
// The server is the authority - the pickers and forms are convenience on top.

export function onHandOf(product: AtRecord): number {
  return product.fields["Qty On Hand"] ?? 0;
}

/**
 * Returns null when `want` units can be deducted from `product`, or a
 * ready-to-show message naming the product and what is actually available.
 *
 * The figure is always stated verbatim, negatives included. 32 active products
 * are already below zero from deductions made before this floor existed (the
 * worst at -143), and telling a streamer that something is "out of stock" when
 * the record says -143 reads as a broken app rather than as broken data.
 * A negative product is refused cleanly here; repairing it is a stock
 * correction, not something this guard can or should do.
 */
export function stockShortfall(product: AtRecord, want: number): string | null {
  const onHand = onHandOf(product);
  if (want <= onHand) return null;
  const name = product.fields["Product Name"] || "this product";
  if (onHand < 0) return `${name} is oversold at ${onHand} on hand - it needs a stock correction before anything else can be pulled`;
  if (onHand === 0) return `${name} is out of stock (0 on hand)`;
  return `only ${onHand} of ${name} on hand`;
}
