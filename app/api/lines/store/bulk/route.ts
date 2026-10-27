import { NextResponse } from "next/server";
import { atGet, atList, isRecId, T, type AtRecord } from "@/lib/airtable";
import { getMe, ownsStream, canManageStream } from "@/lib/auth";
import {
  alreadyBooked,
  buildBookedIndex,
  fanInViolation,
  noteBooked,
  recordStoreSale,
  rememberWhatnotName,
  type StoreSaleResult,
} from "@/lib/storeSales";
import { shelfUnits } from "@/lib/whatnotCsv";

export const maxDuration = 60;

// sd-v1. A soft deadline, well inside maxDuration. Booking a sale is two
// Airtable round trips, so a 134-row upload runs past a minute and the
// platform kills the function mid-loop: rows are already written, the browser
// gets no answer, and the obvious next move is to upload again - which writes
// another partial batch. Six of those is how one show ended up with 134
// phantom lines and a deletion log 598 long.
//
// So stop before being stopped, say how many are left, and let the caller come
// back for them. Safe to resume now that a repeat is recognised without an
// order id: the second call re-reads what the first one wrote and skips it.
const DEADLINE_MS = 45000;

// Store sales from a Whatnot CSV upload. The file is read in the browser; only
// the listing title, units, price and order id come here - never buyer names
// or addresses. Orders already booked on this stream (same Whatnot order id)
// are skipped, so uploading the same file twice is harmless.
type Row = {
  productId: string; units: number; soldPrice: number; orderId?: string; listing?: string; remember?: boolean;
  // su-v1: what the order itself said, before any pack count was read off the
  // title. Sent so the shelf count can be settled here, against the product
  // this row actually landed on, rather than taken on trust from a browser
  // that may be running yesterday's code.
  orderQty?: number;
};

export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (!isRecId(String(b.streamId))) return NextResponse.json({ error: "bad stream" }, { status: 400 });
  const rows: Row[] = Array.isArray(b.rows) ? b.rows.slice(0, 200) : [];
  if (rows.length === 0) return NextResponse.json({ error: "nothing to add" }, { status: 400 });

  const stream = await atGet(T.streams, b.streamId).catch(() => null);
  if (!stream || !(await ownsStream(me, stream))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (stream.fields["Items Returned"] && !canManageStream(me, stream)) {
    return NextResponse.json({ error: "this stream is closed - a manager has to add store sales to it" }, { status: 403 });
  }

  // sd-v1. Read enough of each existing store line to recognise a repeat even
  // when it has no order id. Order id alone could not see a line created
  // without one, so re-applying a report booked all of its shelf sales again
  // and deleting the duplicates never stuck.
  const existing = await atList(T.lines, {
    filterByFormula: `AND({Stream Rec Id} = '${stream.id}', {Is Store Purchase})`,
    "fields[]": ["Whatnot Order Id", "Product", "Qty", "Sold Price"],
  });
  const index = buildBookedIndex(existing);

  // sd-v1. Refuse the whole batch when too much of it lands on one product.
  // That shape is a mis-mapping, not a sale: it is what put 134 shelf sales of
  // 134 different listings onto a single Ultra Premium Collection.
  const fan = fanInViolation(rows.filter((r) => isRecId(String(r.productId))));
  if (fan) {
    const named = await atGet(T.inventory, fan.productId).catch(() => null);
    const name = String(named?.fields["Product Name"] || "one product");
    return NextResponse.json(
      {
        error: `${fan.rows} of these ${rows.length} sales are all mapped to ${name}. That is almost always a mis-mapped title rather than ${fan.rows} real sales of the same item, so nothing was booked. Map them to what they actually are, or book them in smaller batches if they really are all that product.`,
        fanIn: { rows: fan.rows, product: name },
      },
      { status: 422 },
    );
  }

  const added: StoreSaleResult[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const products = new Map<string, AtRecord>();
  const startedAt = Date.now();
  let remaining = 0;
  for (const r of rows) {
    if (Date.now() - startedAt > DEADLINE_MS) { remaining++; continue; }
    const orderId = String(r.orderId || "").slice(0, 60);
    if (!isRecId(String(r.productId))) { errors.push(`${r.listing || "row"}: no product picked`); continue; }
    // re-read the product every time: two rows can draw on the same stock
    const product = await atGet(T.inventory, r.productId).catch(() => null);
    if (!product) { errors.push(`${r.listing || "row"}: product not found`); continue; }
    products.set(product.id, product);
    // su-v1. The count in a listing title is a number of PACKS; the count on
    // the shelf is a number of ITEMS, and an item can be a six-pack. Reading
    // the title's 6 against a product called "6x Obsidian Flames Booster Pack"
    // took six bundles - thirty-six packs - off the shelf for one sale. The
    // product's own name is the only place the unit is written down, and it is
    // read here, where the product record is already in hand.
    const asked = Math.max(1, Math.min(500, parseInt(String(r.units)) || 1));
    const name = String(product.fields["Product Name"] || "");
    const units =
      r.listing && Number(r.orderQty) > 0
        ? Math.min(500, shelfUnits(String(r.listing), Number(r.orderQty), name))
        : asked;
    const soldPrice = Math.max(0, parseFloat(String(r.soldPrice)) || 0);
    // Checked here rather than at the top of the loop, because the units a row
    // takes off the shelf depend on the product it landed on, and units are
    // part of what makes two store lines the same sale.
    const key = { productId: product.id, units, soldPrice, orderId };
    if (alreadyBooked(index, key)) { skipped.push(r.listing || orderId || product.id); continue; }
    const res = await recordStoreSale(stream, product, { units, soldPrice, orderId });
    added.push(res);
    noteBooked(index, key);
    if (r.remember && r.listing) await rememberWhatnotName(product, r.listing);
  }
  return NextResponse.json({
    ok: true,
    added: added.length,
    pending: added.filter((a) => a.pending).map((a) => ({ name: a.name, units: a.units, onHand: a.onHand })),
    skipped,
    errors,
    remaining,
    note: remaining > 0
      ? `${remaining} sale${remaining === 1 ? "" : "s"} did not fit in one request. Upload the same file again to book the rest - the ones already booked are skipped.`
      : "",
  });
}
