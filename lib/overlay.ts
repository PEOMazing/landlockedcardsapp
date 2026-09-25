import { AtRecord, T, atList, atUpdate } from "./airtable";

// The OBS card board.
//
// OBS loads a Browser Source by URL and cannot sign in, so the overlay page
// has to answer without a session. A random key in the path is what stands in
// for auth: it is unguessable, it is scoped to one stream, and it can be
// rotated if a link ends up somewhere it should not be. The page it unlocks
// shows card art and prices for one show, which is the same thing every viewer
// is already looking at, so the blast radius of a leaked key is a stranger
// watching the same board.

// No l/1 and no o/0: this key gets read off a screen and typed into OBS by
// hand. Exactly 32 symbols, which also means a byte maps onto it with no
// modulo bias - 256 is a clean multiple of 32.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const KEY_LEN = 22;

export function newOverlayKey(): string {
  const bytes = new Uint8Array(KEY_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Shape a key has to have before it is worth a table scan. */
export const isOverlayKey = (k: string) =>
  typeof k === "string" && k.length === KEY_LEN && /^[a-z2-9]+$/.test(k);

/** The stream a key belongs to, or null. Filters in Airtable rather than
 *  pulling the table and matching here, so a wrong key costs one query. */
export async function streamForOverlayKey(key: string): Promise<AtRecord | null> {
  if (!isOverlayKey(key)) return null;
  const rows = await atList(T.streams, {
    filterByFormula: `{Overlay Key} = '${key}'`,
    maxRecords: "1",
  });
  return rows[0] || null;
}

/** The key for a stream, making one the first time it is asked for. */
export async function ensureOverlayKey(stream: AtRecord): Promise<string> {
  const existing = String(stream.fields["Overlay Key"] || "").trim();
  if (isOverlayKey(existing)) return existing;
  const key = newOverlayKey();
  await atUpdate(T.streams, stream.id, { "Overlay Key": key });
  return key;
}

/** A line is a single card when it points at one. Everything else on a show
 *  set is sealed product. */
export const isSingleLine = (line: { fields: Record<string, any> }) =>
  !!String(line.fields["Single Rec Id"] || "").trim();

/** Which kinds of product the board is showing. Stored inverted on the stream
 *  so an untouched show includes both. */
export type BoardKinds = { singles: boolean; sealed: boolean };

/** Grid fills the whole canvas and resizes tiles to the count. Banner is a
 *  single row that scrolls, for a strip along the bottom of the scene. */
export type BoardLayout = "grid" | "banner";

export const boardLayout = (stream: { fields: Record<string, any> }): BoardLayout =>
  stream.fields["Board Banner"] ? "banner" : "grid";

/** How fast the banner scrolls, as a multiple of the default pace.
 *
 *  Blank reads as 1, so no stream needed a backfill, and the range is clamped
 *  rather than trusted: a zero or a negative would stop the banner dead or run
 *  it backwards, and a typo of 40 would strobe a live audience. */
export const BOARD_SPEED_MIN = 0.25;
export const BOARD_SPEED_MAX = 4;

export function boardSpeed(stream: { fields: Record<string, any> }): number {
  const raw = Number(stream.fields["Board Speed"]);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(BOARD_SPEED_MAX, Math.max(BOARD_SPEED_MIN, Math.round(raw * 100) / 100));
}

/** The price at which a card starts to shine.
 *
 *  The board draws a card worth this much or more with the full foil treatment
 *  - a slow tilt, a glare sweeping across it, a rainbow sheen and sparkles -
 *  and everything under it plain. It is a second tier above the hit threshold:
 *  ten dollars is worth putting on the board, but the card people are actually
 *  waiting for should not look like the rest of the row.
 *
 *  Blank or zero means no shine at all, which is what every stream that
 *  existed before this reads as. Capped because every shining card costs the
 *  streaming machine real frames, and a negative is meaningless.
 */
export const BOARD_SHINE_MAX = 100000;

export function boardShine(stream: { fields: Record<string, any> }): number {
  const raw = Number(stream.fields["Board Shine"]);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(BOARD_SHINE_MAX, Math.round(raw * 100) / 100);
}

/** Does this card get the foil treatment? Shine off means nobody does, which
 *  keeps "off" a single check rather than a threshold nothing can clear. */
export function isShiny(value: number, shine: number): boolean {
  if (!(shine > 0)) return false;
  const v = Number(value);
  return Number.isFinite(v) && v >= shine;
}

export function boardKinds(stream: { fields: Record<string, any> }): BoardKinds {
  return {
    singles: !stream.fields["Board Hide Singles"],
    sealed: !stream.fields["Board Hide Sealed"],
  };
}

// What the board shows, and why each rule is here:
//
//   fully hit      - gone. The card has been won; leaving it up is a lie.
//   off board      - gone. The streamer pulled it by hand.
//   giveaway       - gone. Not something a viewer is spinning for.
//   store purchase - gone. Already sold off the shelf, never on the wheel.
//   wrong kind     - gone. A singles wheel and a sealed break are different
//                    shows, and a mixed board reads as neither.
//   under the hit  - gone. The board is advertising what is still winnable,
//     threshold      and a $2 common is not a reason to keep spinning. Same
//                    threshold the rest of the app calls a hit, so the board
//                    and the hit stats can never disagree.
//   no image       - gone, but the caller handles that one, since only it
//                    knows whether a picture was actually found.
export function onBoard(
  line: { fields: Record<string, any> },
  kinds: BoardKinds = { singles: true, sealed: true },
  hitThreshold = 0,
): boolean {
  const f = line.fields;
  if (f["Off Board"]) return false;
  if (f["Is Giveaway"]) return false;
  if (f["Is Store Purchase"]) return false;
  if (!(isSingleLine(line) ? kinds.singles : kinds.sealed)) return false;
  if ((Number(f["Market Price Snapshot"]) || 0) < hitThreshold) return false;
  const remaining = (Number(f["Qty"]) || 0) - (Number(f["Qty Hit"]) || 0);
  return remaining > 0;
}
