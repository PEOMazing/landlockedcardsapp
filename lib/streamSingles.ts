import { atGet, atList, atUpdate, isRecId, T } from "./airtable";

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

export async function settleStreamSingles(
  streamId: string,
  streamType: string,
): Promise<{ sold: number; returned: number; legacy: number }> {
  const out = { sold: 0, returned: 0, legacy: 0 };
  if (!isRecId(streamId)) return out;

  const lines = await atList(T.lines, { filterByFormula: `{Stream Rec Id} = '${streamId}'` });
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
        // what lets a later line removal find and undo the sale
        await atUpdate(T.singles, sid, { "Status": "Sold", "Sold Date": today() });
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
    await atUpdate(T.singles, s.id, { "Status": "Sold", "Sold Date": today() });
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
      await atUpdate(T.singles, sid, { "Status": "In Stock", "Stream Rec Id": "", "Sold Date": null as any });
      return true;
    }
  } catch {}
  return false;
}
