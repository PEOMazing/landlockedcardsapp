import { atGet, atList, atUpdate, isRecId, T } from "./airtable";
import { CLEARED_SLOT, claimSlot, slotFieldsFor } from "./slots";

// What happens to the single cards on a stream when the show closes.
//
// It depends on the kind of show, and getting it wrong corrupts inventory:
//
// - Single Stream: every card is an auction that starts at $1, so every card
//   on the set sells. All of them count as sold. This is how it always worked.
// - Surprise Set (and anything else built around hits): a card on the wheel is
//   only gone if a spin landed on it. Hit cards are sold. Unhit cards go back
//   to stock, exactly like unhit sealed product goes back on the shelf.
//
// Before the Single Rec Id field existed, a singles line had no link back to
// its card, so the close could not tell a hit card from an unhit one and marked
// everything on the stream Sold. That was right for auctions and wrong for a
// wheel. Lines created before the field still carry no link; those cards fall
// through to the old rule so nothing already on a live stream changes behaviour.
//
// A line either moved a whole record onto the stream (Qty was 1, so the record
// itself went In Stream) or took one copy off a record holding several (Qty
// went down by one and the record stayed In Stock). The Single Copy checkbox
// records which. The two are undone differently: a whole record flips Status,
// a copy comes back as Qty + 1.
//
// The decisions are pure functions below so they can be tested without
// Airtable; the async wrappers only fetch and write.

type Line = { fields: Record<string, any> };
type Card = { fields: Record<string, any> } | null;

export type CloseAction = "sold" | "return" | "copy-sold" | "copy-return" | "skip";
export type ReleaseAction = "restore" | "copy-restore" | "skip";

const today = () => new Date().toISOString().slice(0, 10);

// Does a hit decide whether a card sold, or does every card on this kind of
// show sell regardless?
export function hitsDecideSingles(streamType: string): boolean {
  return String(streamType || "Surprise Set") !== "Single Stream";
}

// Did this line's card leave at close?
export function soldAtClose(line: Line, streamType: string): boolean {
  return !hitsDecideSingles(streamType) || (Number(line.fields["Qty Hit"]) || 0) > 0;
}

export function closeActionFor(line: Line, card: Card, streamId: string, streamType: string): CloseAction {
  const sold = soldAtClose(line, streamType);
  // a copy was already taken off Qty when it went on; the record never moved
  if (line.fields["Single Copy"]) return sold ? "copy-sold" : "copy-return";
  // only touch a card still sitting on this show - anything else was moved or
  // corrected by hand since, and that decision stands
  if (!card) return "skip";
  if (String(card.fields["Stream Rec Id"] || "") !== streamId) return "skip";
  if (card.fields["Status"] !== "In Stream") return "skip";
  return sold ? "sold" : "return";
}

// Taking a single's line off a show puts the card back as if it never went on.
// Before the show closes nothing has left the building, so the card always
// comes back. After it closes this is a history correction, and only a card
// that left at close has anything to undo - an unhit card was already put back
// by the close itself.
export function releaseActionFor(
  line: Line,
  card: Card,
  streamId: string,
  streamType: string,
  streamClosed: boolean,
): ReleaseAction {
  if (streamClosed && !soldAtClose(line, streamType)) return "skip";
  if (line.fields["Single Copy"]) return "copy-restore";
  if (!card) return "skip";
  // moved to another show or corrected by hand since - leave it alone
  if (String(card.fields["Stream Rec Id"] || "") !== streamId) return "skip";
  return "restore";
}

async function bumpQty(sid: string, by: number): Promise<void> {
  const card = await atGet(T.singles, sid);
  await atUpdate(T.singles, sid, { "Qty": (Number(card.fields["Qty"]) || 0) + by });
}

const fetchCard = (sid: string) => atGet(T.singles, sid).catch(() => null);

// A single on a wheel is always worth its card's current comp. The line takes
// a snapshot when the card goes on, but the comp keeps moving with the market
// after that, and the wheel is meant to follow it: the hit value on the stream
// page and the price a hit sells at should both be today's comp, not whatever
// it was the afternoon the set was built.
//
// Returns the price the line should now carry, or null when it is already
// right or has nothing to follow. Auctions are left alone - their line price is
// a starting point, and what they sell for is decided by the bidding.
export function wheelPriceUpdate(line: Line, card: Card, streamType: string): number | null {
  if (!hitsDecideSingles(streamType)) return null;
  if (!line.fields["Single Rec Id"] || !card) return null;
  const comp = Number(card.fields["Comp"]);
  if (card.fields["Comp"] === undefined || card.fields["Comp"] === null || !Number.isFinite(comp) || comp < 0) return null;
  const current = Number(line.fields["Market Price Snapshot"]);
  if (Number.isFinite(current) && current === comp) return null;
  return comp;
}

