"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import Thumb from "@/components/Thumb";

export type PickerItem = {
  id: string;
  name: string;
  category?: string;
  marketPrice?: number;
  qtyOnHand?: number;
  imageUrl?: string;
};

// Mirrors the server-side stock floor in lib/stock.ts. This is convenience -
// /api/lines and friends reject an over-deduction regardless of what the
// picker allows.
function outOfStock(i: PickerItem): boolean {
  return (i.qtyOnHand ?? 0) <= 0;
}

export default function ProductPicker({
  onAdd,
  busy,
}: {
  onAdd: (item: PickerItem, qty: number) => void;
  busy?: boolean;
}) {
  const [items, setItems] = useState<PickerItem[]>([]);
  const [q, setQ] = useState("");
  const [qty, setQty] = useState(1);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [selected, setSelected] = useState<PickerItem | null>(null);
  const [pickMsg, setPickMsg] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addErr, setAddErr] = useState("");
  const [draft, setDraft] = useState({ name: "", category: "Other", marketPrice: "", qtyOnHand: "" });
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/inventory")
      .then((r) => r.json())
      .then((d) => setItems(d.items || []));
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items.slice(0, 12);
    return items
      .filter(
        (i) =>
          i.name.toLowerCase().includes(needle) ||
          (i.category || "").toLowerCase().includes(needle)
      )
      .slice(0, 12);
  }, [items, q]);

  function choose(item: PickerItem) {
    if (outOfStock(item)) {
      setPickMsg(`${item.name} is out of stock - receive stock on the Inventory tab first.`);
      return;
    }
    setSelected(item);
    setQ(item.name);
    setQty((n) => Math.min(Math.max(1, n), item.qtyOnHand ?? 1));
    setPickMsg("");
    setOpen(false);
  }

  function submit() {
    if (!selected) {
      setPickMsg(
        q.trim()
          ? `"${q.trim()}" is typed but not selected - click it in the dropdown first, then Add.`
          : "Search for a product and pick it from the dropdown first."
      );
      return;
    }
    if (qty < 1) return;
    const cap = selected.qtyOnHand ?? 0;
    if (qty > cap) {
      setPickMsg(`Only ${cap} of ${selected.name} on hand.`);
      return;
    }
    setPickMsg("");
    onAdd(selected, qty);
    setSelected(null);
    setQ("");
    setQty(1);
  }

  function startQuickAdd() {
    setDraft({ name: q.trim(), category: "Other", marketPrice: "", qtyOnHand: "" });
    setAddErr("");
    setAdding(true);
    setOpen(false);
  }

  async function saveQuickAdd() {
    const name = draft.name.trim();
    if (!name || saving) return;
    setSaving(true);
    setAddErr("");
    try {
      const res = await fetch("/api/inventory/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category: draft.category,
          marketPrice: parseFloat(draft.marketPrice) || 0,
          qtyOnHand: parseInt(draft.qtyOnHand) || 0,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.item) throw new Error(d.error || "Could not add product");
      setItems((prev) =>
        prev.some((p) => p.id === d.item.id) ? prev : [...prev, d.item].sort((a, b) => a.name.localeCompare(b.name))
      );
      setAdding(false);
      if (outOfStock(d.item)) {
        setQ(d.item.name);
        setSelected(null);
        setPickMsg(`${d.item.name} was created with 0 on hand - set a quantity on it before adding it to the show set.`);
      } else {
        choose(d.item);
      }
    } catch (e: any) {
      setAddErr(e.message || "Could not add product");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col sm:flex-row gap-2 items-stretch">
        <div className="relative flex-1" ref={boxRef}>
          <input
            className="input"
            placeholder='Search inventory - try "ETB" or "151"'
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSelected(null);
              setOpen(true);
              setHi(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              if (e.key === "Enter") {
                e.preventDefault();
                if (open && filtered[hi]) choose(filtered[hi]);
                else if (open && q.trim() && filtered.length === 0) startQuickAdd();
                else submit();
              }
              if (e.key === "Escape") setOpen(false);
            }}
          />
          {open && (filtered.length > 0 || q.trim().length > 0) && (
            <div className="absolute z-30 mt-1 w-full card overflow-hidden shadow-2xl">
              {filtered.map((i, idx) => {
                // Out-of-stock products stay in the list so a search still finds
                // them - they just cannot be picked.
                const out = outOfStock(i);
                return (
                  <button
                    key={i.id}
                    type="button"
                    disabled={out}
                    aria-disabled={out}
                    title={out ? `${i.name} is out of stock` : undefined}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 ${
                      out ? "opacity-40 cursor-not-allowed" : idx === hi ? "bg-foil/15" : "hover:bg-edge/40"
                    }`}
                    onMouseEnter={() => setHi(idx)}
                    onClick={() => choose(i)}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {i.imageUrl && <Thumb src={i.imageUrl} size={28} className="shrink-0" />}
                      <span className="truncate">
                        {i.name}
                        {i.category && <span className="text-dim text-xs ml-2">{i.category}</span>}
                      </span>
                    </span>
                    {out ? (
                      <span className="text-bad text-xs uppercase tracking-wide whitespace-nowrap">out of stock</span>
                    ) : (
                      <span className="text-dim text-xs num whitespace-nowrap">
                        {typeof i.marketPrice === "number" && `$${i.marketPrice.toFixed(2)}`}
                        {typeof i.qtyOnHand === "number" && ` - ${i.qtyOnHand} on hand`}
                      </span>
                    )}
                  </button>
                );
              })}
              {q.trim().length > 0 &&
                !items.some((i) => i.name.toLowerCase() === q.trim().toLowerCase()) && (
                <button
                  className="w-full text-left px-3 py-2 text-sm text-foil hover:bg-edge/40 border-t border-edge"
                  onClick={startQuickAdd}
                >
                  + Add &quot;{q.trim()}&quot; as a new product
                </button>
              )}
            </div>
          )}
        </div>
        <input
          type="number"
          min={1}
          max={selected?.qtyOnHand ?? undefined}
          className="input sm:w-24"
          value={qty}
          onChange={(e) => {
            const n = Math.max(1, parseInt(e.target.value) || 1);
            setQty(selected ? Math.min(n, selected.qtyOnHand ?? 1) : n);
          }}
          aria-label="Quantity"
        />
        <button className="btn-foil disabled:opacity-40" disabled={busy} onClick={submit}>
          Add this product
        </button>
      </div>
      {selected && (
        <p className="text-dim text-xs">
          {selected.name} - {selected.qtyOnHand} on hand, so {selected.qtyOnHand} is the most you can add.
        </p>
      )}
      {pickMsg && <p className="text-bad text-xs">{pickMsg}</p>}

      {adding && (
        <div className="card p-3 flex flex-col gap-2">
          <div className="text-sm font-medium">New product</div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            <input
              className="input sm:col-span-2"
              placeholder="Product name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              autoFocus
            />
            <select
              className="input"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            >
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input
              type="number"
              step="0.01"
              min={0}
              className="input"
              placeholder="Market price (optional)"
              value={draft.marketPrice}
              onChange={(e) => setDraft({ ...draft, marketPrice: e.target.value })}
            />
            <input
              type="number"
              min={0}
              className="input"
              placeholder="On hand"
              aria-label="On hand"
              value={draft.qtyOnHand}
              onChange={(e) => setDraft({ ...draft, qtyOnHand: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-foil disabled:opacity-40" disabled={!draft.name.trim() || saving} onClick={saveQuickAdd}>
              {saving ? "Saving..." : "Save product"}
            </button>
            <button className="text-dim text-sm hover:text-body" onClick={() => setAdding(false)}>Cancel</button>
            {addErr && <span className="text-bad text-sm">{addErr}</span>}
          </div>
          <div className="text-dim text-xs">
            Saved without a buy price - admin fills that in on the Inventory tab. P&amp;L for this stream updates automatically once they do.
            Leave On hand blank only if the stock is not in yet - a product at 0 on hand cannot be added to the set.
          </div>
        </div>
      )}
    </div>
  );
}
