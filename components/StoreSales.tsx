"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "@/components/Toaster";
import { readWhatnotCsv, showsIn, storeRows, pickShow, matchProduct, localDate, type Product, type StoreRow } from "@/lib/whatnotCsv";
import { CATEGORIES, categoryForName } from "@/lib/categories";

// Store sales: what buyers bought straight off the shelf during the show
// (Buy It Now on Whatnot), kept apart from the show set so it never touches
// spin stats. Two ways in:
//
//   - by hand: pick the item, how many units left the shelf, what they paid
//   - from Whatnot: drop the show export or the weekly earnings report. The
//     file is read right here in the browser. Only the listing title, units,
//     price and order id are sent on; buyer names and addresses never leave
//     this computer.
//
// A sale with not enough stock behind it is still logged, flagged "cannot
// complete set", and finished with one click once inventory is updated.

const $ = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Inv = { id: string; name: string; market: number; qty: number; aliases: string[] };
type StoreLine = {
  id: string; name: string; qty: number; qtyHit: number; market: number;
  soldPrice?: number; orderId?: string; productId?: string;
};
type Pick = { productId: string; remember: boolean; include: boolean };

// "5x Darkness Ablaze Booster Packs - Ripped Live" -> "Darkness Ablaze Booster Packs"
const cleanTitle = (t: string) =>
  String(t || "")
    .replace(/^\s*\d{1,2}\s*x\s+/i, "")
    .replace(/\s+-\s+ripped live\s*$/i, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}️]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

