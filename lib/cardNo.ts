// The permanent identification number printed on a card's sticker.
//
// Airtable assigns the raw number (a plain autoNumber on the Singles table), so
// it can never collide, never gets reused, and survives the card selling. This
// module only decides how it reads.
//
// Deliberately free of imports: the same formatter runs in API routes and in
// client components, and pulling lib/singles.ts into the browser would drag the
// Airtable config in with it.

// 142 -> "0142". Fixed width so numbers sort correctly in a spreadsheet and
// are hard to mishear when someone calls one out mid-break. Past 9999 it just
// gets longer rather than wrapping or truncating.
export function formatCardNo(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  return String(Math.floor(v)).padStart(4, "0");
}

// What someone types when hunting for a card: "142", "0142" and "#142" all
// mean the same card. Returns null when the text is not a number at all, so
// callers can fall back to normal name search.
export function parseCardNo(input: string): number | null {
  const m = String(input || "").trim().match(/^#?0*(\d{1,9})$/);
  return m ? parseInt(m[1], 10) : null;
}
