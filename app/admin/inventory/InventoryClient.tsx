"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

type Item = {
  id: string; name: string; category: string; buyPrice: number;
  marketPrice: number; qtyOnHand: number; tcgUrl: string; imageUrl?: string; retailPrice?: number | null; entryMarket?: number | null; dateAdded?: string; priceChecked: string | null;
};

import { CATEGORIES as CATS } from "@/lib/categories";
import Thumb from "@/components/Thumb";
import CollectrImport from "@/components/CollectrImport";
import EditCell from "@/components/EditCell";
import DeltaHover from "@/components/DeltaHover";
import { toast } from "@/components/Toaster";
const $ = (n: number) => "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function csvEscape(v: any): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function displayName(name: string, category: string): string {
  if (!category || category === "Other") return name;
  let stripped = name.replace(new RegExp(category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").replace(/\s{2,}/g, " ").trim();
  stripped = stripped.replace(/\b(\w+) \1\b/gi, "$1"); // "2-Pack Pack" -> "2-Pack" after the strip
  return stripped.length >= 3 ? stripped : name;
}

export default function InventoryClient({ isAdmin = true }: { isAdmin?: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState({ name: "", category: "Elite Trainer Box", buyPrice: "", marketPrice: "", qtyOnHand: "", tcgUrl: "" });

  const [refreshingAll, setRefreshingAll] = useState(false);
  const load = useCallback(async () => {
    const d = await fetch("/api/inventory").then((r) => r.json());
    setItems(d.items || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return items;
    return items.filter((i) => i.name.toLowerCase().includes(n) || i.category.toLowerCase().includes(n));
  }, [items, q]);

  function exportCsv() {
    const header = ["Product", "Category", "Buy Price", "Market Price", "Retail Price", "Qty On Hand", "Price Checked", "TCGplayer URL"];
    const rows = filtered.map((i) => [i.name, i.category, i.buyPrice, i.marketPrice, i.retailPrice ?? "", i.qtyOnHand, i.priceChecked ?? "", i.tcgUrl]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkBuy, setBulkBuy] = useState("");
  const [bulkBusy, setBulkBusy] = useState("");

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleSelectAll(ids: string[]) {
    setSelected((prev) => (prev.size === ids.length ? new Set() : new Set(ids)));
  }
  async function bulkPatch(body: Record<string, any>, label: string) {
    setBulkBusy(label);
    for (const id of Array.from(selected)) {
      await fetch(`/api/inventory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    setBulkBusy("");
    setSelected(new Set());
    await load();
    toast("Updated selected products");
  }
  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} products from inventory? Purchase history rows are kept for the record, but the products and their quantities are gone for good.`)) return;
    setBulkBusy("delete");
    for (const id of Array.from(selected)) {
      await fetch(`/api/inventory/${id}`, { method: "DELETE" });
    }
    setBulkBusy("");
    setSelected(new Set());
    await load();
    toast("Deleted selected products");
  }

  const [lotsFor, setLotsFor] = useState<string | null>(null);
  const [lotsCache, setLotsCache] = useState<Record<string, { date: string; qty: number; unitCost: number; source: string }[]>>({});

  async function toggleLots(id: string) {
    if (lotsFor === id) { setLotsFor(null); return; }
    setLotsFor(id);
    if (!lotsCache[id]) {
      const r = await fetch(`/api/inventory/${id}/purchases`);
      if (r.ok) {
        const d = await r.json();
        setLotsCache((prev) => ({ ...prev, [id]: d.lots }));
      }
    }
  }

  const [stockFor, setStockFor] = useState<string | null>(null);
  const [stockQty, setStockQty] = useState("1");
  const [stockCost, setStockCost] = useState("");
  const [stockBusy, setStockBusy] = useState(false);

  async function receiveStock(id: string) {
    setStockBusy(true);
    const r = await fetch(`/api/inventory/${id}/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty: parseInt(stockQty) || 1, unitCost: parseFloat(stockCost) || 0 }),
    });
    setStockBusy(false);
    if (r.ok) {
      setStockFor(null); setStockQty("1"); setStockCost("");
      setLotsCache((prev) => { const n = { ...prev }; delete n[id]; return n; });
      await load();
      toast("Stock received - lot logged and average updated");
    } else {
      toast("Could not receive stock", "bad");
    }
  }

  async function add() {
    if (!draft.name) return;
    setBusy(true);
    await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name, category: draft.category,
        buyPrice: parseFloat(draft.buyPrice) || 0,
        marketPrice: parseFloat(draft.marketPrice) || 0,
        qtyOnHand: parseInt(draft.qtyOnHand) || 0,
        tcgUrl: draft.tcgUrl,
      }),
    });
    setDraft({ name: "", category: "Elite Trainer Box", buyPrice: "", marketPrice: "", qtyOnHand: "", tcgUrl: "" });
    await load();
    setBusy(false);
  }

  async function patch(id: string, fields: any) {
    const r = await fetch(`/api/inventory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    await load();
    if (r.ok) toast("Saved");
    else toast("Save failed", "bad");
  }

  async function refreshPrices(id?: string) {
    setBusy(true); setMsg("Refreshing prices...");
    const res = await fetch("/api/prices/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id } : {}),
    });
    const d = await res.json();
    if (!res.ok) setMsg(d.error || "Price refresh failed");
    else {
      const hit = d.results.filter((r: any) => r.price !== null).length;
      setMsg(`Updated ${hit} of ${d.results.length} products`);
      await load();
    }
    setBusy(false);
    setTimeout(() => setMsg(""), 5000);
  }

  const num = (id: string, key: string, val: number, step = "0.01", extra = "") => (
    <EditCell
      value={val || null}
      money={key !== "qtyOnHand"}
      step={key === "qtyOnHand" ? "1" : step}
      highlightEmpty={key === "buyPrice"}
      placeholder={key === "qtyOnHand" ? "0" : "-"}
      onSave={(v) => patch(id, { [key]: v })}
    />
  );

  return (
    <main className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Inventory</h1>
        <div className="flex items-center gap-3">
          {msg && <span className="text-dim text-sm">{msg}</span>}
          <button className="btn-ghost disabled:opacity-40" disabled={busy} onClick={() => refreshPrices()}>
            Refresh all prices
          </button>
          {isAdmin && (
              <button
                className="btn-ghost !py-1.5 text-xs disabled:opacity-40"
                disabled={refreshingAll}
                onClick={async () => {
                  setRefreshingAll(true);
                  toast("Refreshing every price - this takes a minute or two");
                  const r = await fetch("/api/admin/refresh-prices", { method: "POST" });
                  setRefreshingAll(false);
                  if (r.ok) {
                    const d = await r.json();
                    toast(`Prices refreshed: ${d.sealed.priced} of ${d.sealed.total} sealed, ${d.singles?.refreshed ?? d.singles ?? 0} singles comps, ${d.openLines?.updated ?? 0} live board lines`);
                    await load();
                  } else {
                    toast("Refresh failed - try again in a minute");
                  }
                }}
              >
                {refreshingAll ? "Refreshing..." : "Refresh all prices"}
              </button>
            )}
            <button className="btn-ghost" onClick={exportCsv}>Export CSV</button>
          <CollectrImport onDone={load} />
        </div>
      </div>

      {/* Add product */}
      <div className="card p-4 grid grid-cols-2 md:grid-cols-7 gap-2 items-end">
        <div className="col-span-2">
          <label className="label">Product name</label>
          <input className="input mt-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Category</label>
          <select className="input mt-1" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            {CATS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Buy $</label>
          <input type="number" step="0.01" className="input mt-1" value={draft.buyPrice} onChange={(e) => setDraft({ ...draft, buyPrice: e.target.value })} />
        </div>
        <div>
          <label className="label">Market $</label>
          <input type="number" step="0.01" className="input mt-1" value={draft.marketPrice} onChange={(e) => setDraft({ ...draft, marketPrice: e.target.value })} />
        </div>
        <div>
          <label className="label">On hand</label>
          <input type="number" className="input mt-1" value={draft.qtyOnHand} onChange={(e) => setDraft({ ...draft, qtyOnHand: e.target.value })} />
        </div>
        <button className="btn-foil justify-center disabled:opacity-40" disabled={busy || !draft.name} onClick={add}>
          Add product
        </button>
      </div>

      <input className="input" placeholder='Filter - try "ETB"' value={q} onChange={(e) => setQ(e.target.value)} />

      {/* mobile: card per product for restocks on the floor */}
      <div className="md:hidden space-y-2">
        {filtered.map((i) => {
          const margin = (i.marketPrice || 0) - (i.buyPrice || 0);
          return (
            <div key={i.id} className={`card p-3 ${selected.has(i.id) ? "!border-foil/50" : ""}`}>
              <div className="flex gap-3 items-start">
                <input type="checkbox" className="mt-1" checked={selected.has(i.id)} onChange={() => toggleSelect(i.id)} />
                {i.imageUrl && <Thumb src={i.imageUrl} size={40} />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold leading-tight" title={i.name}>{displayName(i.name, i.category)}</div>
                  <div className="text-dim text-xs">{i.category}</div>
                </div>
                <div className="text-right">
                  <div className="label">On hand</div>
                  <div className="flex items-center gap-2 justify-end">
                    {num(i.id, "qtyOnHand", i.qtyOnHand, "1")}
                    <button className="text-foil text-xs" onClick={() => { setStockFor(stockFor === i.id ? null : i.id); setStockQty("1"); setStockCost(""); }}>+ stock</button>
                  </div>
                </div>
              </div>
              {stockFor === i.id && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-foil/40 bg-foil/5 p-2">
                  <input type="number" min={1} className="input !w-14 !py-1" value={stockQty} onChange={(e) => setStockQty(e.target.value)} title="Quantity received" />
                  <span className="text-dim text-xs">x</span>
                  <input type="number" step="0.01" className="input !w-20 !py-1" placeholder="$ each" value={stockCost} onChange={(e) => setStockCost(e.target.value)} title="Unit cost paid" />
                  <button className="btn-foil !px-2 !py-1 text-xs disabled:opacity-40" disabled={stockBusy} onClick={() => receiveStock(i.id)}>{stockBusy ? "..." : "Add"}</button>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div>
                  <div className="label">Buy (avg)</div>
                  {num(i.id, "buyPrice", i.buyPrice, "0.01")}
                </div>
                <div>
                  <div className="label">Market</div>
                  <span className="inline-flex items-center gap-1">
                    {num(i.id, "marketPrice", i.marketPrice)}
                    <DeltaHover current={i.marketPrice || null} entry={i.entryMarket ?? null} date={i.dateAdded} />
                  </span>
                </div>
                <div>
                  <div className="label">Margin</div>
                  <span className={`num text-sm font-semibold ${margin >= 0 ? "text-win" : "text-bad"}`}>{i.buyPrice > 0 ? $(margin) : "-"}</span>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="text-dim text-sm">No products match</div>}
      </div>

      <div className="card overflow-x-auto hidden md:block">
        <table className="w-full">
          <thead>
            <tr><th className="!px-2 w-8"><input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={() => toggleSelectAll(filtered.map((i) => i.id))} /></th><th>Product</th><th>Category</th><th>Buy (avg)</th><th>Market</th><th>Retail</th><th>Price checked</th><th>Margin</th><th>On hand</th><th>Links</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.map((i) => {
              const margin = (i.marketPrice || 0) - (i.buyPrice || 0);
              return (
                <Fragment key={i.id}>
                <tr className={selected.has(i.id) ? "bg-foil/5" : ""}>
                  <td className="!px-2">
                    <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggleSelect(i.id)} />
                  </td>
                  <td className="!font-medium min-w-[220px] max-w-[300px] !whitespace-normal leading-snug" title={i.name}>
                    {i.imageUrl && <Thumb src={i.imageUrl} size={32} className="mr-2" />}
                    {displayName(i.name, i.category)}
                  </td>
                  <td className="text-dim">{i.category}</td>
                  <td>
                    {num(i.id, "buyPrice", i.buyPrice, "0.01", !(i.buyPrice > 0) ? "!border-amber-400/70 !bg-amber-400/10" : "")}
                    <button
                      className="block text-dim text-[10px] hover:text-body mt-0.5"
                      onClick={() => toggleLots(i.id)}
                      title="Show every purchase lot behind this average"
                    >
                      {lotsFor === i.id ? "\u25BE hide history" : "\u25B8 buy history"}
                    </button>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      {num(i.id, "marketPrice", i.marketPrice)}
                      <DeltaHover current={i.marketPrice || null} entry={i.entryMarket ?? null} date={i.dateAdded} />
                    </span>
                  </td>
                  <td>
                    <EditCell value={i.retailPrice ?? null} onSave={(v) => patch(i.id, { retailPrice: v })} />
                  </td>
                  <td>
                    <PriceAge date={i.priceChecked} />
                  </td>
                  <td className={!(i.buyPrice > 0) ? "text-dim" : margin >= 0 ? "text-win" : "text-bad"}>
                    {!(i.buyPrice > 0) ? "-" : $(margin)}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      {num(i.id, "qtyOnHand", i.qtyOnHand, "1")}
                      <button
                        className="text-foil text-xs hover:underline whitespace-nowrap"
                        title="Receive stock: adds quantity, logs the lot, and rolls the average buy price"
                        onClick={() => { setStockFor(stockFor === i.id ? null : i.id); setStockQty("1"); setStockCost(""); }}
                      >
                        + stock
                      </button>
                    </div>
                    {stockFor === i.id && (
                      <div className="mt-2 flex items-center gap-2 rounded-lg border border-foil/40 bg-foil/5 p-2">
                        <input type="number" min={1} className="input !w-14 !py-1" value={stockQty}
                          onChange={(e) => setStockQty(e.target.value)} title="Quantity received" />
                        <span className="text-dim text-xs">x</span>
                        <input type="number" step="0.01" className="input !w-20 !py-1" placeholder="$ each"
                          value={stockCost} onChange={(e) => setStockCost(e.target.value)} title="Unit cost paid" />
                        <button className="btn-foil !px-2 !py-1 text-xs disabled:opacity-40" disabled={stockBusy}
                          onClick={() => receiveStock(i.id)}>
                          {stockBusy ? "..." : "Add"}
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <a
                      className="text-foil text-xs hover:underline"
                      target="_blank" rel="noreferrer"
                      href={i.tcgUrl || (i.category === "Graded Card"
                        ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(i.name)}&LH_Sold=1&LH_Complete=1`
                        : `https://www.google.com/search?q=${encodeURIComponent(i.name)}+site:tcgplayer.com`)}
                    >
                      {i.category === "Graded Card" ? "Sold comps" : "TCGplayer"}
                    </a>
                    {!i.tcgUrl && i.category !== "Graded Card" && (
                      <a
                        className="text-foil hover:underline ml-2"
                        target="_blank" rel="noreferrer"
                        href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(i.name)}&LH_Sold=1&LH_Complete=1`}
                      >
                        eBay solds
                      </a>
                    )}
                    <button className="text-dim text-xs ml-3 hover:text-body" onClick={() => refreshPrices(i.id)}>
                      refresh
                    </button>
                  </td>
                  <td className="text-right">
                    <button className="text-bad text-xs hover:underline" onClick={() => patch(i.id, { active: false })}>
                      retire
                    </button>
                  </td>
                </tr>
                {lotsFor === i.id && (
                  <tr className="!bg-ink/60">
                    <td className="!py-0 !border-b-0" />
                    <td colSpan={10} className="!py-0">
                      <div className="py-3 pl-2 pr-4 space-y-1.5">
                        <div className="label">Buy history</div>
                        {!lotsCache[i.id] && <div className="text-dim text-xs">Loading...</div>}
                        {lotsCache[i.id] && lotsCache[i.id].length === 0 && (
                          <div className="text-dim text-xs">
                            No lots logged yet. Lots record automatically from + stock, add product, and imports.
                          </div>
                        )}
                        {lotsCache[i.id]?.map((l, idx) => (
                          <div key={idx} className="grid grid-cols-[110px_60px_110px_1fr] gap-3 text-xs items-baseline">
                            <span className="text-dim num">{l.date}</span>
                            <span className="num">{l.qty}x</span>
                            <span className="num font-medium">{"$"}{l.unitCost.toFixed(2)} each</span>
                            <span className="text-dim">{l.source}</span>
                          </div>
                        ))}
                        {lotsCache[i.id] && lotsCache[i.id].length > 0 && (
                          <div className="grid grid-cols-[110px_60px_110px_1fr] gap-3 text-xs pt-1.5 border-t border-edge">
                            <span className="text-dim">average basis</span>
                            <span className="num">{i.qtyOnHand}x</span>
                            <span className="num font-semibold text-foil">{"$"}{(i.buyPrice || 0).toFixed(2)} each</span>
                            <span />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={9} className="text-dim">No products match</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-dim text-xs">
        Market prices are checked manually against TCGplayer (use the link on each row). Editing a market
        price stamps the checked date; amber means it has been more than 14 days.
        Buy price is what you paid, market price drives spot value and break-even. Retired products stay on past
        streams but disappear from the picker. Adding a product to a show set snapshots today&apos;s prices and
        deducts from on-hand quantity; removing it puts the quantity back.
      </p>
    </main>
  );
}


function PriceAge({ date }: { date: string | null }) {
  if (!date) return <span className="text-bad text-xs">never</span>;
  const days = Math.floor((Date.now() - new Date(date + "T00:00:00").getTime()) / 86400000);
  const label = days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
  const cls = days > 14 ? "text-givvy" : "text-dim";
  return <span className={`text-xs ${cls}`}>{label}</span>;
}

// MSRP context under the market price: what the product retails for, and how
// far above or below retail the market sits. Silent when the category is not
// confidently matched - never guess a retail price.
