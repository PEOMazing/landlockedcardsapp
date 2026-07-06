"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export type PickerItem = {
  id: string;
  name: string;
  category?: string;
  marketPrice?: number;
  qtyOnHand?: number;
};

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
    setSelected(item);
    setQ(item.name);
    setOpen(false);
  }

  function submit() {
    if (!selected || qty < 1) return;
    onAdd(selected, qty);
    setSelected(null);
    setQ("");
    setQty(1);
  }

  return (
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
              else submit();
            }
            if (e.key === "Escape") setOpen(false);
          }}
        />
        {open && filtered.length > 0 && (
          <div className="absolute z-30 mt-1 w-full card overflow-hidden shadow-2xl">
            {filtered.map((i, idx) => (
              <button
                key={i.id}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 ${
                  idx === hi ? "bg-foil/15" : "hover:bg-edge/40"
                }`}
                onMouseEnter={() => setHi(idx)}
                onClick={() => choose(i)}
              >
                <span>
                  {i.name}
                  {i.category && <span className="text-dim text-xs ml-2">{i.category}</span>}
                </span>
                <span className="text-dim text-xs num whitespace-nowrap">
                  {typeof i.marketPrice === "number" && `$${i.marketPrice.toFixed(2)}`}
                  {typeof i.qtyOnHand === "number" && ` - ${i.qtyOnHand} on hand`}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        type="number"
        min={1}
        className="input sm:w-24"
        value={qty}
        onChange={(e) => setQty(parseInt(e.target.value) || 1)}
        aria-label="Quantity"
      />
      <button className="btn-foil disabled:opacity-40" disabled={!selected || busy} onClick={submit}>
        Add to show
      </button>
    </div>
  );
}
