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

// ---------------- price buckets ----------------
//
// Which physical box a card belongs in, from its comp. Fine $5 steps at the
// bottom where break hits pile up, widening above, because value spreads out
// fast: across the first 100 cards the median sits near $48 and the top card is
// over $300. Straight $5 bands the whole way would need 33 boxes, most of them
// holding a card or two, and would run out of alphabet at $130.
//
// Upper bound is exclusive, so $5.00 is B and $4.99 is A.
export const BUCKETS: { letter: string; min: number; max: number }[] = [
  { letter: "A", min: 0, max: 5 },
  { letter: "B", min: 5, max: 10 },
  { letter: "C", min: 10, max: 15 },
  { letter: "D", min: 15, max: 25 },
  { letter: "E", min: 25, max: 50 },
  { letter: "F", min: 50, max: 100 },
  { letter: "G", min: 100, max: 250 },
  { letter: "H", min: 250, max: Infinity },
];

// A card with no comp has no box to go in - it needs pricing first, and
// guessing A would quietly file real value in the penny box.
export function bucketFor(comp: number | null | undefined): string {
  // Guard before Number(): Number(null) and Number("") are both 0, which would
  // quietly file an unpriced card in A, the penny box, and then report it as
  // drifted the moment anything had been printed for it.
  if (comp === null || comp === undefined || (comp as unknown) === "") return "";
  const v = Number(comp);
  if (!Number.isFinite(v) || v < 0) return "";
  for (const b of BUCKETS) if (v >= b.min && v < b.max) return b.letter;
  return "";
}

// Human-readable range for a letter, for legends and box labels.
export function bucketRange(letter: string): string {
  const b = BUCKETS.find((x) => x.letter === letter);
  if (!b) return "";
  return b.max === Infinity ? `$${b.min}+` : `$${b.min} - $${b.max}`;
}

// True when the card is physically in the wrong box: its comp has crossed a
// band since the sticker was printed. Only meaningful once something has
// actually been printed, so a never-labelled card is never "wrong".
export function bucketDrifted(comp: number | null | undefined, printed: string): boolean {
  const was = String(printed || "").trim().toUpperCase();
  if (!was) return false;
  const now = bucketFor(comp);
  return now !== "" && now !== was;
}
