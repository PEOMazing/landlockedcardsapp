"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import CompSales from "@/components/CompSales";
import EditCell from "@/components/EditCell";
import { toast } from "@/components/Toaster";
import CollectrImport from "@/components/CollectrImport";

const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CONDITIONS = ["NM", "LP", "MP", "HP", "DM", "PSA 10", "PSA 9", "PSA 8", "CGC 10", "CGC 9.5", "BGS 9.5", "Other"];
const GRADED = ["PSA 10", "PSA 9", "PSA 8", "CGC 10", "CGC 9.5", "BGS 9.5", "Other"];
const CONDITION_LABELS: Record<string, string> = {
  NM: "NM - Near Mint", LP: "LP - Lightly Played", MP: "MP - Moderately Played",
  HP: "HP - Heavily Played", DM: "DM - Damaged",
};

type SingleT = {
  id: string; name: string; setName: string; number: string; cardId: string;
  rarity: string; variant: string; condition: string;
  comp: number | null; compSource: string; compDate: string; entryComp: number | null;
  compDetail: { date: string; price: number; qty: number }[] | null; tcgProductId: number | null;
  image: string; qty: number; status: string; salePrice: number | null; soldDate: string;
  notes: string; addedBy: string; dateAdded: string; buy?: number;
};

type SearchCard = {
  id: string; name: string; number: string; rarity: string;
  setName: string; image?: string; market: number | null;
};

function csvEscape(v: any): string {
  const x = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
}

