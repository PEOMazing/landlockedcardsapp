import { isSlab } from "./slab";

// sp-v1. What the singles picker shows, and what "stale" means in it.
//
// Nothing ever stopped a slab going on a show set. The to-stream route takes
// one, skips the live reprice because no free feed prices graded cards, and
// writes the line exactly as it does for a raw card. The picker is where it
// fell down, in two ways that between them made the feature look absent:
//
//   - 88 slabs sat in a list of 700-odd raw cards with no way to ask for them.
//     Typing "psa" did narrow it, because the search reads Condition, but
//     nobody is going to guess that.
//
//   - Every slab read as stale, forever. The picker called a card stale when
//     its comp was not checked TODAY, which is right for a raw card because the
//     nightly rotation reprices those. The rotation filters on RAW_CONDITIONS
//     and deliberately never touches a slab, so no slab is ever priced today.
//     Worse, the Recheck button sent them to /api/singles/comps, which hands
//     each one straight back with "graded comps are manual". The warning could
//     not be cleared by the button offered to clear it.
//
// So the two halves get two rules. A raw card is stale if it was not priced
// today. A slab is stale if its comp is OLD, which for a hand-set price means
// weeks rather than hours, and it is never offered to the bulk recheck.

export type PickKind = "all" | "raw" | "graded";

/** How long a slab's hand-set comp stays good enough to build a wheel from.
 *
 *  A month, not a day. These are priced off eBay sold listings by a person, and
 *  the cards that move fast enough to care are the ones the comp note already
 *  flags. Setting this shorter would reproduce the bug it exists to fix: a
 *  warning on every slab, every day, that nothing in the app can clear. */
export const SLAB_COMP_STALE_DAYS = 30;

export function matchesKind(condition: string | null | undefined, kind: PickKind): boolean {
  if (kind === "all") return true;
  return kind === "graded" ? isSlab(condition) : !isSlab(condition);
}

const dayOf = (s: string | null | undefined) => String(s || "").slice(0, 10);

/** Whole days between a comp date and now. Null when there is no usable date,
 *  which reads as "never priced" rather than "priced a very long time ago". */
export function compAgeDays(compDate: string | null | undefined, now: Date): number | null {
  const d = dayOf(compDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const then = Date.parse(`${d}T00:00:00Z`);
  if (!Number.isFinite(then)) return null;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.round((today - then) / 86400000));
}

export type PickCard = { condition: string; compDate: string };

/** A raw card the bulk recheck can and should re-price before the wheel is
 *  built off it. Slabs are excluded because the endpoint refuses them. */
export function needsRecheck(card: PickCard, now: Date): boolean {
  if (isSlab(card.condition)) return false;
  return dayOf(card.compDate) !== now.toISOString().slice(0, 10);
}

/** A slab whose hand-set comp has gone cold. Never priced counts as cold. */
export function slabCompCold(card: PickCard, now: Date, days = SLAB_COMP_STALE_DAYS): boolean {
  if (!isSlab(card.condition)) return false;
  const age = compAgeDays(card.compDate, now);
  return age === null || age > days;
}
