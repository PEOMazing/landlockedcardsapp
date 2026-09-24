import { AtRecord, atCreateBatch, atList, atUpdate, T } from "./airtable";

// Where each card's price has been.
//
// The Singles table only ever holds today's number. Comp gets overwritten on
// every reprice, so a card that doubled over a month and a card that has not
// moved since March look identical in the table, and the question you actually
// want answered - what should I be putting on a stream this week - has nothing
// to read.
//
// This writes a point on each card's curve. Not every reprice: the rolling job
// touches the whole collection about six times a day, and a row per check per
// card is a quarter of a million rows a year, which Airtable will not hold and
// nobody would read. Instead:
//
//   - at most one row per card per day. The day's row is opened by the first
//     real move and then updated in place, so it ends the day holding the
//     closing comp and the comp the day opened at. Slow drift accumulates into
//     the day's row instead of being thrown away one tick at a time.
//   - nothing at all for a card that has not moved past MIN_MOVE. Bulk that
//     sits at a dollar for a year costs nothing.
//
// There is no baseline row. Every single already carries Entry Comp and Date
// Added, which is exactly the first point of its curve, so 636 rows of "here
// is where we started" would be duplicating a column that is already right.

export const MIN_MOVE_PCT = 0.03;
export const MIN_MOVE_ABS = 0.5;

export type PricePoint = { date: string; comp: number; prevComp: number };
export type Entry = { date: string; comp: number };

export const today = () => new Date().toISOString().slice(0, 10);

// Is this move big enough to be worth a row? Both tests have to pass: the
// percentage alone would log every penny of a bulk rare, and the dollar amount
// alone would log nothing that happens to a $2 card and everything that happens
// to a $1,400 one.
export function worthLogging(prev: number | null | undefined, next: number | null | undefined): boolean {
  const a = Number(prev);
  const b = Number(next);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false;
  const move = Math.abs(b - a);
  return move >= MIN_MOVE_ABS && move >= a * MIN_MOVE_PCT;
}

// What the card was worth at the end of a given day.
//
// A row records the comp AFTER the move it describes, so the newest row on or
// before the cutoff is the answer. Where there is no such row the card still
// had a price that day, and there are two places to find it: the oldest row
// after the cutoff remembers what it moved away from, and failing that the card
// has been sitting at its entry comp since the day it was added.
//
// null means the question does not apply - the card did not exist yet, so it
// has no 30-day move and should not be ranked as though it were flat.
export function valueAsOf(points: PricePoint[], entry: Entry | null, cutoff: string): number | null {
  if (entry?.date && entry.date > cutoff) return null;
  let newestBefore: PricePoint | null = null;
  let oldest: PricePoint | null = null;
  for (const p of points) {
    if (!p.date) continue;
    if (p.date <= cutoff && (!newestBefore || p.date > newestBefore.date)) newestBefore = p;
    if (!oldest || p.date < oldest.date) oldest = p;
  }
  if (newestBefore && newestBefore.comp > 0) return newestBefore.comp;
  if (oldest && oldest.prevComp > 0) return oldest.prevComp;
  if (entry && entry.comp > 0) return entry.comp;
  return null;
}

export const daysAgo = (n: number, from = new Date()): string =>
  new Date(from.getTime() - n * 86400000).toISOString().slice(0, 10);

export type MoverCard = {
  id: string;
  cardNo: number;
  name: string;
  setName: string;
  condition: string;
  image: string;
  slot: number | null;
  comp: number;
  entryComp: number;
  dateAdded: string;
};

export type Mover = MoverCard & { from: number; delta: number; pct: number };

