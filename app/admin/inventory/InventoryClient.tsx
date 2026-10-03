"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

type Item = {
  id: string; name: string; category: string; buyPrice: number;
  marketPrice: number; qtyOnHand: number; tcgUrl: string; imageUrl?: string; retailPrice?: number | null; entryMarket?: number | null; dateAdded?: string; priceChecked: string | null;
  tcgMapped?: boolean;
  // units standing on a show that has not been closed out yet. Derived from
  // the show lines server-side, so it is never editable here.
  qtyOnShows?: number;
  // which shows are holding them. Absent on the great majority of rows, which
  // have nothing out, so the payload stays the size it was.
  showsOnHold?: Hold[];
};

// Graded cards are comped off eBay solds, never TCGplayer, so they are not
// "unmapped" in any sense that needs fixing.
function needsMapping(i: Item): boolean {
  return !i.tcgMapped && i.category !== "Graded Card";
}

import { CATEGORIES as CATS } from "@/lib/categories";
import Thumb from "@/components/Thumb";
import CollectrImport from "@/components/CollectrImport";
import EditCell from "@/components/EditCell";
import DeltaHover from "@/components/DeltaHover";
import TcgMapper from "@/components/TcgMapper";
import TcgNameSync from "@/components/TcgNameSync";
import { toast } from "@/components/Toaster";
import StatTile from "@/components/ui/StatTile";
import OnShowsPanel, { type HeldProduct, type Hold } from "@/components/OnShowsPanel";
import SortableTh from "@/components/ui/SortableTh";
import TableEmpty from "@/components/ui/TableEmpty";
import PageHeader from "@/components/ui/PageHeader";
const $ = (n: number) => "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The stock tiles count units and value them to the nearest dollar. Cents on a
// 240-pack total are noise, and they are the only place in this screen that
// rounds that way, which is why these sit here rather than in the tile.
const units = (n: number) => (n || 0).toLocaleString("en-US");
const atMarket = (n: number) => "$" + Math.round(n || 0).toLocaleString("en-US") + " at market";

function csvEscape(v: any): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function linkLabel(url: string): string {
  if (!url) return "TCGplayer";
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h.includes("tcgplayer")) return "TCGplayer";
    if (h.includes("ebay")) return "eBay";
    return h.split(".")[0];
  } catch { return "Link"; }
}

