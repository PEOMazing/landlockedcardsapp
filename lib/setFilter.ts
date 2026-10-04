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
