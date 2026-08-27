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
 */
export function stockShortfall(product: AtRecord, want: number): string | null {
  const onHand = onHandOf(product);
  if (want <= onHand) return null;
  const name = product.fields["Product Name"] || "this product";
  if (onHand <= 0) return `${name} is out of stock`;
  return `only ${onHand} of ${name} on hand`;
}
