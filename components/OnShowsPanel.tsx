"use client";
import { useEffect, useMemo } from "react";
import Link from "next/link";

// What is holding your stock.
//
// "Out on shows: 35" is a true number that you cannot act on. The question it
// provokes is always the next one: which shows, and when do I get them back.
// Before this you answered that by opening every open show and reading its set,
// which is the same manual reconciliation the on-hand / on-shows split was
// built to end.
//
// Two ways in, one panel. The header tile opens everything committed, grouped
// by show, because at that level the useful unit is "this show is holding 20
// things". A product row opens just that product, which is a short list of
// shows. Same data, grouped by whichever one you clicked.

export type Hold = { streamId: string; title: string; date: string; qty: number };
export type HeldProduct = { id: string; name: string; market: number; holds: Hold[] };

const $ = (n: number) =>
  "$" + Math.round(n || 0).toLocaleString("en-US");

// "Oct 3" rather than a full date. These are all within a few weeks, the year
// is noise, and the column has to survive a phone.
function shortDate(iso: string): string {
  if (!iso) return "no date";
  const d = new Date(iso + (iso.length === 10 ? "T12:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function OnShowsPanel({
  title,
  products,
  onClose,
}: {
  title: string;
  /** Products with at least one open hold. Empty means nothing is out. */
  products: HeldProduct[];
  onClose: () => void;
}) {
  // Escape closes. A panel that can only be dismissed by finding the right
  // pixel is a panel people stop opening.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Grouped by show, because at every level above a single product that is the
  // actionable unit: closing one show puts all of its rows back at once.
  const byShow = useMemo(() => {
    const shows = new Map<string, { title: string; date: string; items: { name: string; qty: number; market: number }[] }>();
    for (const p of products) {
      for (const h of p.holds) {
        let s = shows.get(h.streamId);
        if (!s) shows.set(h.streamId, (s = { title: h.title, date: h.date, items: [] }));
        s.items.push({ name: p.name, qty: h.qty, market: p.market });
      }
    }
    return [...shows.entries()]
      .map(([streamId, s]) => ({
        streamId,
        ...s,
        units: s.items.reduce((a, i) => a + i.qty, 0),
        value: s.items.reduce((a, i) => a + i.qty * (i.market || 0), 0),
        items: s.items.sort((a, b) => b.qty * (b.market || 0) - a.qty * (a.market || 0)),
      }))
      .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.title.localeCompare(b.title));
  }, [products]);

  const units = byShow.reduce((a, s) => a + s.units, 0);
  const value = byShow.reduce((a, s) => a + s.value, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      {/* A dark scrim is correct on either canvas: it is the absence of the
          page, not a surface of it. */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-full sm:max-w-2xl max-h-[85vh] overflow-y-auto card lifted rounded-t-xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-panel border-b border-edge px-s4 py-s3 flex items-baseline gap-s3">
          <h2 className="t-section">{title}</h2>
          <span className="t-meta text-dim num ml-auto whitespace-nowrap">
            {units} unit{units === 1 ? "" : "s"} - {$(value)} at market
          </span>
          <button type="button" onClick={onClose} className="text-dim hover:text-body px-s1" aria-label="Close">
            {"✕"}
          </button>
        </div>

        {byShow.length === 0 ? (
          <p className="p-s4 text-dim t-body">Nothing is out on a show right now.</p>
        ) : (
          <div className="divide-y divide-edge">
            {byShow.map((s) => (
              <div key={s.streamId} className="p-s4 space-y-s2">
                <div className="flex items-baseline gap-s3 flex-wrap">
                  <Link href={`/streams/${s.streamId}`} className="t-body font-semibold text-foil hover:underline">
                    {s.title}
                  </Link>
                  <span className="t-meta text-dim num">{shortDate(s.date)}</span>
                  <span className="t-meta text-dim num ml-auto whitespace-nowrap">
                    {s.units} unit{s.units === 1 ? "" : "s"} - {$(s.value)}
                  </span>
                </div>
                <div className="space-y-s1">
                  {s.items.map((i, k) => (
                    <div key={k} className="flex items-baseline gap-s3 t-secondary">
                      <span className="num text-foil w-8 shrink-0">{i.qty}x</span>
                      <span className="min-w-0 flex-1 truncate">{i.name}</span>
                      <span className="num text-dim whitespace-nowrap">{$(i.qty * (i.market || 0))}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="px-s4 pb-s4 pt-s2 t-meta text-dim">
          These units are still owned. They come back on the shelf when the show is closed out and its
          unhit items are returned.
        </p>
      </div>
    </div>
  );
}