export default function SinglesClient({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const [singles, setSingles] = useState<SingleT[]>([]);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupMsg, setSetupMsg] = useState("");
  const [statusFilter, setStatusFilter] = useState("In Stock");
  const [tableQ, setTableQ] = useState("");
  const [busy, setBusy] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [err, setErr] = useState("");

  // add flow
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SearchCard | null>(null);
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState({ name: "", setName: "", number: "", condition: "NM", qty: "1", buyPrice: "", comp: "", notes: "" });
  const debounce = useRef<any>(null);

  async function load() {
    const r = await fetch("/api/singles");
    const d = await r.json();
    setSingles(d.singles || []);
    setNeedsSetup(!!d.needsSetup);
  }
  useEffect(() => { load(); }, []);

  // live card search against pokemontcg.io
  useEffect(() => {
    if (picked || manual) return;
    const term = q.trim();
    if (term.length < 3) { setResults([]); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/pokemon/cards?q=${encodeURIComponent(term)}`);
        const d = await r.json();
        setResults(d.cards || []);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(debounce.current);
  }, [q, picked, manual]);

  async function runSetup() {
    setBusy("setup"); setSetupMsg("Running setup...");
    const r = await fetch("/api/admin/setup/breaks", { method: "POST" });
    const d = await r.json();
    setSetupMsg(r.ok ? `Done: ${(d.done || []).join(", ")}` : `Setup failed: ${d.error}`);
    setBusy("");
    if (r.ok) await load();
  }

  async function addCard() {
    setBusy("add"); setErr("");
    const body: any = {
      condition: draft.condition,
      qty: parseInt(draft.qty) || 1,
      notes: draft.notes,
      ...(isAdmin && draft.buyPrice ? { buyPrice: parseFloat(draft.buyPrice) } : {}),
    };
    if (picked) {
      body.cardId = picked.id;
      // graded cards need a manual comp even when API-linked
      if (GRADED.includes(draft.condition) && draft.comp) body.comp = parseFloat(draft.comp);
    } else {
      body.name = draft.name.trim();
      body.setName = draft.setName.trim();
      body.number = draft.number.trim();
      if (draft.comp) { body.comp = parseFloat(draft.comp); body.compSource = "manual"; }
    }
    const r = await fetch("/api/singles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) setErr(d.error || "Could not add card");
    else {
      setPicked(null); setManual(false); setQ(""); setResults([]);
      setDraft({ name: "", setName: "", number: "", condition: "NM", qty: "1", buyPrice: "", comp: "", notes: "" });
      await load();
    }
    setBusy("");
  }

  async function refreshComp(id: string) {
    setBusy(id); setErr("");
    const r = await fetch(`/api/singles/${id}/comp`, { method: "POST" });
    const d = await r.json();
    if (!r.ok) setErr(d.error || "Comp refresh failed");
    else setSingles((prev) => prev.map((s) => (s.id === id ? d.single : s)));
    setBusy("");
  }

  async function patch(id: string, body: any) {
    const r = await fetch(`/api/singles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (r.ok) { setSingles((prev) => prev.map((s) => (s.id === id ? d.single : s))); toast("Saved"); }
    else { setErr(d.error || "Update failed"); toast(d.error || "Update failed", "bad"); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this card from the singles inventory?")) return;
    const r = await fetch(`/api/singles/${id}`, { method: "DELETE" });
    if (r.ok) { setSingles((prev) => prev.filter((s) => s.id !== id)); toast("Card deleted"); }
    else { const e = (await r.json()).error || "Delete failed"; setErr(e); toast(e, "bad"); }
  }

  const [setFilter, setSetFilter] = useState("All");
  const [sortBy, setSortBy] = useState("newest");

  const setNames = useMemo(
    () => Array.from(new Set(singles.map((s) => s.setName).filter(Boolean))).sort(),
    [singles]
  );

  const shown = useMemo(() => {
    let list = statusFilter === "All" ? singles : singles.filter((s) => s.status === statusFilter);
    if (setFilter !== "All") list = list.filter((s) => s.setName === setFilter);
    // token search: every word must match somewhere, so "umbreon prismatic"
    // finds Umbreons in Prismatic Evolutions
    const tokens = tableQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length) {
      list = list.filter((s) => {
        const hay = `${s.name} ${s.setName} ${s.number} ${s.condition} ${s.rarity}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    }
    list = [...list];
    if (sortBy === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "price-desc") list.sort((a, b) => (b.comp || 0) - (a.comp || 0));
    else if (sortBy === "price-asc") list.sort((a, b) => (a.comp || 0) - (b.comp || 0));
    // "newest" keeps API order (Date Added desc)
    return list;
  }, [singles, statusFilter, setFilter, sortBy, tableQ]);

  const stockValue = singles.filter((s) => s.status === "In Stock").reduce((a, s) => a + (s.comp || 0) * (s.qty || 1), 0);
  const soldTotal = singles.filter((s) => s.status === "Sold").reduce((a, s) => a + (s.salePrice || 0), 0);

  // totals over exactly what is shown: they react to search, set, and status filters
  const totals = useMemo(() => {
    let cards = 0, spend = 0, market = 0, profit = 0;
    for (const s of shown) {
      const q = s.qty || 1;
      cards += q;
      spend += (s.buy || 0) * q;
      market += (s.comp || 0) * q;
      // realized price counts once a card actually sold; otherwise the comp
      const value = s.status === "Sold" && s.salePrice !== null ? s.salePrice : (s.comp || 0);
      profit += (value - (s.buy || 0)) * q;
    }
    return { cards, spend, market, profit };
  }, [shown]);

  function exportCsv() {
    const header = [
      "Card", "Set", "Number", "Condition", "Rarity", "Qty", "Status",
      "Comp", "Comp Source", "Comp Date",
      ...(isAdmin ? ["Buy Price"] : []),
      "Sale Price", "Sold Date", "Date Added", "Added By", "Notes",
    ];
    const rows = shown.map((s) => [
      s.name, s.setName, s.number, s.condition, s.rarity, s.qty, s.status,
      s.comp ?? "", s.compSource, s.compDate,
      ...(isAdmin ? [s.buy ?? ""] : []),
      s.salePrice ?? "", s.soldDate, s.dateAdded, s.addedBy, s.notes,
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `singles-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const ebayLink = (s: SingleT) =>
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${s.name} ${s.setName} ${s.number} ${s.condition !== "Raw" ? s.condition : ""}`.trim())}&LH_Sold=1&LH_Complete=1`;

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          Singles <span className="text-foil">inventory</span>
        </h1>
        <div className="flex gap-6 text-sm">
          <span className="text-dim">In stock value <span className="text-foil font-bold num">{$(stockValue)}</span></span>
          <span className="text-dim">Sold to date <span className="text-win font-bold num">{$(soldTotal)}</span></span>
        </div>
      </div>

      {needsSetup && (
        <div className="card p-5 border-foil/40 space-y-2">
          <div className="text-sm">
            The Singles table has not been created in Airtable yet.
            {isAdmin ? " One click sets up everything (Singles table, stream types, sale price fields)." : " Ask an admin to run setup from this page."}
          </div>
          {isAdmin && (
            <button className="btn-foil disabled:opacity-40" disabled={busy === "setup"} onClick={runSetup}>
              {busy === "setup" ? "Setting up..." : "Run one-time setup"}
            </button>
          )}
          {setupMsg && <div className="text-dim text-xs">{setupMsg}</div>}
          <p className="text-dim text-xs">
            If setup fails with a 403, the Airtable token needs the schema.bases:write scope added at airtable.com/create/tokens.
          </p>
        </div>
      )}

      {/* Add a card */}
      <section className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="label">Add a card</h2>
          <button className="text-foil text-xs hover:underline" onClick={() => { setManual(!manual); setPicked(null); setResults([]); }}>
            {manual ? "Back to card search" : "Card not found? Add manually"}
          </button>
        </div>

        {!manual && !picked && (
          <div className="space-y-2">
            <div>
              <label className="label">Condition first</label>
              <div className="flex gap-1 flex-wrap mt-1">
                {CONDITIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={CONDITION_LABELS[c] || c}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      draft.condition === c ? "border-foil text-foil bg-foil/10" : "border-edge text-dim hover:text-body"
                    }`}
                    onClick={() => setDraft({ ...draft, condition: c })}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <p className="text-dim text-xs mt-1">
                {GRADED.includes(draft.condition)
                  ? "Graded card: comp is manual, use the eBay sold link after adding."
                  : "Comp pulls the TCGplayer market price" + (draft.condition !== "NM" ? " with a condition discount" : "") + "."}
              </p>
            </div>
            <input
              className="input"
              placeholder='Search any card - try "Charizard ex" or "Umbreon"'
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {searching && <div className="text-dim text-xs">Searching TCGplayer...</div>}
            <div className="grid gap-1 max-h-80 overflow-y-auto">
              {results.map((c) => (
                <button
                  key={c.id}
                  className="flex items-center gap-3 text-left rounded-lg border border-edge px-3 py-2 hover:border-foil/50"
                  onClick={() => setPicked(c)}
                >
                  {c.image && <img src={c.image} alt="" className="w-8 rounded-sm" loading="lazy" />}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{c.name}</div>
                    <div className="text-dim text-xs truncate">{c.setName} #{c.number} - {c.rarity}</div>
                  </div>
                  <span className="ml-auto num text-sm shrink-0">{c.market !== null ? $(c.market) : ""}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {(picked || manual) && (
          <div className="space-y-3">
            {picked && (
              <div className="flex items-center gap-3 rounded-lg border border-foil/40 bg-foil/5 px-3 py-2">
                {picked.image && <img src={picked.image} alt="" className="w-10 rounded-sm" />}
                <div>
                  <div className="text-sm font-bold">{picked.name}</div>
                  <div className="text-dim text-xs">{picked.setName} #{picked.number} - {picked.rarity}</div>
                </div>
                {picked.market !== null && <span className="ml-auto num text-foil font-bold">{$(picked.market)}</span>}
                <button className="text-bad text-xs hover:underline ml-3" onClick={() => setPicked(null)}>change</button>
              </div>
            )}
            {manual && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="label">Card name</label>
                  <input className="input mt-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div>
                  <label className="label">Set</label>
                  <input className="input mt-1" value={draft.setName} onChange={(e) => setDraft({ ...draft, setName: e.target.value })} />
                </div>
                <div>
                  <label className="label">Card number</label>
                  <input className="input mt-1" value={draft.number} onChange={(e) => setDraft({ ...draft, number: e.target.value })} />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="label">Condition</label>
                <select className="input mt-1" value={draft.condition} onChange={(e) => setDraft({ ...draft, condition: e.target.value })}>
                  {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Qty</label>
                <input type="number" min={1} className="input mt-1" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} />
              </div>
              {isAdmin && (
                <div>
                  <label className="label">Buy price ($)</label>
                  <input type="number" step="0.01" className="input mt-1" value={draft.buyPrice} onChange={(e) => setDraft({ ...draft, buyPrice: e.target.value })} />
                </div>
              )}
              {(manual || GRADED.includes(draft.condition)) && (
                <div>
                  <label className="label">Comp ($)</label>
                  <input type="number" step="0.01" className="input mt-1" placeholder={GRADED.includes(draft.condition) ? "from eBay sold" : ""} value={draft.comp} onChange={(e) => setDraft({ ...draft, comp: e.target.value })} />
                </div>
              )}
              <div className={manual || GRADED.includes(draft.condition) ? "" : "md:col-span-2"}>
                <label className="label">Notes</label>
                <input className="input mt-1" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
              </div>
            </div>
            {picked && draft.condition === "Raw" && (
              <p className="text-dim text-xs">The TCGplayer market price pulls in automatically as the comp.</p>
            )}
            {draft.condition !== "Raw" && (
              <p className="text-dim text-xs">Graded comps are manual: check eBay sold listings and enter the comp above.</p>
            )}
            <div className="flex items-center gap-3">
              <button
                className="btn-foil disabled:opacity-40"
                disabled={busy === "add" || (manual && !draft.name.trim()) || (!manual && !picked)}
                onClick={addCard}
              >
                {busy === "add" ? "Adding..." : "Add to singles inventory"}
              </button>
              {err && <span className="text-bad text-sm">{err}</span>}
            </div>
          </div>
        )}
      </section>

      {/* Inventory table */}
      <section className="card p-5 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="label">Cards</h2>
          <div className="flex gap-1">
            {["In Stock", "In Stream", "Sold", "All"].map((s) => (
              <button
                key={s}
                className={`rounded-lg border px-3 py-1 text-xs font-semibold ${
                  statusFilter === s ? "border-foil text-foil bg-foil/10" : "border-edge text-dim hover:text-body"
                }`}
                onClick={() => setStatusFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <input className="input !w-56" placeholder='Search - try "Umbreon Prismatic"' value={tableQ} onChange={(e) => setTableQ(e.target.value)} />
            <select className="input !w-44" value={setFilter} onChange={(e) => setSetFilter(e.target.value)}>
              <option value="All">All sets</option>
              {setNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <select className="input !w-40" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="newest">Newest first</option>
              <option value="name">Name A-Z</option>
              <option value="price-desc">Price high-low</option>
              <option value="price-asc">Price low-high</option>
            </select>
            <button className="btn-ghost !py-1.5 text-xs" onClick={exportCsv}>Export CSV</button>
            <CollectrImport onDone={load} />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-edge p-3">
            <div className="label">Cards shown</div>
            <div className="num text-lg font-bold">{totals.cards}</div>
          </div>
          {isAdmin && (
            <div className="rounded-lg border border-edge p-3">
              <div className="label">Total spend</div>
              <div className="num text-lg font-bold">{$(totals.spend)}</div>
            </div>
          )}
          <div className="rounded-lg border border-edge p-3">
            <div className="label">Market value</div>
            <div className="num text-lg font-bold text-foil">{$(totals.market)}</div>
          </div>
          {isAdmin && (
            <div className="rounded-lg border border-edge p-3">
              <div className="label">Est. profit</div>
              <div className={`num text-lg font-bold ${totals.profit >= 0 ? "text-win" : "text-bad"}`}>{$(totals.profit)}</div>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th>Card</th><th>Condition</th><th>Qty</th>
                {isAdmin && <th>Buy</th>}
                <th>Comp</th><th>Status</th><th>Sale</th><th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td className="!font-medium">
                    <span className="inline-flex items-center gap-2">
                      {s.image && <img src={s.image} alt="" className="w-7 rounded-sm" loading="lazy" />}
                      <span>
                        {s.name}
                        <span className="block text-dim text-xs font-normal">
                          {s.setName}{s.number ? ` #${s.number}` : ""}{s.rarity ? ` - ${s.rarity}` : ""}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="text-dim text-xs">{s.condition}</td>
                  <td>{s.qty}</td>
                  {isAdmin && (
                    <td>
                      <EditCell value={s.buy ?? null} highlightEmpty onSave={(v) => patch(s.id, { buyPrice: v })} />
                    </td>
                  )}
                  <td>
                    <div className="flex items-center gap-2">
                      {isManager ? (
                        <EditCell value={s.comp} onSave={(v) => patch(s.id, { comp: v })} />
                      ) : (
                        <span className="num">{s.comp !== null ? $(s.comp) : "-"}</span>
                      )}
                      {s.compDetail && <CompSales detail={s.compDetail} condition={s.condition} productId={s.tcgProductId} />}
                      {!s.compDetail && s.comp !== null && s.compSource.includes("est.") && (
                        <span
                          className="text-amber-400 text-xs cursor-help whitespace-nowrap underline decoration-dotted"
                          title={`${s.compSource} - no recent sales in this condition, comp is a discount off NM market. Verify before pricing.`}
                        >
                          est.
                        </span>
                      )}
                    </div>
                    {s.compDate && <div className="text-dim text-[10px]">{s.compSource} {s.compDate}</div>}
                    {s.entryComp !== null && s.entryComp > 0 && s.comp !== null && Math.abs(s.comp - s.entryComp) >= 0.01 && (
                      <div className={`text-[10px] num font-semibold ${s.comp >= s.entryComp ? "text-win" : "text-bad"}`}>
                        {s.comp >= s.entryComp ? "\u25B2" : "\u25BC"} ${Math.abs(s.comp - s.entryComp).toFixed(2)}
                        {" "}({s.comp >= s.entryComp ? "+" : "-"}{Math.abs(((s.comp - s.entryComp) / s.entryComp) * 100).toFixed(1)}%)
                        {" "}since {s.dateAdded || "entry"}
                      </div>
                    )}
                  </td>
                  <td>
                    {s.status === "In Stream" || !isManager ? (
                      <span className={s.status === "Sold" ? "text-win" : s.status === "In Stream" ? "text-foil" : "text-dim"}>
                        {s.status}
                      </span>
                    ) : (
                      <select
                        className={`input !w-28 !py-1 text-xs ${s.status === "Sold" ? "text-win" : ""}`}
                        value={s.status}
                        onChange={(e) => patch(s.id, { status: e.target.value })}
                      >
                        <option value="In Stock">In Stock</option>
                        <option value="Sold">Sold</option>
                      </select>
                    )}
                  </td>
                  <td>
                    {isManager && s.status !== "In Stream" ? (
                      <EditCell
                        value={s.salePrice}
                        onSave={(v) => patch(s.id, { salePrice: v, ...(s.status === "In Stock" ? { status: "Sold" } : {}) })}
                      />
                    ) : (
                      <span className="num">{s.salePrice ? $(s.salePrice) : "-"}</span>
                    )}
                    {s.status === "Sold" && s.soldDate && (
                      <div className="text-dim text-[10px]">{s.soldDate}</div>
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap relative">
                    <button
                      className="text-dim hover:text-body px-2 py-1 rounded hover:bg-edge/60"
                      onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}
                      aria-label="Row actions"
                    >
                      {"\u22EF"}
                    </button>
                    {menuFor === s.id && (
                      <div className="absolute right-2 top-9 z-20 w-44 rounded-lg border border-edge bg-panel shadow-2xl py-1 text-left">
                        {["Raw", "NM", "LP", "MP", "HP", "DM"].includes(s.condition) && s.cardId && (
                          <button
                            className="block w-full text-left px-3 py-1.5 text-sm text-body hover:bg-edge/50 disabled:opacity-40"
                            disabled={busy === s.id}
                            onClick={() => { setMenuFor(null); refreshComp(s.id); }}
                          >
                            {busy === s.id ? "Refreshing..." : "Refresh comp"}
                          </button>
                        )}
                        <a
                          className="block px-3 py-1.5 text-sm text-body hover:bg-edge/50"
                          target="_blank" rel="noreferrer" href={ebayLink(s)}
                          onClick={() => setMenuFor(null)}
                        >
                          eBay solds {"\u2197"}
                        </a>
                        {isAdmin && s.status !== "In Stream" && (
                          <button
                            className="block w-full text-left px-3 py-1.5 text-sm text-bad hover:bg-bad/10"
                            onClick={() => { setMenuFor(null); remove(s.id); }}
                          >
                            Delete card
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={isAdmin ? 8 : 7} className="text-dim">No cards here yet - add one above</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-dim text-xs">
          Cards get pulled onto a Single Stream from the stream editor. When a sale price is entered there,
          the card flips to Sold here automatically. Removing it from the stream puts it back In Stock.
        </p>
      </section>
    </main>
  );
}
