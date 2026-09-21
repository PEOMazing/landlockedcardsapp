// The audit: what actually left the building on a stream, and where a given
// product has been.
//
// Two questions come up after a show and neither had an answer in one place:
//
//   1. "What got hit on Friday's stream?" - every sealed product and single
//      that was pulled, with what it was worth and what it cost.
//   2. "Where did the Darkness Ablaze go?" - every stream a product was put on,
//      how many went on, how many hit, how many came back. If packs were ripped
//      on a show but never added to its set, that show is simply missing from
//      this list, which is exactly how you spot it.
//
// Everything here is pure so it can be tested without Airtable and run in the
// browser once the page has handed over the rows.

export type AuditLine = {
  id: string;
  streamId: string;
  productId: string; // blank for a single card or an old line with no link
  singleId: string; // blank for sealed
  name: string; // as shown on the set, with the "4x " prefix stripped
  qty: number;
  hit: number;
  market: number; // per unit, as snapshotted on the line
  buy: number; // per unit
  giveaway: boolean;
  store: boolean; // a direct store sale during the show, not a spot on the set
  soldPrice: number; // store sales only
  created: string; // ISO, when the line was put on the set
};

export type AuditStream = {
  id: string;
  date: string;
  title: string;
  streamer: string;
  type: string;
  status: string;
  returned: boolean; // unhit product already went back to the shelf
};

export type AuditSingle = { no: number | null; set: string };

/** "4x Chaos Rising Booster Pack" -> "Chaos Rising Booster Pack", and the
 *  "(store)" tag a store sale carries comes off too. */
export function cleanLineName(raw: string): string {
  return String(raw || "")
    .replace(/^\s*\d+\s*x\s+/i, "")
    .replace(/\s*\(store\)\s*$/i, "")
    .trim();
}

export type HitRow = {
  lineId: string;
  name: string;
  kind: "sealed" | "single" | "store" | "giveaway";
  sticker: number | null;
  set: string;
  qty: number; // how many went on the set
  hit: number; // how many were pulled
  back: number; // how many were not pulled
  market: number;
  buy: number;
  hitValue: number; // hit x market (store sales: what it sold for)
  hitCost: number; // hit x buy
};

export type StreamReport = {
  hits: HitRow[];
  notHit: HitRow[];
  totals: {
    itemsHit: number;
    hitValue: number;
    hitCost: number;
    sealedHit: number;
    singlesHit: number;
    storeSales: number;
    storeCount: number;
    onSet: number;
    notHit: number;
  };
};

const kindOf = (l: AuditLine): HitRow["kind"] =>
  l.store ? "store" : l.singleId ? "single" : l.giveaway ? "giveaway" : "sealed";

// Biggest hits first: the report is read top down, and the chase is what
// people want to confirm went out.
const byValue = (a: HitRow, b: HitRow) => b.hitValue - a.hitValue || b.market - a.market || a.name.localeCompare(b.name);

export function streamReport(lines: AuditLine[], singles: Record<string, AuditSingle> = {}): StreamReport {
  const hits: HitRow[] = [];
  const notHit: HitRow[] = [];
  const t = { itemsHit: 0, hitValue: 0, hitCost: 0, sealedHit: 0, singlesHit: 0, storeSales: 0, storeCount: 0, onSet: 0, notHit: 0 };

  for (const l of lines) {
    const kind = kindOf(l);
    const qty = Math.max(0, l.qty || 0);
    const hit = Math.min(qty, Math.max(0, l.hit || 0));
    const s = l.singleId ? singles[l.singleId] : undefined;
    const row: HitRow = {
      lineId: l.id,
      name: cleanLineName(l.name),
      kind,
      sticker: s?.no ?? null,
      set: s?.set || "",
      qty,
      hit,
      back: qty - hit,
      market: l.market || 0,
      buy: l.buy || 0,
      hitValue: kind === "store" ? l.soldPrice || 0 : hit * (l.market || 0),
      hitCost: hit * (l.buy || 0),
    };

    if (kind === "store") {
      t.storeSales += row.hitValue;
      t.storeCount += hit;
    } else {
      t.onSet += qty;
      t.notHit += row.back;
    }
    if (hit > 0) {
      hits.push(row);
      t.itemsHit += hit;
      t.hitValue += row.hitValue;
      t.hitCost += row.hitCost;
      if (kind === "single") t.singlesHit += hit;
      else if (kind === "sealed" || kind === "giveaway") t.sealedHit += hit;
    }
    if (row.back > 0 && kind !== "store") notHit.push(row);
  }

  hits.sort(byValue);
  notHit.sort((a, b) => b.market - a.market || a.name.localeCompare(b.name));
  return { hits, notHit, totals: t };
}

