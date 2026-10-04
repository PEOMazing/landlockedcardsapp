// Narrowing a show set by typing at it.
//
// The set table could be sorted four ways and asked nothing, so on a 250 unit
// wheel the only route to a card was to scroll past the other 249. Worse, most
// of them are copies of each other: twenty three of the same Leafeon render as
// twenty three rows identical for seventy characters, differing only in the
// four digits at the very front that the eye slides straight over.
//
// Pure, and in lib, so the matching rules can be tested without rendering a
// stream page.

export type SetLineish = {
  name: string;
  qty?: number;
  qtyHit?: number;
  slot?: number | null;
  singleRecId?: string;
};

/** The binder slot the API writes at the front of a singles line name. */
export const cardNoOf = (name: string): string =>
  (/^\[(\d+)\]/.exec(String(name || "")) || [])[1] || "";

/** The line name without that leading number, for when the number is being
 *  drawn as its own column. */
export const withoutCardNo = (name: string): string =>
  String(name || "").replace(/^\[\d+\]\s*/, "");

/** What a query is matched against: the line name plus the slot written both
 *  bare and zero padded, because the sticker says 0236 and the person holding
 *  it says "two thirty six". */
export function setHaystack(l: SetLineish): string {
  const slot = l.slot == null ? "" : `${l.slot} ${String(l.slot).padStart(4, "0")}`;
  return `${l.name || ""} ${slot}`.toLowerCase();
}

/** Every word has to land somewhere, so typing more always narrows and word
 *  order never matters. Deliberately not fuzzy: on a list where 0236, 0238 and
 *  170 are all real and all different, near enough is wrong. */
export function matchesSetQuery(l: SetLineish, query: string): boolean {
  const tokens = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = setHaystack(l);
  return tokens.every((t) => hay.includes(t));
}

// ---------------------------------------------------------------------------
// Collapsing copies of the same card
//
// A wheel carries 23 Leafeons as 23 separate lines, because each one is a
// distinct physical card with its own binder slot, its own hit state and its
// own row in the CSV export. That is right in the data and miserable on
// screen. Grouping happens here, in the rendering, and nowhere near the
// exports: those read the raw line list and keep one row per card.

/** Two lines are copies of each other when their names match once the binder
 *  slot is off the front. Condition and set are part of the name, so a NM and
 *  a LP of the same card stay apart, and so do two printings. */
export const groupKeyOf = (l: SetLineish): string =>
  withoutCardNo(l.name).trim().toLowerCase();

export type SetRender<T> =
  | { kind: "line"; key: string; line: T }
  | { kind: "group"; key: string; lines: T[] };

/** The render list for the set table: copies collapse once there are enough of
 *  them to be worth collapsing, everything else stays a plain row. A group
 *  takes the position of its first member, so whatever sort the table is in
 *  still decides the order. */
export function groupSetRows<T extends SetLineish & { id: string }>(
  rows: T[],
  minGroup = 3,
): SetRender<T>[] {
  const counts = new Map<string, number>();
  for (const l of rows) counts.set(groupKeyOf(l), (counts.get(groupKeyOf(l)) || 0) + 1);
  const out: SetRender<T>[] = [];
  const seen = new Set<string>();
  for (const l of rows) {
    const k = groupKeyOf(l);
    if ((counts.get(k) || 0) < minGroup) { out.push({ kind: "line", key: l.id, line: l }); continue; }
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: "group", key: k, lines: rows.filter((r) => groupKeyOf(r) === k) });
  }
  return out;
}

/** What a collapsed row shows instead of its members. */
export function groupTotals(lines: (SetLineish & { market?: number })[]) {
  const qty = lines.reduce((a, l) => a + (l.qty || 0), 0);
  const hit = lines.reduce((a, l) => a + (l.qtyHit || 0), 0);
  const prices = lines.map((l) => Number(l.market || 0));
  return {
    qty,
    hit,
    remain: Math.max(qty - hit, 0),
    // One price box for the whole group only makes sense while the copies
    // agree. When they do not, the row says so rather than quietly showing one
    // of them and writing it over the others.
    market: prices[0] ?? 0,
    samePrice: prices.every((p) => p === prices[0]),
    valueLeft: lines.reduce((a, l) => a + Math.max((l.qty || 0) - (l.qtyHit || 0), 0) * Number(l.market || 0), 0),
  };
}

export type SetKind = "all" | "singles" | "sealed";

/** The whole predicate the table applies: kind, still-live, then the query. */
export function keepSetLine(
  l: SetLineish,
  opts: { kind: SetKind; unhitOnly: boolean; query: string },
): boolean {
  if (opts.kind === "singles" && !l.singleRecId) return false;
  if (opts.kind === "sealed" && l.singleRecId) return false;
  if (opts.unhitOnly && Math.max((l.qty || 0) - (l.qtyHit || 0), 0) <= 0) return false;
  return matchesSetQuery(l, opts.query);
}
