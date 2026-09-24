import { atList, T } from "./airtable";

// Where a card physically sits in the binder.
//
// Card No and Slot look alike and mean opposite things. Card No is the card:
// assigned once, never reused, and what a sale six months from now points at.
// Slot is a place. When the card in it sells, the pocket is empty and the next
// card added moves into it. That is the whole point - without it, keeping the
// binder in order means sliding every card after the insert down one pocket,
// and a single new card turns into an afternoon.
//
// Location is the same number as text, which is what the sticker carries. It
// is derived, never typed.
//
// There is deliberately no binder in it. Binders hold different numbers of
// cards, so any address that names one has to know each binder's capacity, and
// that number is wrong the day a different binder joins the shelf. A pocket
// that just counts from 1 across the whole collection never needs to know.
// Which binder a pocket is in is written on the binder: 1-1000, 1001-2000.

export function slotAddress(slot: number | null | undefined): string {
  const n = Number(slot);
  if (!Number.isInteger(n) || n < 1) return "";
  return String(n);
}

// The n lowest pockets nobody is sitting in, counting up from 1. Holes first;
// the binder only gets longer once every gap below the top is filled.
export function nextFreeSlots(taken: Iterable<number | null | undefined>, n: number): number[] {
  const used = new Set<number>();
  for (const t of taken) {
    const v = Number(t);
    if (Number.isInteger(v) && v > 0) used.add(v);
  }
  const out: number[] = [];
  for (let s = 1; out.length < n; s++) if (!used.has(s)) out.push(s);
  return out;
}

// Written together, always. A Slot with no Location is a pocket nobody can read.
export function slotFields(slot: number): Record<string, any> {
  return { "Slot": slot, "Location": slotAddress(slot) };
}

// Same, for a pocket that may not have been found. No pocket writes no fields,
// which leaves the card unfiled rather than blanking what it already had.
export function slotFieldsFor(slot: number | null | undefined): Record<string, any> {
  return Number(slot) > 0 ? slotFields(Number(slot)) : {};
}

// A sold card has left the binder, so the pocket goes back in the pool. Card No
// stays on the record - that is what the sale is filed under - and the pocket it
// was in is kept on Last Slot, because the number is printed on the card. If the
// sale is undone, that sticker is still the truth as long as nobody took the
// pocket first.
export function clearedSlotFields(was: number | null | undefined): Record<string, any> {
  const n = Number(was);
  return { "Slot": null, "Location": "", ...(Number.isInteger(n) && n > 0 ? { "Last Slot": n } : {}) };
}

// Kept for callers that have no record to hand. Prefer clearedSlotFields: this
// one forgets where the card was.
export const CLEARED_SLOT: Record<string, any> = { "Slot": null, "Location": "" };

// The pocket a returning card should go to. Its own, if that is still empty -
// the number is on the sticker, so putting it back there means no reprint and
// no card to re-file. Otherwise the lowest empty one, and the sticker is now
// wrong, which the caller can see by comparing what it asked for with what it got.
export function pickSlot(taken: Iterable<number | null | undefined>, preferred: number | null | undefined): number {
  const want = Number(preferred);
  const used = new Set<number>();
  for (const t of taken) {
    const v = Number(t);
    if (Number.isInteger(v) && v > 0) used.add(v);
  }
  if (Number.isInteger(want) && want > 0 && !used.has(want)) return want;
  return nextFreeSlots(used, 1)[0];
}

export async function takenSlots(): Promise<number[]> {
  const rows = await atList(T.singles, { "fields[]": ["Slot"] });
  return rows.map((r) => Number(r.fields["Slot"])).filter((n) => Number.isInteger(n) && n > 0);
}

// One pocket for a card being added. Two people adding at the same instant could
// read the same pool and pick the same pocket; with one person filing cards that
// is not worth locking the table over, and the cost of losing the race is two
// cards sharing an address until someone moves one.
//
// A pool that cannot be read must not stop a card being added. The card lands
// with no slot and the next backfill files it.
export async function claimSlot(): Promise<number | null> {
  return (await claimSlots(1))[0] ?? null;
}

// Re-file a card that left the binder and came back, into the pocket printed on
// it where possible. Writes Last Slot away once the card is home, and reports
// whether it got its own pocket so the caller can say the sticker is stale.
export async function reclaimSlot(
  was: number | null | undefined,
): Promise<{ fields: Record<string, any>; slot: number | null; kept: boolean }> {
  try {
    const slot = pickSlot(await takenSlots(), was);
    return { fields: { ...slotFields(slot), "Last Slot": null }, slot, kept: slot === Number(was) };
  } catch {
    // the pool could not be read: leave the card unfiled rather than guess at a
    // pocket, and let the slots backfill place it
    return { fields: {}, slot: null, kept: false };
  }
}

// Several pockets at once, read from the pool in one go so a batch cannot hand
// two cards the same address. An empty array means the pool could not be read:
// the cards are created unfiled and the slots backfill picks them up.
export async function claimSlots(n: number): Promise<number[]> {
  if (n < 1) return [];
  try {
    return nextFreeSlots(await takenSlots(), n);
  } catch {
    return [];
  }
}
