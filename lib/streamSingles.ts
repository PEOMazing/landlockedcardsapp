import { atGet, atList, atUpdate, isRecId, T } from "./airtable";
import { clearedSlotFields, reclaimSlot } from "./slots";

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

// "hold" is a card the streamer ticked off the return list at close: it is not
// going back in the binder, it is staying out for an upcoming show. Nothing
// happens to it, which is the whole point - it keeps Status "In Stream" on this
// show, so rollover's repoint branch can move it straight onto the next set
// without a round trip through the shelf and back off it again.
//
// It still counts as owned, because the collection counts every card that is
// not Sold. So holding a card changes where it is, never how much there is.
export type CloseAction = "sold" | "return" | "hold" | "copy-sold" | "copy-return" | "copy-hold" | "skip";
export type ReleaseAction = "restore" | "copy-restore" | "skip";
export type RehitAction = "sell" | "unsell" | "copy-sell" | "copy-unsell" | "skip";

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

/** Is this line flagged to stay out rather than come back at close?
 *
 *  Only ever consulted for a card that did NOT sell. A hit card is gone, and
 *  "keep it out of stock" is not a coherent thing to ask of a card somebody
 *  else now owns, so the flag is ignored there rather than treated as a
 *  conflict. */
export function heldOut(line: Line): boolean {
  return !!line.fields["Hold Out"];
}

export function closeActionFor(line: Line, card: Card, streamId: string, streamType: string): CloseAction {
  const sold = soldAtClose(line, streamType);
  const hold = !sold && heldOut(line);
  // a copy was already taken off Qty when it went on; the record never moved
  if (line.fields["Single Copy"]) return sold ? "copy-sold" : hold ? "copy-hold" : "copy-return";
  // only touch a card still sitting on this show - anything else was moved or
  // corrected by hand since, and that decision stands
  if (!card) return "skip";
  if (String(card.fields["Stream Rec Id"] || "") !== streamId) return "skip";
  if (card.fields["Status"] !== "In Stream") return "skip";
  return sold ? "sold" : hold ? "hold" : "return";
}

// Taking a single's line off a show puts the card back as if it never went on.
// Before the show closes nothing has left the building, so the card always
// comes back. After it closes this is a history correction, and only a card
// that has not already been put back has anything to undo.
//
// Two kinds have not: a card that sold, and a card held out of the return. The
// held one matters because the old rule assumed every unhit card was back on
// the shelf by now, which stopped being true the moment the return list got
// tick boxes. Without this a held card whose line is then removed would be
// stranded In Stream on a closed show with nothing left pointing at it.
export function releaseActionFor(
  line: Line,
  card: Card,
  streamId: string,
  streamType: string,
  streamClosed: boolean,
): ReleaseAction {
  if (streamClosed && !soldAtClose(line, streamType) && !heldOut(line)) return "skip";
  if (line.fields["Single Copy"]) return "copy-restore";
  if (!card) return "skip";
  // moved to another show or corrected by hand since - leave it alone
  if (String(card.fields["Stream Rec Id"] || "") !== streamId) return "skip";
  return "restore";
}

// Correcting a card's hit AFTER the show closed.
//
// Before the close a hit is only a counter. The card left stock the moment it
// went on the set, and whether a spin landed on it just decides where it ends
// up. After the close that stops being true: the close has already filed every
// card, hit ones Sold and unhit ones back In Stock. So changing a hit now has
// to move the card as well, or the number on the show disagrees with the
// binder, and the binder is the thing you can hold.
//
// Decided from where the card IS rather than from what the line used to say.
// Two reasons. Running the same correction twice then does nothing the second
// time, which matters because a Whatnot re-upload re-applies every hit it
// finds. And a card somebody has already put right by hand is left alone
// instead of being dragged back to whatever the line remembers.
export function rehitActionFor(
  line: Line,
  card: Card,
  streamId: string,
  nowSold: boolean,
): RehitAction {
  // A copy came off a record that stayed In Stock, so there is no status to
  // read: the count is the only evidence, and the line's old value is what the
  // correction is measured against.
  if (line.fields["Single Copy"]) {
    const wasSold = (Number(line.fields["Qty Hit"]) || 0) > 0;
    if (nowSold === wasSold) return "skip";
    return nowSold ? "copy-sell" : "copy-unsell";
  }
  if (!card) return "skip";
  const status = String(card.fields["Status"] || "");
  // Sitting on somebody else's set now. Rollover or a hand correction moved
  // it, and that decision outranks a correction to an old show.
  if (status === "In Stream" && String(card.fields["Stream Rec Id"] || "") !== streamId) return "skip";
  if (nowSold) return status === "Sold" ? "skip" : "sell";
  return status === "Sold" ? "unsell" : "skip";
}

async function bumpQty(sid: string, by: number): Promise<void> {
  const card = await atGet(T.singles, sid);
  await atUpdate(T.singles, sid, { "Qty": (Number(card.fields["Qty"]) || 0) + by });
}

