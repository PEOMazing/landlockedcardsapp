// Sealed stock never goes below zero.
//
// Qty On Hand is a count of boxes and packs on the shelf, and you cannot have
// fewer than none. It used to go negative whenever a show pulled more of a
// product than the app knew about: a case of packs bought and never entered
// with a real count, then 270 of them put on a stream, left the record at -270.
// Those negatives piled up into thousands of "missing" packs that only made the
// totals wrong.
//
// Every place that takes stock off the shelf runs the new number through here,
// so a product the app undercounted bottoms out at 0 instead of going into debt.
// Anything unhit that comes back after the show is then added on top of 0,
// which matches what is physically back on the shelf.

export function clampStock(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** What is on hand after taking `qty` off `onHand`, never below zero. */
export function takeStock(onHand: unknown, qty: unknown): number {
  return clampStock((Number(onHand) || 0) - (Number(qty) || 0));
}
