// Handing a customer off to Venmo.
//
// This is a deep link, not an integration. Venmo opens with the amount and the
// note already filled in, the customer taps send, and nothing comes back: no
// webhook, no confirmation, no way for the app to know a payment happened. The
// note is therefore the entire paper trail, which is why it carries the card
// numbers and why it is built carefully rather than concatenated in the view.

export const VENMO_HANDLE = "landlockedcards";

// Venmo truncates long notes, and a truncated note is a mystery payment. Cards
// that do not fit are counted rather than listed, so the note always says how
// many cards were actually bought even when it cannot name them all.
export const NOTE_MAX = 240;

export function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function orderTotal(prices: (number | null | undefined)[]): number {
  const sum = prices.reduce<number>((a, p) => a + (Number(p) > 0 ? Number(p) : 0), 0);
  return Math.round(sum * 100) / 100;
}

// "LandLocked Cards: 0751, 0802, 0815"
export function orderNote(cardNos: string[]): string {
  const head = "LandLocked Cards: ";
  const clean = cardNos.map((c) => String(c).trim()).filter(Boolean);
  if (clean.length === 0) return head.trim();
  const out: string[] = [];
  for (const c of clean) {
    // what the note would look like with this one added and the overflow tail
    const left = clean.length - out.length - 1;
    const tail = left > 0 ? ` +${left} more` : "";
    const next = head + [...out, c].join(", ") + tail;
    if (next.length > NOTE_MAX) break;
    out.push(c);
  }
  const left = clean.length - out.length;
  if (out.length === 0) return `${head}${clean.length} cards`;
  return head + out.join(", ") + (left > 0 ? ` +${left} more` : "");
}

// venmo.com/<handle> opens the app on a phone and the profile on a desktop. The
// amount and note ride along as query params either way; on desktop Venmo tends
// to drop them, which is why the page shows the note as copyable text too.
export function venmoUrl(amount: number, note: string, handle = VENMO_HANDLE): string {
  const q = new URLSearchParams({ txn: "pay", amount: money(amount), note });
  return `https://venmo.com/${encodeURIComponent(handle)}?${q}`;
}
