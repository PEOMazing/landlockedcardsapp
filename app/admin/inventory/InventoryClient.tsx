"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Item = {
  id: string; name: string; category: string; buyPrice: number;
  marketPrice: number; qtyOnHand: number; tcgUrl: string; imageUrl?: string; retailPrice?: number | null; priceChecked: string | null;
};

import { CATEGORIES as CATS } from "@/lib/categories";
import Thumb from "@/components/Thumb";
const $ = (n: number) => "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function csvEscape(v: any): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function InventoryClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState({ name: "", category: "Elite Trainer Box", buyPrice: "", marketPrice: "", qtyOnHand: "", tcgUrl: "" });

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
    await fetch(`/api/inventory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    await load();
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

  const num = (id: string, key: string, val: number, step = "0.01") => (
    <input
      type="number" step={step} className="input !w-24 !py-1" defaultValue={val}
      onBlur={(e) => {
        const v = parseFloat(e.target.value) || 0;
        if (v !== val) patch(id, { [key]: v });
      }}
    />
  );

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Inventory</h1>
        <div className="flex items-center gap-3">
          {msg && <span className="text-dim text-sm">{msg}</span>}
          <button className="btn-ghost disabled:opacity-40" disabled={busy} onClick={() => refreshPrices()}>
            Refresh all prices
          </button>
          <button className="btn-ghost" onClick={exportCsv}>Export CSV</button>
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

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr><th>Product</th><th>Category</th><th>Buy</th><th>Market</th><th>Retail</th><th>Price checked</th><th>Margin</th><th>On hand</th><th>Links</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.map((i) => {
              const margin = (i.marketPrice || 0) - (i.buyPrice || 0);
              return (
                <tr key={i.id}>
                  <td className="!font-medium">
                    {i.imageUrl && <Thumb src={i.imageUrl} size={32} className="mr-2" />}
                    {i.name}
                    {!(i.buyPrice > 0) && (
                      <span className="ml-2 text-xs text-givvy border border-givvy/40 rounded px-1.5 py-0.5 whitespace-nowrap">needs buy price</span>
                    )}
                  </td>
                  <td className="text-dim">{i.category}</td>
                  <td>{num(i.id, "buyPrice", i.buyPrice)}</td>
                  <td>{num(i.id, "marketPrice", i.marketPrice)}</td>
                  <td>
                    <input
                      type="number" step="0.01" className="input !w-20 !py-1"
                      key={`${i.id}-retail-${i.retailPrice}`}
                      defaultValue={i.retailPrice ?? ""}
                      placeholder="-"
                      onBlur={(e) => {
                        const v = e.target.value === "" ? null : parseFloat(e.target.value);
                        if (v !== (i.retailPrice ?? null)) patch(i.id, { retailPrice: v });
                      }}
                    />
                  </td>
                  <td>
                    <PriceAge date={i.priceChecked} />
                  </td>
                  <td className={!(i.buyPrice > 0) ? "text-dim" : margin >= 0 ? "text-win" : "text-bad"}>
                    {!(i.buyPrice > 0) ? "-" : $(margin)}
                  </td>
                  <td>{num(i.id, "qtyOnHand", i.qtyOnHand, "1")}</td>
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