/** Does this line belong to the product being searched for? A picked product
 *  matches on its record, which survives renames. Free text matches on the
 *  name as it appears on the set, every word, any order - so "darkness"
 *  finds "Darkness Ablaze Booster Pack" and "Darkness Ablaze ETB" alike. */
export function lineMatches(l: AuditLine, productId: string, q: string): boolean {
  if (productId && l.productId === productId) return true;
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const hay = cleanLineName(l.name).toLowerCase();
  return words.every((w) => hay.includes(w));
}

export type HistoryRow = {
  streamId: string;
  date: string;
  title: string;
  streamer: string;
  status: string;
  returned: boolean;
  names: string[]; // how it was named on that set (can differ across shows)
  onSet: number;
  hit: number;
  back: number;
  storeSold: number;
  hitValue: number;
};

export type ProductHistory = {
  rows: HistoryRow[];
  totals: { streams: number; onSet: number; hit: number; back: number; storeSold: number; hitValue: number };
};

export function productHistory(
  lines: AuditLine[],
  streams: Record<string, AuditStream>,
  productId: string,
  q: string
): ProductHistory {
  const by = new Map<string, HistoryRow>();
  for (const l of lines) {
    if (!lineMatches(l, productId, q)) continue;
    const s = streams[l.streamId];
    if (!s) continue; // deleted stream
    const row = by.get(l.streamId) || {
      streamId: l.streamId,
      date: s.date,
      title: s.title,
      streamer: s.streamer,
      status: s.status,
      returned: s.returned,
      names: [],
      onSet: 0,
      hit: 0,
      back: 0,
      storeSold: 0,
      hitValue: 0,
    };
    const name = cleanLineName(l.name);
    if (name && !row.names.includes(name)) row.names.push(name);
    const qty = Math.max(0, l.qty || 0);
    const hit = Math.min(qty, Math.max(0, l.hit || 0));
    if (l.store) {
      row.storeSold += hit;
      row.hitValue += l.soldPrice || 0;
    } else {
      row.onSet += qty;
      row.hit += hit;
      row.back += qty - hit;
      row.hitValue += hit * (l.market || 0);
    }
    by.set(l.streamId, row);
  }
  const rows = [...by.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const totals = rows.reduce(
    (a, r) => ({
      streams: a.streams + 1,
      onSet: a.onSet + r.onSet,
      hit: a.hit + r.hit,
      back: a.back + r.back,
      storeSold: a.storeSold + r.storeSold,
      hitValue: a.hitValue + r.hitValue,
    }),
    { streams: 0, onSet: 0, hit: 0, back: 0, storeSold: 0, hitValue: 0 }
  );
  return { rows, totals };
}

/** Shelf count check. The app's number is what it believes is on the shelf;
 *  a lower shelf count means product left without going through a set or a
 *  store sale. Positive = missing from the shelf, negative = extra on it. */
export function shelfGap(appOnHand: number, counted: number | null): number | null {
  if (counted === null || !Number.isFinite(counted)) return null;
  return Math.max(0, Math.floor(appOnHand || 0)) - Math.floor(counted);
}
