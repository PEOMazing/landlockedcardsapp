"use client";
import { useMemo, useState } from "react";

// The return list: which single cards are physically going back in the binder.
//
// Closing a show used to be one button that put every unhit card back in stock.
// That is right when the whole wheel comes apart and the cards go back in
// sleeves, and wrong whenever a stack of them is staying out for tomorrow
// night. Putting those back and picking them again is the same forty clicks
// that built the set, and worse, the count is wrong in between: the app says
// they are on the shelf while they are sitting in a pile on the desk.
//
// So the cards get tick boxes. Ticked goes back in stock. Un-ticked stays out,
// still attached to this show, and rollover moves it onto the next set without
// ever touching the shelf.
//
// Sealed product is deliberately not on this list. A pack is interchangeable in
// a way a card is not: nobody needs to know which of the eighteen identical
// packs came back, only how many. Holding one would take units off both the
// shelf and the show at the same time and drop them out of the owned total,
// which is the exact bug the on hand / on shows split exists to prevent.

export type ReturnCard = {
  id: string;
  name: string;
  qty: number;
  qtyHit: number;
  market: number;
  image?: string;
  slot?: number | null;
  holdOut?: boolean;
};

const $ = (n: number) =>
  "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ReturnSingles({
  cards,
  hold,
  onChange,
}: {
  cards: ReturnCard[];
  hold: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);

  // Only cards that are actually coming back are a decision. A hit card is
  // gone, so asking whether to shelve it is a question with no answer.
  const coming = useMemo(
    () =>
      cards
        .filter((c) => Math.max(c.qty - c.qtyHit, 0) > 0)
        .sort((a, b) => (a.slot ?? 1e9) - (b.slot ?? 1e9) || b.market - a.market),
    [cards],
  );

  if (coming.length === 0) return null;

  const held = coming.filter((c) => hold.has(c.id));
  const back = coming.length - held.length;
  const heldValue = held.reduce((a, c) => a + c.market * Math.max(c.qty - c.qtyHit, 0), 0);

  const set = (next: Set<string>) => onChange(new Set(next));
  const toggle = (id: string) => {
    const n = new Set(hold);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    set(n);
  };

  return (
    <div className="w-full rounded-lg border border-edge mt-2">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-foil/5 transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="text-dim text-xs">{open ? "▾" : "▸"}</span>
        <span className="label">Cards going back in the binder</span>
        <span className="num text-sm font-semibold ml-auto">
          <span className="text-win">{back}</span>
          <span className="text-dim"> of {coming.length}</span>
        </span>
        {held.length > 0 && (
          <span className="text-givvy text-xs whitespace-nowrap">
            {held.length} staying out ({$(heldValue)})
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-edge p-3 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-dim text-xs">
              Ticked goes back in stock. Un-ticked stays out of stock for an upcoming show, ready to
              roll straight onto the next set.
            </span>
            <span className="ml-auto flex gap-2">
              <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => set(new Set())}>
                All back
              </button>
              <button
                type="button"
                className="btn-ghost !py-1 text-xs"
                onClick={() => set(new Set(coming.map((c) => c.id)))}
              >
                All stay out
              </button>
            </span>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-edge">
            {coming.map((c) => {
              const out = hold.has(c.id);
              const left = Math.max(c.qty - c.qtyHit, 0);
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-3 py-2 cursor-pointer transition-colors ${
                    out ? "opacity-60" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!out}
                    onChange={() => toggle(c.id)}
                    title={out ? "Staying out for the next show" : "Going back in stock"}
                  />
                  {c.image && (
                    <img src={c.image} alt="" className="h-8 w-6 object-contain shrink-0" loading="lazy" />
                  )}
                  {c.slot ? (
                    <span className="num text-xs font-semibold text-foil w-12 shrink-0">
                      Slot {c.slot}
                    </span>
                  ) : (
                    <span className="w-12 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {c.name}
                    {left > 1 && <span className="text-dim num"> x{left}</span>}
                  </span>
                  <span className="num text-xs shrink-0">{$(c.market)}</span>
                  <span
                    className={`text-[10px] uppercase tracking-wide w-20 text-right shrink-0 ${
                      out ? "text-givvy" : "text-win"
                    }`}
                  >
                    {out ? "stays out" : "back"}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