// ---------------------------------------------------------------------------
// Claiming a card for a show
//
// Putting a single on a set is read-then-write: check the card is in stock,
// then take it. Anything slow in between is a window where a second request can
// read the same "in stock" and take the same card again, and the add used to do
// its live reprice inside that window - a second or two, easily long enough for
// a double click to land two lines on one physical card. On a wheel that is two
// tiles for a card that can only be won once.
//
// So the claim goes first and the slow work happens after: by the time the
// price lookup starts, the card is already off the market. The window shrinks
// to the one write, and a second request reads a card that is no longer in
// stock and gets turned away.
//
// A record holding several copies gives one up and stays in stock; a single
// copy moves wholesale. Same distinction the close undoes later.

export type Claim = { copy: boolean; fields: Record<string, any> };

// Why this card cannot go on a set right now, or null if it can.
export function unavailableReason(card: Card): string | null {
  if (!card) return "that card no longer exists";
  const status = String(card.fields["Status"] || "In Stock");
  if (status !== "In Stock") {
    return status === "In Stream"
      ? "that card is already on a show set"
      : `that card is ${String(status).toLowerCase()}, not in stock`;
  }
  if (Number(card.fields["Qty"] ?? 1) < 1) return "there are no copies of that card left in stock";
  return null;
}

export function claimForStream(card: Card, streamId: string): Claim {
  const qty = Number(card?.fields?.["Qty"] ?? 1);
  return qty > 1
    ? { copy: true, fields: { "Qty": qty - 1 } }
    : { copy: false, fields: { "Status": "In Stream", "Stream Rec Id": streamId } };
}

// Put back a card that was claimed for an add that then failed. A copy comes
// back as a fresh read plus one rather than the number we happened to see, so
// another add landing in between is not overwritten.
export async function undoClaim(sid: string, claim: Claim): Promise<void> {
  if (claim.copy) await bumpQty(sid, 1);
  else await atUpdate(T.singles, sid, { "Status": "In Stock", "Stream Rec Id": "" });
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
): Promise<{ sold: number; returned: number; held: number; legacy: number }> {
  const out = { sold: 0, returned: 0, held: 0, legacy: 0 };
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
        await atUpdate(T.singles, sid, { "Status": "Sold", "Sold Date": today(), ...salePrice, ...clearedSlotFields(card?.fields?.["Slot"]) });
        out.sold++;
      } else if (act === "return") {
        await atUpdate(T.singles, sid, { "Status": "In Stock", "Stream Rec Id": "" });
        out.returned++;
      } else if (act === "copy-return") {
        await bumpQty(sid, 1);
        out.returned++;
      } else if (act === "copy-sold") {
        out.sold++;
      } else if (act === "hold" || act === "copy-hold") {
        // Deliberately nothing. The card stays exactly as it is: out of stock,
        // still pointed at this show, ready for rollover to repoint it. The
        // straggler sweep below would otherwise mark it Sold, so it has to be
        // counted as handled, which the loop already did above.
        out.held++;
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
    await atUpdate(T.singles, s.id, { "Status": "Sold", "Sold Date": today(), ...clearedSlotFields(s.fields["Slot"]) });
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
    if (act === "restore") { await restoreSoldCard(sid, card); return true; }
  } catch {}
  return false;
}

// Put a card back on the shelf, undoing a sale.
//
// Taking the price back off matters as much as the status: a card that reads
// In Stock while still carrying a Sale Price has been sold according to every
// report and is available according to every picker.
//
// Filing it again: it goes back to the pocket printed on its sticker when that
// pocket is still empty, and to the lowest empty one when something else has
// taken it. A card that never gave up its pocket keeps it.
export async function restoreSoldCard(sid: string, card: Card): Promise<void> {
  const refile = card && Number(card.fields?.["Slot"]) > 0 ? {} : (await reclaimSlot(card?.fields?.["Last Slot"])).fields;
  await atUpdate(T.singles, sid, {
    "Status": "In Stock", "Stream Rec Id": "", "Sold Date": null as any, "Sale Price": null as any, ...refile,
  });
}

/** Move the card to match a hit count corrected after the show closed.
 *
 *  Returns what it did, so the route can tell the user whether a card
 *  actually moved or the correction was already reflected in the binder. */
export async function applyRehitToSingle(
  line: Line,
  streamId: string,
  streamType: string,
  nowSold: boolean,
): Promise<RehitAction> {
  const sid = String(line?.fields?.["Single Rec Id"] || "");
  if (!isRecId(sid)) return "skip";
  const card = line.fields["Single Copy"] ? null : await fetchCard(sid);
  const act = rehitActionFor(line, card, streamId, nowSold);
  try {
    if (act === "copy-sell") await bumpQty(sid, -1);
    else if (act === "copy-unsell") await bumpQty(sid, 1);
    else if (act === "unsell") await restoreSoldCard(sid, card);
    else if (act === "sell") {
      // Same price rule the close uses: a wheel hit sells at the line's price,
      // an auction's price is whatever the bidding reached and is left for a
      // person to fill in.
      const linePrice = Number(line.fields["Market Price Snapshot"]);
      const salePrice = hitsDecideSingles(streamType) && Number.isFinite(linePrice) && linePrice >= 0
        ? { "Sale Price": linePrice } : {};
      await atUpdate(T.singles, sid, {
        "Status": "Sold", "Sold Date": today(), ...salePrice, ...clearedSlotFields(card?.fields?.["Slot"]),
      });
    }
  } catch {
    return "skip"; // the card was deleted since the show - nothing to move
  }
  return act;
}