// Bring every single on an open wheel up to its card's current comp. Updates
// the line rows it is handed in place, so a caller that goes on to use them
// sees the new prices without fetching again. One lookup for all the cards,
// and a write only for lines whose price actually moved.
export async function syncWheelSinglePrices(lines: Line[] & { id?: string }[], streamType: string): Promise<number> {
  if (!hitsDecideSingles(streamType)) return 0;
  const ids = Array.from(new Set(lines.map((l) => String(l.fields["Single Rec Id"] || "")).filter(isRecId)));
  if (!ids.length) return 0;
  const cards = await atList(T.singles, {
    filterByFormula: `OR(${ids.map((id) => `RECORD_ID() = '${id}'`).join(", ")})`,
    "fields[]": ["Comp"],
  }).catch(() => [] as { id: string; fields: Record<string, any> }[]);
  const byId = new Map(cards.map((c) => [c.id, c]));
  let moved = 0;
  for (const l of lines as ({ id: string } & Line)[]) {
    const card = byId.get(String(l.fields["Single Rec Id"] || "")) || null;
    const price = wheelPriceUpdate(l, card, streamType);
    if (price === null || !l.id) continue;
    try {
      await atUpdate(T.lines, l.id, { "Market Price Snapshot": price });
      l.fields["Market Price Snapshot"] = price;
      moved++;
    } catch {}
  }
  return moved;
}

export async function settleStreamSingles(
  streamId: string,
  streamType: string,
): Promise<{ sold: number; returned: number; legacy: number }> {
  const out = { sold: 0, returned: 0, legacy: 0 };
  if (!isRecId(streamId)) return out;

  const lines = await atList(T.lines, { filterByFormula: `{Stream Rec Id} = '${streamId}'` });
  // settle at today's comp, so a hit sells at what the card is worth now
  await syncWheelSinglePrices(lines, streamType).catch(() => 0);
  const handled = new Set<string>();

  for (const l of lines) {
    const sid = String(l.fields["Single Rec Id"] || "");
    if (!isRecId(sid)) continue;
    handled.add(sid);
    const card = l.fields["Single Copy"] ? null : await fetchCard(sid);
    const act = closeActionFor(l, card, streamId, streamType);
    try {
      if (act === "sold") {
        // the stream stays on a sold card: it records where it went, and it is
        // what lets a later line removal find and undo the sale.
        //
        // A card hit on a wheel sells at the line's price, which the sync above
        // has just brought up to the card's current comp, so the sale is on the
        // record the moment the show closes. An auction's price is whatever the bidding reached, which the
        // line does not know, so that one is left for a person to fill in.
        const linePrice = Number(l.fields["Market Price Snapshot"]);
        const salePrice = hitsDecideSingles(streamType) && Number.isFinite(linePrice) && linePrice >= 0 ? { "Sale Price": linePrice } : {};
        await atUpdate(T.singles, sid, { "Status": "Sold", "Sold Date": today(), ...salePrice, ...CLEARED_SLOT });
        out.sold++;
      } else if (act === "return") {
        await atUpdate(T.singles, sid, { "Status": "In Stock", "Stream Rec Id": "" });
        out.returned++;
      } else if (act === "copy-return") {
        await bumpQty(sid, 1);
        out.returned++;
      } else if (act === "copy-sold") {
        out.sold++;
      }
    } catch {
      // the card was deleted since it went on the show - nothing to put back
    }
  }

  // Cards put on this stream before lines carried their Single Rec Id. No way
  // to know if they were hit, so they keep the behaviour they were added under.
  const stragglers = await atList(T.singles, {
    filterByFormula: `AND({Stream Rec Id} = '${streamId}', {Status} = 'In Stream')`,
  }).catch(() => [] as any[]);
  for (const s of stragglers) {
    if (handled.has(s.id)) continue;
    await atUpdate(T.singles, s.id, { "Status": "Sold", "Sold Date": today(), ...CLEARED_SLOT });
    out.legacy++;
  }
  return out;
}

export async function releaseSingleFromLine(
  line: Line,
  streamId: string,
  streamType: string,
  streamClosed: boolean,
): Promise<boolean> {
  const sid = String(line?.fields?.["Single Rec Id"] || "");
  if (!isRecId(sid)) return false;
  const card = line.fields["Single Copy"] ? null : await fetchCard(sid);
  const act = releaseActionFor(line, card, streamId, streamType, streamClosed);
  try {
    if (act === "copy-restore") { await bumpQty(sid, 1); return true; }
    if (act === "restore") {
      // undoing a sale takes its price back off too, and the card needs filing
      // again: the pocket it had before the sale went back in the pool and is
      // very likely someone else's by now. A card that still holds a pocket
      // keeps it.
      const refile = card && Number(card.fields?.["Slot"]) > 0 ? {} : slotFieldsFor(await claimSlot());
      await atUpdate(T.singles, sid, { "Status": "In Stock", "Stream Rec Id": "", "Sold Date": null as any, "Sale Price": null as any, ...refile });
      return true;
    }
  } catch {}
  return false;
}