// Rank the collection by how far each card has moved since the cutoff.
//
// Cards with no comparison point are dropped rather than shown at zero: a card
// added yesterday has not been flat for thirty days, it simply has no thirty-day
// number, and padding the list with those buries the cards that did move.
export function rankMovers(
  cards: MoverCard[],
  pointsByCard: Map<string, PricePoint[]>,
  cutoff: string,
): Mover[] {
  const out: Mover[] = [];
  for (const c of cards) {
    if (!(c.comp > 0)) continue;
    const from = valueAsOf(
      pointsByCard.get(c.id) || [],
      c.dateAdded && c.entryComp > 0 ? { date: c.dateAdded, comp: c.entryComp } : null,
      cutoff,
    );
    if (from === null || from <= 0) continue;
    const delta = Math.round((c.comp - from) * 100) / 100;
    if (delta === 0) continue;
    out.push({ ...c, from, delta, pct: Math.round((delta / from) * 1000) / 10 });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

// ---------------- reading ----------------

export function toPoint(r: AtRecord): PricePoint {
  return {
    date: String(r.fields["Date"] || ""),
    comp: Number(r.fields["Comp"]) || 0,
    prevComp: Number(r.fields["Prev Comp"]) || 0,
  };
}

// Every logged point since a date, grouped by card. One read for the whole
// window, because the alternative is 636 reads to draw one page.
export async function pointsSince(since: string): Promise<Map<string, PricePoint[]>> {
  const rows = await atList(T.priceLog, {
    filterByFormula: `IS_AFTER({Date}, '${since}')`,
    "fields[]": ["Card Rec Id", "Date", "Comp", "Prev Comp"],
  }).catch(() => [] as AtRecord[]);
  const byCard = new Map<string, PricePoint[]>();
  for (const r of rows) {
    const id = String(r.fields["Card Rec Id"] || "");
    if (!id) continue;
    const list = byCard.get(id);
    if (list) list.push(toPoint(r));
    else byCard.set(id, [toPoint(r)]);
  }
  return byCard;
}

// ---------------- writing ----------------

export type Move = { rec: AtRecord; before: number | null | undefined; comp: number; market?: number | null };

const pad = (n: number) => String(n || 0).padStart(4, "0");

export function logFields(m: Move, day: string, openedAt: number): Record<string, any> {
  return {
    "Entry": `${pad(Number(m.rec.fields["Card No"]))} ${day}`,
    "Card Rec Id": m.rec.id,
    "Card No": Number(m.rec.fields["Card No"]) || 0,
    "Card Name": String(m.rec.fields["Card Name"] || ""),
    "Date": day,
    "Comp": m.comp,
    "Market": Number(m.market) > 0 ? Number(m.market) : null,
    "Prev Comp": openedAt,
    "Source": "reprice",
    "Logged At": new Date().toISOString(),
  };
}

// Write the day's moves. Reopening today's rows first is what keeps one row per
// card per day: a card that moves again this afternoon updates the row it
// opened this morning, and Prev Comp stays the price the day started at rather
// than sliding forward to whatever it was an hour ago.
//
// Best effort throughout. A card's price being recorded is never worth failing
// the reprice that produced it.
export async function logMoves(moves: Move[]): Promise<number> {
  const real = moves.filter((m) => worthLogging(m.before, m.comp));
  if (real.length === 0) return 0;
  const day = today();

  let openToday = new Map<string, AtRecord>();
  try {
    const rows = await atList(T.priceLog, {
      filterByFormula: `{Date} = '${day}'`,
      "fields[]": ["Card Rec Id", "Prev Comp"],
    });
    openToday = new Map(rows.map((r) => [String(r.fields["Card Rec Id"] || ""), r]));
  } catch {
    // Could not see today's rows. Creating anyway would double up on a card
    // that already has one, and a duplicate is worse than a gap here: the
    // movers list reads the newest row per day and two rows for one day is an
    // ambiguous curve. Skip this batch; the next one will pick the move up.
    return 0;
  }

  const fresh: Record<string, any>[] = [];
  let written = 0;
  for (const m of real) {
    const open = openToday.get(m.rec.id);
    if (open) {
      // the day opened at whatever the existing row says, not at this tick
      const openedAt = Number(open.fields["Prev Comp"]) || Number(m.before) || 0;
      try {
        await atUpdate(T.priceLog, open.id, logFields(m, day, openedAt));
        written++;
      } catch {}
    } else {
      fresh.push(logFields(m, day, Number(m.before) || 0));
    }
  }
  if (fresh.length > 0) {
    try {
      await atCreateBatch(T.priceLog, fresh);
      written += fresh.length;
    } catch {}
  }
  return written;
}