function displayName(name: string, category: string): string {
  if (!category || category === "Other") return name;
  let stripped = name.replace(new RegExp(category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").replace(/\s{2,}/g, " ").trim();
  stripped = stripped.replace(/\b(\w+) \1\b/gi, "$1"); // "2-Pack Pack" -> "2-Pack" after the strip
  return stripped.length >= 3 ? stripped : name;
}

type StockTab = "in" | "out" | "all";
type SortDir = "asc" | "desc";
type SortKey = "name" | "category" | "buyPrice" | "marketPrice" | "retailPrice" | "priceChecked" | "margin" | "qtyOnHand" | "qtyOnShows" | "qtyTotal";

const onShows = (i: Item): number => Math.max(0, Math.floor(Number(i.qtyOnShows) || 0));
const onHand = (i: Item): number => Math.max(0, Math.floor(Number(i.qtyOnHand) || 0));

// What the business owns: the storage room plus whatever is out on a wheel.
// This is the number to inventory against and the one to check before buying
// more of something.
const ownedTotal = (i: Item): number => onHand(i) + onShows(i);

// One definition of "in stock", shared by the tabs, the counts and the row badge.
//
// Deliberately the shelf, not the total. "Out of stock" here means nothing is
// in the storage room to build a set from, which is the question this tab is
// asked. A product with six units on tonight's wheel is still unbuildable
// today, so it belongs on the Out tab - but the row says "on shows" instead of
// "out" so nobody re-orders something that is standing in the studio.
function inStock(i: Item): boolean {
  return (i.qtyOnHand ?? 0) > 0;
}

// null means "no value" - the comparator sinks those to the bottom either way,
// so a product with no buy price never leads a cheapest-first sort.
function sortValue(i: Item, key: SortKey): string | number | null {
  switch (key) {
    case "name": return i.name || "";
    case "category": return i.category || "";
    case "buyPrice": return i.buyPrice > 0 ? i.buyPrice : null;
    case "marketPrice": return i.marketPrice > 0 ? i.marketPrice : null;
    case "retailPrice": return i.retailPrice ?? null;
    case "priceChecked": return i.priceChecked ? new Date(i.priceChecked + "T00:00:00").getTime() : null;
    case "margin": return i.buyPrice > 0 ? (i.marketPrice || 0) - i.buyPrice : null;
    case "qtyOnHand": return i.qtyOnHand ?? 0;
    case "qtyOnShows": return onShows(i);
    case "qtyTotal": return ownedTotal(i);
  }
}

function emptyLabel(tab: StockTab, q: string, unmappedOnly = false): string {
  if (unmappedOnly) return "Every product here is mapped to a TCGplayer product";
  if (q.trim()) return "No products match that filter";
  if (tab === "in") return "Nothing in stock right now";
  if (tab === "out") return "Nothing is out of stock - everything has quantity on hand";
  return "No products yet";
}

export default function InventoryClient({ isAdmin = true }: { isAdmin?: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState({ name: "", category: "Elite Trainer Box", buyPrice: "", marketPrice: "", qtyOnHand: "", tcgUrl: "" });

  const [refreshingAll, setRefreshingAll] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const load = useCallback(async () => {
    const d = await fetch("/api/inventory").then((r) => r.json());
    setItems(d.items || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  // ?q=Product+Name puts that product in the filter box, so a link from the
  // command palette lands on the product rather than on all 162 of them.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("q");
    if (fromUrl) setQ(fromUrl);
  }, []);

  // Which products' holds the panel is showing. null is closed. Holding the
  // list rather than a product id lets the same panel serve the header tile
  // (everything out) and one row (one product) without two code paths.
  const [holdView, setHoldView] = useState<{ title: string; products: HeldProduct[] } | null>(null);

  const held = useCallback(
    (i: Item): HeldProduct => ({ id: i.id, name: i.name, market: i.marketPrice || 0, holds: i.showsOnHold || [] }),
    [],
  );

  const [stockTab, setStockTab] = useState<StockTab>("in");
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Clicking the active column flips it; a new column starts in the direction
  // that reads best - A to Z for text, biggest-first for money and quantity.
  function sortBy(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "category" ? "asc" : "desc");
    }
  }

  const searched = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return items;
    return items.filter((i) => i.name.toLowerCase().includes(n) || i.category.toLowerCase().includes(n));
  }, [items, q]);

  // Counted off `searched` so the tab numbers respect whatever is in the filter box.
  const counts = useMemo(() => {
    const inCount = searched.reduce((n, i) => n + (inStock(i) ? 1 : 0), 0);
    return { in: inCount, out: searched.length - inCount, all: searched.length };
  }, [searched]);

  // Where the stock physically is, across whatever is in the filter box. Three
  // numbers rather than one because "we have 300 packs" and "there are 300
  // packs in the storage room" stopped being the same sentence the moment sets
  // started getting built a week ahead.
  //
  // One named source for both the number and the panel behind it. They were
  // two expressions that happened to agree until the stock tab was added, and
  // nothing in the code said they had to. Now they read the same binding, and
  // a test asserts they still do.
  const stockSource = searched;

  const stockTotals = useMemo(() => {
    let hand = 0, shows = 0, handValue = 0, showsValue = 0;
    for (const i of stockSource) {
      const h = onHand(i), s = onShows(i), p = i.marketPrice || 0;
      hand += h; shows += s; handValue += h * p; showsValue += s * p;
    }
    return { hand, shows, total: hand + shows, handValue, showsValue, totalValue: handValue + showsValue };
  }, [stockSource]);

  // Counted against whatever the stock tab is showing, so "12 unmapped" on the
  // In stock tab means twelve products you are actually selling have no link.
  const unmappedCount = useMemo(() => {
    const rows = stockTab === "all" ? searched : searched.filter((i) => (stockTab === "in" ? inStock(i) : !inStock(i)));
    return rows.reduce((n, i) => n + (needsMapping(i) ? 1 : 0), 0);
  }, [searched, stockTab]);

  const filtered = useMemo(() => {
    let rows = stockTab === "all" ? searched.slice() : searched.filter((i) => (stockTab === "in" ? inStock(i) : !inStock(i)));
    if (unmappedOnly) rows = rows.filter(needsMapping);
    const dir = sortDir === "asc" ? 1 : -1;
    return rows.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      // Nulls sink to the bottom in both directions.
      if (av === null && bv === null) return a.name.localeCompare(b.name);
      if (av === null) return 1;
      if (bv === null) return -1;
      const c = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
      return c !== 0 ? c * dir : a.name.localeCompare(b.name);
    });
  }, [searched, stockTab, unmappedOnly, sortKey, sortDir]);

  function exportCsv() {
    const header = ["Product", "Category", "Buy Price", "Market Price", "Retail Price", "Qty On Hand", "Qty On Shows", "Qty Owned", "Price Checked", "TCGplayer URL"];
    const rows = filtered.map((i) => [i.name, i.category, i.buyPrice, i.marketPrice, i.retailPrice ?? "", i.qtyOnHand, onShows(i), ownedTotal(i), i.priceChecked ?? "", i.tcgUrl]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `inventory-${stockTab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // A row selected on one tab would otherwise stay selected while hidden, and a
  // bulk edit or delete would hit rows the user cannot see.
  useEffect(() => { setSelected(new Set()); }, [stockTab]);
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
  // Both of these report what actually happened, not what was asked for.
  //
  // They used to count `selected.size` and announce that as the result without
  // reading a single response. That is not a race that occasionally misleads:
  // this page is open to managers, and DELETE /api/inventory/[id] is admin
  // only, so for a manager every request was a 403 and the toast said "20
  // products deleted" over a table that still had all twenty rows in it.
  //
  // A toast that contradicts the screen underneath it teaches people to
  // distrust the screen, because the toast is the thing that sounds official.
  async function runBulk(
    label: string,
    ids: string[],
    send: (id: string) => Promise<Response>,
    verb: string,
  ) {
    setBulkBusy(label);
    let ok = 0;
    const failed: string[] = [];
    try {
      for (const id of ids) {
        try {
          const r = await send(id);
          if (r.ok) ok++;
          else failed.push(items.find((i) => i.id === id)?.name || id);
        } catch {
          failed.push(items.find((i) => i.id === id)?.name || id);
        }
      }
    } finally {
      // finally, so a thrown request cannot leave the button stuck on
      // "Working..." with the selection still held and nothing said.
      setBulkBusy("");
    }
    setSelected(new Set());
    await load();
    if (failed.length === 0) {
      toast(`${ok} product${ok === 1 ? "" : "s"} ${verb}`);
    } else {
      const named = failed.slice(0, 3).join(", ");
      const more = failed.length > 3 ? ` and ${failed.length - 3} more` : "";
      toast(`${ok} of ${ids.length} ${verb}. Not ${verb}: ${named}${more}`, "bad");
    }
  }

  async function bulkPatch(body: Record<string, any>, label: string) {
    await runBulk(
      label,
      Array.from(selected),
      (id) =>
        fetch(`/api/inventory/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      "updated",
    );
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} products from inventory? Purchase history rows are kept for the record, but the products and their quantities are gone for good.`)) return;
    await runBulk(
      "delete",
      Array.from(selected),
      (id) => fetch(`/api/inventory/${id}`, { method: "DELETE" }),
      "deleted",
    );
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
    // An empty cost box used to coerce to 0, log a lot at $0 each, drag the
    // running average down, and report success. Receiving free stock is a real
    // thing, so this asks rather than blocks - but it has to ask, because the
    // buy price is what every margin and break-even number on the show page is
    // built from, and nothing afterwards says the average moved for the wrong
    // reason.
    const cost = parseFloat(stockCost);
    if (!(cost > 0)) {
      const name = items.find((x) => x.id === id)?.name || "this product";
      if (!confirm(`Log ${parseInt(stockQty) || 1} of ${name} at $0 each?\n\nThat is right for free or promo stock. For anything you paid for, cancel and type the unit cost: this rolls into the average buy price behind every margin and break-even figure.`)) return;
    }
    setStockBusy(true);
    const r = await fetch(`/api/inventory/${id}/purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qty: parseInt(stockQty) || 1, unitCost: cost > 0 ? cost : 0 }),
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
    const r = await fetch("/api/inventory", {
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
    // The form used to clear whatever the server said. A failed add therefore
    // looked identical to a successful one, except the product was not there
    // and everything just typed was gone. Keep the draft on failure so it can
    // be retried rather than retyped.
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast(d.error || "Could not add the product - your entries are still here, try again", "bad");
      setBusy(false);
      return;
    }
    toast(`${draft.name.trim()} added`);
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
      <PageHeader
        title="Inventory"
        actions={
          <>
            {msg && <span className="text-dim text-sm">{msg}</span>}
            {/* Two buttons here were both called "Refresh all prices" and they
                are not the same job. This one is sealed product only. The
                admin one below runs the whole nightly pipeline: sealed, then
                singles comps, then the live board. Same label on both meant
                picking between them was a coin toss, and the cheap one looks
                like it did nothing when what you wanted was the other. */}
            <button
              className="btn-ghost disabled:opacity-40"
              disabled={busy}
              onClick={() => refreshPrices()}
              title="Market prices for sealed product only, from the TCGplayer mirror. Quick."
            >
              Refresh sealed prices
            </button>
            {isAdmin && (
                <button
                  className="btn-ghost !py-1.5 text-xs disabled:opacity-40"
                  disabled={refreshingAll}
                  title="The full nightly pipeline on demand: sealed markets, then every single's comp, then the live board lines. Takes a minute or two."
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
                  {refreshingAll ? "Refreshing..." : "Refresh everything"}
                </button>
              )}
              {isAdmin && (
                <button
                  className="btn-ghost !py-1.5 text-xs disabled:opacity-40"
                  disabled={backfilling}
                  title="Work out the TCGplayer set for every product that already has a link, so those get priced by exact product id too"
                  onClick={async () => {
                    setBackfilling(true);
                    const r = await fetch("/api/admin/backfill-tcg-map", { method: "POST" });
                    setBackfilling(false);
                    if (!r.ok) { toast("Backfill failed - try again in a minute", "bad"); return; }
                    const d = await r.json();
                    toast(
                      `Mapped ${d.mapped} products from their existing links` +
                        (d.already ? `, ${d.already} already mapped` : "") +
                        (d.unresolved?.length ? `, ${d.unresolved.length} could not be worked out` : "")
                    );
                    await load();
                  }}
                >
                  {backfilling ? "Mapping..." : "Map existing links"}
                </button>
              )}
              {isAdmin && <TcgNameSync onDone={load} />}
              <button className="btn-ghost" onClick={exportCsv}>Export CSV</button>
            <CollectrImport onDone={load} />
          </>
        }
      />

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
        <div className="sm:col-span-2">
          <label className="label">Price link (TCGplayer, eBay, or any URL)</label>
          <input className="input mt-1" placeholder="https://www.tcgplayer.com/product/... or an eBay link" value={draft.tcgUrl} onChange={(e) => setDraft({ ...draft, tcgUrl: e.target.value })} />
          <p className="text-dim t-meta mt-1">TCGplayer links wire into the nightly price refresh. Anything else (eBay etc.) is kept as a reference link and never auto-priced.</p>
        </div>
        <button className="btn-foil justify-center disabled:opacity-40" disabled={busy || !draft.name} onClick={add}>
          Add product
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-edge overflow-hidden" role="tablist" aria-label="Stock filter">
          {([["in", "In stock", counts.in], ["out", "Out of stock", counts.out], ["all", "All", counts.all]] as [StockTab, string, number][]).map(([tab, label, n]) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={stockTab === tab}
              onClick={() => setStockTab(tab)}
              className={`px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${stockTab === tab ? "bg-foil/15 text-foil font-semibold" : "text-dim hover:text-body"}`}
            >
              {label}
              <span className="num ml-1.5 text-xs opacity-70">{n}</span>
            </button>
          ))}
        </div>
        {/* Products with no TCGplayer link are the ones the nightly refresh has
            to guess at, which is where wrong and missing prices come from. */}
        <button
          type="button"
          aria-pressed={unmappedOnly}
          onClick={() => setUnmappedOnly((v) => !v)}
          title="Show only products that are not locked to a TCGplayer product"
          className={`px-3 py-1.5 text-sm whitespace-nowrap rounded-lg border transition-colors ${
            unmappedOnly ? "border-givvy/60 bg-givvy/15 text-givvy font-semibold" : "border-edge text-dim hover:text-body"
          }`}
        >
          Unmapped
          <span className="num ml-1.5 text-xs opacity-70">{unmappedCount}</span>
        </button>
        </div>

        {/* The row checkboxes have always worked, on desktop and on mobile, and
            there was nothing to press once you had ticked them: bulkPatch and
            bulkDelete existed in this file with no caller. Ticking two hundred
            rows and finding no action is worse than having no checkboxes, so
            here is the bar they were written for. */}
        {selected.size > 0 && (
          <div className="sticky top-2 z-20 flex flex-wrap items-center gap-s3 rounded-lg border border-foil/40 bg-panel/95 backdrop-blur px-s3 py-s2 lifted">
            <span className="t-body font-semibold">
              <span className="num text-foil">{selected.size}</span> selected
            </span>
            <select
              className="input !w-auto !py-1 t-meta"
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
              disabled={!!bulkBusy}
            >
              <option value="">Set category to...</option>
              {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button
              className="btn-ghost !py-1 t-meta disabled:opacity-40"
              disabled={!bulkCategory || !!bulkBusy}
              onClick={() => {
                if (!confirm(`Set the category of ${selected.size} product${selected.size === 1 ? "" : "s"} to ${bulkCategory}?`)) return;
                bulkPatch({ category: bulkCategory }, "category").then(() => setBulkCategory(""));
              }}
            >
              {bulkBusy === "category" ? "Working..." : "Apply"}
            </button>
            <span className="flex items-center gap-s2">
              <input
                className="input !w-24 !py-1 t-meta"
                inputMode="decimal"
                placeholder="Buy $ each"
                value={bulkBuy}
                onChange={(e) => setBulkBuy(e.target.value)}
                disabled={!!bulkBusy}
              />
              <button
                className="btn-ghost !py-1 t-meta disabled:opacity-40"
                disabled={!bulkBuy || !!bulkBusy}
                onClick={() => {
                  const v = parseFloat(bulkBuy);
                  if (!(v >= 0)) { toast("Type a buy price first", "bad"); return; }
                  if (!confirm(`Set the buy price of ${selected.size} product${selected.size === 1 ? "" : "s"} to $${v.toFixed(2)} each? This replaces the running average on each one.`)) return;
                  bulkPatch({ buyPrice: v }, "buy").then(() => setBulkBuy(""));
                }}
              >
                {bulkBusy === "buy" ? "Working..." : "Set buy price"}
              </button>
            </span>
            <button className="text-dim hover:text-body t-meta ml-auto" onClick={() => setSelected(new Set())}>clear</button>
            {/* Admin only, because the route is. This page is open to managers,
                so without the gate the button is visible to someone the server
                will refuse, which is a worse experience than not offering it. */}
            {isAdmin && (
              <button
                className="text-bad hover:underline t-meta disabled:opacity-40"
                disabled={!!bulkBusy}
                onClick={bulkDelete}
              >
                {bulkBusy === "delete" ? "Deleting..." : `Delete ${selected.size}`}
              </button>
            )}
          </div>
        )}

        {/* Where the units physically are. Reads across the filter box, so
            typing "booster" answers "how many boosters do we own" directly. */}
        <div className="flex flex-wrap items-stretch gap-2">
          <StatTile label="In the storage room" value={units(stockTotals.hand)} sub={atMarket(stockTotals.handValue)} size="md" surface="inline" />
          <StatTile
            label="Out on shows"
            value={units(stockTotals.shows)}
            sub={atMarket(stockTotals.showsValue)}
            tone="foil"
            size="md"
            surface="inline"
            // Fed from `searched`, which is the exact set stockTotals counts.
            // Not `filtered`: that applies the stock tab, and the default tab
            // is In stock, so a product whose whole quantity is out on a show
            // has nothing on hand and drops out of the list while still being
            // counted in the number above it. The tile then said 491 and the
            // panel listed 478, and the moment those two disagree neither one
            // is worth opening.
            onClick={
              stockTotals.shows > 0
                ? () => setHoldView({ title: "Out on shows", products: stockSource.filter((i) => i.showsOnHold?.length).map(held) })
                : undefined
            }
            title={stockTotals.shows > 0 ? "See which shows are holding these" : undefined}
          />
          <StatTile label="Owned" value={units(stockTotals.total)} sub={atMarket(stockTotals.totalValue)} size="md" surface="inline" highlight />
        </div>
        {/* the mobile cards have no header row to click, so sorting needs its own control */}
        <label className="md:hidden flex items-center gap-2 label">
          Sort
          <select
            className="input !w-auto !py-1 text-xs"
            value={`${sortKey}:${sortDir}`}
            onChange={(e) => {
              const [k, d] = e.target.value.split(":");
              setSortKey(k as SortKey);
              setSortDir(d as SortDir);
            }}
          >
            <option value="name:asc">Product A-Z</option>
            <option value="marketPrice:desc">Market high to low</option>
            <option value="marketPrice:asc">Market low to high</option>
            <option value="buyPrice:desc">Buy high to low</option>
            <option value="margin:desc">Margin high to low</option>
            <option value="margin:asc">Margin low to high</option>
            <option value="qtyOnHand:desc">On hand high to low</option>
            <option value="qtyOnHand:asc">On hand low to high</option>
            <option value="qtyOnShows:desc">Most out on shows</option>
            <option value="qtyTotal:desc">Most owned</option>
            <option value="priceChecked:asc">Price checked oldest first</option>
          </select>
        </label>
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
                  <select
                    className="bg-transparent text-dim text-xs border border-transparent hover:border-edge rounded px-1 py-0.5 cursor-pointer max-w-[160px]"
                    value={i.category}
                    onChange={(e) => patch(i.id, { category: e.target.value })}
                    title="Change category"
                  >
                    {!CATS.includes(i.category as any) && <option value={i.category}>{i.category}</option>}
                    {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="text-right">
                  <div className="label">
                    On hand
                    {!inStock(i) && (
                      onShows(i) > 0
                        ? <span className="text-foil ml-1">- on shows</span>
                        : <span className="text-bad ml-1">- out</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    {num(i.id, "qtyOnHand", i.qtyOnHand, "1")}
                    <button className="text-foil text-xs" onClick={() => { setStockFor(stockFor === i.id ? null : i.id); setStockQty("1"); setStockCost(""); }}>+ stock</button>
                  </div>
                  {onShows(i) > 0 && (
                    <div className="text-dim t-meta mt-0.5 whitespace-nowrap">
                      <button
                        type="button"
                        className="text-foil hover:underline"
                        onClick={() => setHoldView({ title: i.name, products: [held(i)] })}
                      >
                        <span className="num">{onShows(i)}</span> on shows
                      </button>
                      {" · "}
                      <span className="num">{ownedTotal(i)}</span> owned
                    </div>
                  )}
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
              {i.category !== "Graded Card" && (
                <div className="mt-2 flex items-center gap-3 border-t border-edge pt-2">
                  <TcgMapper id={i.id} name={i.name} currentUrl={i.tcgUrl} mapped={!!i.tcgMapped} onDone={load} />
                  {needsMapping(i) && <span className="text-givvy t-meta uppercase tracking-wide">no TCGplayer link</span>}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <div className="text-dim text-sm">{emptyLabel(stockTab, q, unmappedOnly)}</div>}
      </div>

      <div className="card overflow-x-auto hidden md:block">
        <table className="w-full">
          <thead>
            <tr>
              <th className="!px-2 w-8"><input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={() => toggleSelectAll(filtered.map((i) => i.id))} /></th>
              <SortableTh label="Product" k="name" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <SortableTh label="Category" k="category" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <SortableTh label="Buy (avg)" k="buyPrice" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <SortableTh label="Market" k="marketPrice" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <SortableTh label="Retail" k="retailPrice" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <SortableTh label="Price checked" k="priceChecked" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <SortableTh label="Margin" k="margin" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} />
              <SortableTh label="On hand" k="qtyOnHand" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} title="In the storage room right now" />
              <SortableTh label="On shows" k="qtyOnShows" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} title="Assigned to a show that has not been closed out yet. Worked out from the show lines, so it cannot be edited here." />
              <SortableTh label="Owned" k="qtyTotal" sortKey={sortKey} sortDir={sortDir} onSort={sortBy} title="On hand plus on shows: what the business actually has, and the number to check before buying more" />
              <th>Links</th>
              <th></th>
            </tr>
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
                  <td>
                    <select
                      className="bg-transparent text-dim text-xs border border-transparent hover:border-edge rounded px-1 py-0.5 cursor-pointer max-w-[150px]"
                      value={i.category}
                      onChange={(e) => patch(i.id, { category: e.target.value })}
                      title="Change category"
                    >
                      {!CATS.includes(i.category as any) && <option value={i.category}>{i.category}</option>}
                      {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td>
                    {num(i.id, "buyPrice", i.buyPrice, "0.01", !(i.buyPrice > 0) ? "!border-warn/70 !bg-warn/10" : "")}
                    <button
                      className="block text-dim t-meta hover:text-body mt-0.5"
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
                      {!inStock(i) && (
                        onShows(i) > 0
                          ? <span className="text-foil t-meta uppercase tracking-wide whitespace-nowrap" title="None on the shelf, but these are standing on an open show">on shows</span>
                          : <span className="text-bad t-meta uppercase tracking-wide">out</span>
                      )}
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
                  {/* Read-only on purpose: these units are wherever the show
                      lines say they are, and a box you could type in would be
                      a second place for the truth to live. */}
                  <td>
                    {onShows(i) > 0 ? (
                      <button
                        type="button"
                        className="num text-foil font-semibold hover:underline"
                        title={`See which show${(i.showsOnHold?.length ?? 0) === 1 ? "" : "s"} ${i.name} is on`}
                        onClick={() => setHoldView({ title: i.name, products: [held(i)] })}
                      >
                        {onShows(i)}
                      </button>
                    ) : (
                      <span className="text-dim">-</span>
                    )}
                  </td>
                  <td>
                    <span className={`num font-semibold ${ownedTotal(i) > 0 ? "" : "text-dim"}`}>{ownedTotal(i)}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    <a
                      className="text-foil text-xs hover:underline"
                      target="_blank" rel="noreferrer"
                      href={i.tcgUrl || (i.category === "Graded Card"
                        ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(i.name)}&LH_Sold=1&LH_Complete=1`
                        : `https://www.google.com/search?q=${encodeURIComponent(i.name)}+site:tcgplayer.com`)}
                    >
                      {i.category === "Graded Card" ? "Sold comps" : linkLabel(i.tcgUrl)}
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
                    {i.category !== "Graded Card" && (
                      <span className="ml-3">
                        <TcgMapper id={i.id} name={i.name} currentUrl={i.tcgUrl} mapped={!!i.tcgMapped} onDone={load} />
                      </span>
                    )}
                    <button className="text-dim text-xs ml-3 hover:text-body" onClick={() => refreshPrices(i.id)}>
                      refresh
                    </button>
                  </td>
                  <td className="text-right">
                    <button className="text-bad text-xs hover:underline" onClick={() => { if (confirm(`Retire ${i.name}? It stays on past streams and keeps its history, but disappears from the show-set picker and this list.`)) patch(i.id, { active: false }); }}>
                      retire
                    </button>
                  </td>
                </tr>
                {lotsFor === i.id && (
                  <tr className="!bg-ink/60">
                    <td className="!py-0 !border-b-0" />
                    <td colSpan={12} className="!py-0">
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
            {filtered.length === 0 && <TableEmpty>{emptyLabel(stockTab, q, unmappedOnly)}</TableEmpty>}
          </tbody>
        </table>
      </div>
      <p className="text-dim text-xs">
        <strong className="text-body">map</strong> locks a product to one exact TCGplayer product. Paste the
        product link, check the match it shows you, save, and every refresh from then on reads that product&apos;s
        price directly. Anything left <strong className="text-body">unmapped</strong> has to be recognised by name,
        which is why oddly named products can sit at no price forever. Editing a market
        price stamps the checked date; the warn colour means more than 14 days.
        Buy price is what you paid, market price drives spot value and break-even. Retired products stay on past
        streams but disappear from the picker. Adding a product to a show set snapshots today&apos;s prices and
        deducts from on-hand quantity; removing it puts the quantity back.
        {" "}
        On hand is the storage room. On shows is everything sitting on a show that has not been closed out yet,
        worked out from the show lines rather than stored, so it cannot drift away from them. Owned is the two
        added together, and it is the number to check before buying more of something.
        {" "}
        Any on-shows number can be clicked to see which shows are holding it.
      </p>

      {holdView && (
        <OnShowsPanel
          title={holdView.title}
          products={holdView.products}
          onClose={() => setHoldView(null)}
        />
      )}
    </main>
  );
}


// The three stock numbers, totalled across whatever the filter box is showing.

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
