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
//   no image       - gone, but the caller handles that one, since only it
//                    knows whether a picture was actually found.
export function onBoard(
  line: { fields: Record<string, any> },
  kinds: BoardKinds = { singles: true, sealed: true },
): boolean {
  const f = line.fields;
  if (f["Off Board"]) return false;
  if (f["Is Giveaway"]) return false;
  if (f["Is Store Purchase"]) return false;
  if (!(isSingleLine(line) ? kinds.singles : kinds.sealed)) return false;
  const remaining = (Number(f["Qty"]) || 0) - (Number(f["Qty Hit"]) || 0);
  return remaining > 0;
}