export default function StoreSales({
  streamId, streamTitle, streamDate, streamerName, closed, canManage, lines, onChange, sharedFile,
}: {
  streamId: string;
  streamTitle: string;
  streamDate: string;
  streamerName: string;
  closed: boolean;
  canManage: boolean;
  lines: StoreLine[];
  onChange: () => Promise<void>;
  // a report uploaded in the Whatnot show report section, so one upload does both
  sharedFile?: { name: string; text: string; nonce: number } | null;
}) {
  const [inv, setInv] = useState<Inv[]>([]);
  const [busy, setBusy] = useState(false);
  // by hand
  const [product, setProduct] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  // upload
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [showId, setShowId] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [newItem, setNewItem] = useState({ name: "", category: "Other", market: "", qty: "" });

  const editable = !closed || canManage;

  useEffect(() => {
    if (!sharedFile) return;
    setFileName(sharedFile.name);
    setPicks({});
    setText(sharedFile.text);
  }, [sharedFile?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadInv = async () => {
    try {
      const r = await fetch("/api/inventory");
      if (!r.ok) return;
      const d = await r.json();
      setInv(
        ((d.items || []) as any[])
          .map((i) => ({ id: i.id, name: String(i.name || ""), market: i.marketPrice || 0, qty: i.qtyOnHand || 0, aliases: i.aliases || [] }))
          .filter((i) => i.name)
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch {}
  };
  useEffect(() => { loadInv(); }, []);

  const invById = useMemo(() => Object.fromEntries(inv.map((i) => [i.id, i])), [inv]);
  const catalog: Product[] = useMemo(
    () => inv.flatMap((i) => [{ id: i.id, name: i.name }, ...i.aliases.map((a) => ({ id: i.id, name: a }))]),
    [inv]
  );

  // ---- the file ----
  const parsed = useMemo(() => (text ? readWhatnotCsv(text) : null), [text]);
  const shows = useMemo(() => (parsed && !parsed.error ? showsIn(parsed.sales) : []), [parsed]);
  const multiShow = shows.length > 1;
  useEffect(() => {
    if (!multiShow) { setShowId(null); return; }
    setShowId(pickShow(shows, { title: streamTitle, date: streamDate, streamer: streamerName }) || shows[0].id);
  }, [multiShow, shows, streamTitle, streamDate, streamerName]);

  const found = useMemo(() => {
    if (!parsed || parsed.error) return { rows: [] as StoreRow[], guessed: false };
    const sales = multiShow ? parsed.sales.filter((s) => s.showId === showId) : parsed.sales;
    return storeRows(sales);
  }, [parsed, multiShow, showId]);

  const booked = useMemo(() => new Set(lines.map((l) => l.orderId).filter(Boolean) as string[]), [lines]);

  // Auto-match each row once inventory and the file are both in. A pick made
  // by hand is never overwritten.
  useEffect(() => {
    if (!found.rows.length || !catalog.length) return;
    setPicks((prev) => {
      const next = { ...prev };
      for (const r of found.rows) {
        if (next[r.key]) continue;
        const m = matchProduct({ title: r.title, description: "" }, catalog);
        next[r.key] = { productId: m?.id || "", remember: false, include: true };
      }
      return next;
    });
  }, [found.rows, catalog]);

  const preview = found.rows.map((r) => {
    const p = picks[r.key] || { productId: "", remember: false, include: true };
    const item = p.productId ? invById[p.productId] : null;
    const status: "booked" | "nomatch" | "short" | "ready" =
      r.orderId && booked.has(r.orderId) ? "booked" : !item ? "nomatch" : item.qty < r.units ? "short" : "ready";
    return { r, p, item, status };
  });
  const toAdd = preview.filter((x) => x.p.include && (x.status === "ready" || x.status === "short"));
  const setPick = (key: string, patch: Partial<Pick>) =>
    setPicks((prev) => ({ ...prev, [key]: { ...(prev[key] || { productId: "", remember: false, include: true }), ...patch } }));

  async function onFile(f: File | null) {
    if (!f) return;
    setFileName(f.name);
    setPicks({});
    setText(await f.text());
  }

  async function addFromFile() {
    if (!toAdd.length) return;
    setBusy(true);
    const r = await fetch("/api/lines/store/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        streamId,
        rows: toAdd.map((x) => ({
          productId: x.p.productId,
          units: x.r.units,
          soldPrice: x.r.price,
          orderId: x.r.orderId,
          listing: x.r.title,
          remember: x.p.remember,
        })),
      }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast(d.error || "Could not add those store sales", "bad"); return; }
    const parts = [`${d.added} store sale${d.added === 1 ? "" : "s"} added`];
    if (d.pending?.length) parts.push(`${d.pending.length} waiting on inventory`);
    if (d.skipped?.length) parts.push(`${d.skipped.length} already on this stream`);
    toast(parts.join(", "), d.pending?.length || d.errors?.length ? "bad" : "ok");
    if (d.errors?.length) toast(d.errors.join("; "), "bad");
    await Promise.all([onChange(), loadInv()]);
  }

  async function createItem(key: string) {
    const name = newItem.name.trim();
    if (!name) return;
    setBusy(true);
    const r = await fetch("/api/inventory/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, category: newItem.category, marketPrice: parseFloat(newItem.market) || 0, qtyOnHand: parseInt(newItem.qty) || 0 }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || !d.item) { toast(d.error || "Could not add that to inventory", "bad"); return; }
    await loadInv();
    setPick(key, { productId: d.item.id, remember: true });
    setAdding(null);
    toast(d.existed ? `${d.item.name} was already in inventory - matched to it` : `${d.item.name} added to inventory and matched`, "ok");
  }

  async function addByHand() {
    setBusy(true);
    const r = await fetch("/api/lines/store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamId, productId: product, qty: parseInt(qty) || 1, soldPrice: parseFloat(price) }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast(d.error || "Could not record that sale", "bad"); return; }
    if (d.pending) toast(`Logged, but cannot complete set: ${d.name} has ${d.onHand} on hand, ${d.units} needed. Update inventory, then hit Complete.`, "bad");
    setProduct(""); setQty("1"); setPrice("");
    await Promise.all([onChange(), loadInv()]);
  }

  async function complete(body: { lineId?: string; streamId?: string }) {
    setBusy(true);
    const r = await fetch("/api/lines/store/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast(d.error || "Could not complete that sale", "bad"); return; }
    if (d.errors?.length) toast(d.errors.join(" "), "bad");
    else toast(`${d.completed} store sale${d.completed === 1 ? "" : "s"} completed`, "ok");
    await Promise.all([onChange(), loadInv()]);
  }

  const pendingLines = lines.filter((l) => l.qtyHit < l.qty);
  const soldTotal = lines.reduce((a, l) => a + (l.soldPrice || 0), 0);
  const marketTotal = lines.reduce((a, l) => a + l.qty * l.market, 0);
  const handItem = product ? invById[product] : null;
  const handShort = handItem && (parseInt(qty) || 1) > handItem.qty;

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="label">Store sales</h2>
        <span className="text-dim text-xs">Buy It Now and anything else bought off the shelf. Kept off the show set, so spin stats stay clean.</span>
      </div>

      {pendingLines.length > 0 && (
        <div className="rounded-lg border border-amber-400/60 bg-amber-400/10 p-3 text-sm flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold text-amber-400">{"⚠"} Cannot complete set</div>
            <div className="text-dim text-xs mt-0.5">
              {pendingLines.length} store sale{pendingLines.length === 1 ? " is" : "s are"} logged but waiting on inventory. Update the count in inventory, then complete {pendingLines.length === 1 ? "it" : "them"}.
            </div>
          </div>
          <button className="btn-win text-xs disabled:opacity-40" disabled={busy} onClick={() => complete({ streamId })}>
            Complete what has stock
          </button>
        </div>
      )}

      {/* the sales on this stream */}
      {lines.length > 0 && (
        <div className="space-y-1 text-sm">
          {lines.map((l) => {
            const pending = l.qtyHit < l.qty;
            const item = l.productId ? invById[l.productId] : null;
            return (
              <div key={l.id} className="flex items-center justify-between gap-3 border-t border-edge pt-1.5 flex-wrap">
                <span className="flex items-center gap-2 min-w-0">
                  {pending && <span className="text-amber-400" title="Cannot complete set: not enough in inventory">{"⚠"}</span>}
                  <span className="truncate">{l.qty > 1 ? `${l.qty}x ` : ""}{l.name.replace(/ \(store\)$/, "")}</span>
                  {pending && (
                    <span className="text-amber-400 text-xs">
                      cannot complete set{item ? ` - ${item.qty} on hand, ${l.qty - l.qtyHit} needed` : ""}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <span className="num">{$(l.soldPrice || 0)}</span>
                  <span className={`text-xs ${(l.soldPrice || 0) - l.qty * l.market >= 0 ? "text-win" : "text-bad"}`}>
                    {(l.soldPrice || 0) - l.qty * l.market >= 0 ? "+" : ""}{$((l.soldPrice || 0) - l.qty * l.market)} vs market
                  </span>
                  {pending && (
                    <button className="text-win text-xs disabled:opacity-40" disabled={busy} onClick={() => complete({ lineId: l.id })}>
                      complete
                    </button>
                  )}
                  {editable && (
                    <button
                      className="text-dim hover:text-bad text-xs"
                      onClick={async () => {
                        const r = await fetch(`/api/lines/${l.id}`, { method: "DELETE" });
                        if (!r.ok) toast((await r.json().catch(() => ({}))).error || "Could not undo that sale", "bad");
                        await Promise.all([onChange(), loadInv()]);
                      }}
                    >
                      undo
                    </button>
                  )}
                </span>
              </div>
            );
          })}
          <div className="flex justify-between gap-3 border-t border-edge pt-1.5 font-semibold">
            <span>Store sales {$(soldTotal)} - profit over market</span>
            <span className={`num ${soldTotal - marketTotal >= 0 ? "text-win" : "text-bad"}`}>
              {soldTotal - marketTotal >= 0 ? "+" : ""}{$(soldTotal - marketTotal)}
            </span>
          </div>
        </div>
      )}

      {editable && (
        <>
          {/* by hand */}
          <div className="flex gap-2 flex-wrap items-end">
            <div className="min-w-64 flex-1">
              <label className="label">Item</label>
              <select
                className="input mt-1 w-full"
                value={product}
                onChange={(e) => {
                  setProduct(e.target.value);
                  const p = invById[e.target.value];
                  if (p && !price) setPrice(p.market ? (p.market * (parseInt(qty) || 1)).toFixed(2) : "");
                }}
              >
                <option value="">Pick from inventory...</option>
                {inv.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.qty} on hand{p.market ? ` - mkt $${p.market.toFixed(2)}` : ""})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Units</label>
              <input type="number" min={1} className="input mt-1 w-20" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div>
              <label className="label">Sold for $ (total)</label>
              <input type="number" step="0.01" className="input mt-1 w-28" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <button className="btn-win disabled:opacity-40" disabled={busy || !product || !(parseFloat(price) >= 0)} onClick={addByHand}>
              Sold
            </button>
          </div>
          {handShort && (
            <div className="text-amber-400 text-xs">
              {"⚠"} Only {handItem!.qty} on hand. This will be logged as "cannot complete set" until inventory is updated.
            </div>
          )}

          {/* from Whatnot */}
          <div className="border-t border-edge pt-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="label">Upload from Whatnot</div>
                <div className="text-dim text-xs mt-0.5">
                  The show export or the weekly earnings report. Read on this computer only; buyer names and addresses are never sent.
                </div>
              </div>
              <label className="btn-ghost text-xs cursor-pointer">
                {fileName ? "Choose another file" : "Choose CSV"}
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
              </label>
            </div>

            {parsed?.error && <div className="text-bad text-sm">{parsed.error}</div>}

            {parsed && !parsed.error && (
              <div className="space-y-3">
                <div className="text-xs text-dim">
                  {fileName}: {parsed.sales.length} orders
                  {multiShow && showId && (
                    <>
                      {" "}across {shows.length} shows.{" "}
                      <select className="input inline-block w-auto text-xs py-0.5 ml-1" value={showId} onChange={(e) => { setShowId(e.target.value); setPicks({}); }}>
                        {shows.map((s) => (
                          <option key={s.id} value={s.id}>{localDate(s.start)} - {s.title.slice(0, 70)} ({s.orders})</option>
                        ))}
                      </select>
                    </>
                  )}
                  {found.guessed && " The show export does not say which orders were Buy It Now, so store sales are picked out by title (a pack count like \"5x\", or no wheel prefix). Check the list."}
                </div>

                {preview.length === 0 && <div className="text-dim text-sm">No store sales in this {multiShow ? "show" : "file"}.</div>}

                {preview.length > 0 && (
                  <div className="space-y-2">
                    {preview.map(({ r, p, item, status }) => (
                      <div key={r.key} className={`rounded-lg border p-2.5 text-sm ${status === "booked" ? "border-edge opacity-60" : status === "nomatch" ? "border-bad/60" : status === "short" ? "border-amber-400/60" : "border-edge"}`}>
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <label className="flex items-start gap-2 min-w-0">
                            {status !== "booked" && status !== "nomatch" && (
                              <input type="checkbox" className="mt-1" checked={p.include} onChange={(e) => setPick(r.key, { include: e.target.checked })} />
                            )}
                            <span className="min-w-0">
                              <span className="block truncate">{r.title}</span>
                              <span className="text-dim text-xs">{r.units} unit{r.units === 1 ? "" : "s"} - {$(r.price)}</span>
                            </span>
                          </label>
                          <span className="text-xs">
                            {status === "booked" && <span className="text-dim">already on this stream</span>}
                            {status === "ready" && <span className="text-win">ready</span>}
                            {status === "short" && <span className="text-amber-400">{"⚠"} {item!.qty} on hand, {r.units} needed - will log as cannot complete set</span>}
                            {status === "nomatch" && <span className="text-bad">not in inventory - match it or add it</span>}
                          </span>
                        </div>
                        {status !== "booked" && (
                          <div className="flex gap-2 flex-wrap items-center mt-2">
                            <select
                              className="input text-xs py-1 flex-1 min-w-56"
                              value={p.productId}
                              onChange={(e) => setPick(r.key, { productId: e.target.value, remember: true })}
                            >
                              <option value="">Match to an inventory item...</option>
                              {inv.map((i) => (
                                <option key={i.id} value={i.id}>{i.name} ({i.qty} on hand)</option>
                              ))}
                            </select>
                            <button
                              className="btn-ghost text-xs"
                              onClick={() => {
                                setAdding(adding === r.key ? null : r.key);
                                const n = cleanTitle(r.title);
                                setNewItem({ name: n, category: categoryForName(n), market: r.units > 0 ? (r.price / r.units).toFixed(2) : "", qty: "" });
                              }}
                            >
                              + Add to inventory
                            </button>
                            {p.productId && (
                              <label className="text-dim text-xs flex items-center gap-1" title="Next time a listing with this exact title is uploaded, it matches this item automatically">
                                <input type="checkbox" checked={p.remember} onChange={(e) => setPick(r.key, { remember: e.target.checked })} />
                                remember match
                              </label>
                            )}
                          </div>
                        )}
                        {adding === r.key && (
                          <div className="flex gap-2 flex-wrap items-end mt-2 border-t border-edge pt-2">
                            <div className="flex-1 min-w-48">
                              <label className="label">Name</label>
                              <input className="input mt-1 w-full text-xs" value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} />
                            </div>
                            <div>
                              <label className="label">Category</label>
                              <select className="input mt-1 text-xs" value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}>
                                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="label">Market $ each</label>
                              <input type="number" step="0.01" className="input mt-1 w-24 text-xs" value={newItem.market} onChange={(e) => setNewItem({ ...newItem, market: e.target.value })} />
                            </div>
                            <div>
                              <label className="label">On hand</label>
                              <input type="number" min={0} className="input mt-1 w-20 text-xs" value={newItem.qty} onChange={(e) => setNewItem({ ...newItem, qty: e.target.value })} />
                            </div>
                            <button className="btn-win text-xs disabled:opacity-40" disabled={busy || !newItem.name.trim()} onClick={() => createItem(r.key)}>
                              Add and match
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="text-dim text-xs">
                        {toAdd.length} to add{preview.some((x) => x.status === "nomatch") ? " - rows that are not matched yet are left out" : ""}
                      </span>
                      <button className="btn-win disabled:opacity-40" disabled={busy || toAdd.length === 0} onClick={addFromFile}>
                        {busy ? "Adding..." : `Add ${toAdd.length} store sale${toAdd.length === 1 ? "" : "s"}`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
