import { isRecId } from "./airtable";
import { heldOut } from "./streamSingles";

// Rolling unhit singles from one show onto the next.
//
// A Surprise Set that does not sell out leaves a wheel full of cards nobody
// won. Putting them all back in stock and picking them again one at a time is
// the same forty clicks that built the set, for a set that has not changed.
// This moves them across instead.
//
// The close engine needs no changes to allow it. closeActionFor already skips
// any card whose Stream Rec Id points somewhere other than the show being
// closed, and the straggler sweep at the end of settleStreamSingles is scoped
// the same way. So a card repointed at the next show is simply not the old
// show's business any more.
//
// The old show keeps its lines. What was on that wheel is history and the P&L
// reads off it; a card leaving afterwards does not change what was offered on
// the night. The one exception is a copy line, below.

type Line = { id?: string; fields: Record<string, any> };
type Card = { id: string; fields: Record<string, any> } | null;

export type RollAction = "repoint" | "move-copy" | "claim" | "skip";
export type RollDecision = { action: RollAction; reason?: string };

const SKIP = (reason: string): RollDecision => ({ action: "skip", reason });

/** What moving this line onto another show should actually do.
 *
 *  Pure, so the preview the streamer ticks through and the write that follows
 *  are the same decision rather than two rules that can disagree.
 */
export function rollDecision(
  line: Line,
  card: Card,
  fromStreamId: string,
  fromReturned: boolean,
): RollDecision {
  const f = line.fields;
  if (f["Is Store Purchase"]) return SKIP("store sale");
  if (f["Is Giveaway"]) return SKIP("giveaway");
  const sid = String(f["Single Rec Id"] || "");
  if (!isRecId(sid)) return SKIP("sealed product");
  const remaining = (Number(f["Qty"]) || 0) - (Number(f["Qty Hit"]) || 0);
  if (remaining <= 0) return SKIP("already hit");
  if (!card) return SKIP("card no longer exists");

  const status = String(card.fields["Status"] || "In Stock");

  // A copy line never moved its record - it took one off the Qty and left the
  // record in stock. So the copy exists only as this line, and moving it means
  // moving the line, not the card.
  if (f["Single Copy"]) {
    if (!fromReturned) return { action: "move-copy" };
    // A copy held out of the return never came back. There is nothing on the
    // shelf to take, because the copy still exists only as this line - so
    // moving the line is what moves it, same as on a show that has not closed.
    // Claiming here instead would take a SECOND copy off the record and leave
    // this one stranded on a closed show: the record ends up one short and the
    // old show keeps a line for a card that is now on two sets at once.
    if (heldOut(line)) return { action: "move-copy" };
    // Otherwise the old show has closed and handed the copy back, so there is a
    // copy on the shelf to take again in the ordinary way.
    return status === "In Stock" ? { action: "claim" } : SKIP("the copy did not come back in stock");
  }

  if (status === "In Stream") {
    return String(card.fields["Stream Rec Id"] || "") === fromStreamId
      ? { action: "repoint" }
      : SKIP("already on another show");
  }
  if (status === "In Stock") return { action: "claim" };
  return SKIP(status.toLowerCase());
}

/** The fields that take a card from the shelf onto the new show. Mirrors the
 *  claim the singles picker makes, so a card arriving by rollover is in the
 *  same state as one added by hand. */
export function claimFields(card: Card, toStreamId: string): { copy: boolean; fields: Record<string, any> } {
  const qty = Number(card?.fields?.["Qty"] ?? 1);
  return qty > 1
    ? { copy: true, fields: { "Qty": qty - 1 } }
    : { copy: false, fields: { "Status": "In Stream", "Stream Rec Id": toStreamId } };
}

/** How the old show's line has to change so its close does not act on a card
 *  that has left. Only a copy line needs this: closeActionFor returns
 *  copy-return from the line alone, without ever reading the card, so a copy
 *  line left intact would hand a copy back to stock that the next show is
 *  already holding. Cutting the link leaves the line as history and nothing
 *  else. Every other line is safe untouched, because the close reads the card
 *  and finds it pointing elsewhere. */
export function sourceLineFix(line: Line, decision: RollDecision): Record<string, any> | null {
  if (decision.action !== "move-copy") return null;
  const name = String(line.fields["Line"] || "");
  return {
    "Single Rec Id": "",
    "Single Copy": false,
    "Line": /\(rolled over\)$/.test(name) ? name : `${name} (rolled over)`.trim(),
  };
}
