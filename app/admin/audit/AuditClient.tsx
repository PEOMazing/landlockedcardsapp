"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  streamReport, productHistory, shelfGap,
  type AuditLine, type AuditSingle, type AuditStream, type HitRow,
} from "@/lib/audit";
import { readWhatnotCsv, splitGiveaways, checkAgainstSet, showsIn, suggestShow, localDate, type CheckRow, type Product } from "@/lib/whatnotCsv";

export type AuditProduct = { id: string; name: string; aliases: string[]; onHand: number; active: boolean };
type Stream = AuditStream & { giveaways: number; singlesGiveaways: number };

const $ = (n: number) => "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad4 = (n: number) => String(n).padStart(4, "0");
const niceDate = (d: string) => {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, (m || 1) - 1, day || 1).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`num text-2xl font-bold mt-1 ${tone || ""}`}>{value}</div>
      {sub && <div className="text-dim text-xs mt-1">{sub}</div>}
    </div>
  );
}

const KIND: Record<HitRow["kind"], string> = { sealed: "Sealed", single: "Single", store: "Store sale", giveaway: "Giveaway" };

export default function AuditClient({
  streams, lines, products, singles, initialStream, initialProduct,
}: {
  streams: Stream[];
  lines: AuditLine[];
  products: AuditProduct[];
  singles: Record<string, AuditSingle>;
  initialStream: string;
  initialProduct: string;
}) {
  const [tab, setTab] = useState<"stream" | "product">(initialProduct ? "product" : "stream");
  const [streamId, setStreamId] = useState(initialStream || streams[0]?.id || "");

  // keep the address bar in step, so a report can be bookmarked or sent
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.delete("stream"); u.searchParams.delete("product");
    if (tab === "stream" && streamId) u.searchParams.set("stream", streamId);
    window.history.replaceState(null, "", u.toString());
  }, [tab, streamId]);

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between flex-wrap gap-3 print:hidden">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Audit</h1>
        <div className="inline-flex rounded-lg border border-edge overflow-hidden text-sm">
          {([["stream", "Stream report"], ["product", "Product history"]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
              className={`px-3 py-1.5 ${tab === k ? "bg-foil/15 text-foil font-semibold" : "text-dim hover:text-body"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "stream" ? (
        <StreamTab streams={streams} lines={lines} products={products} singles={singles} streamId={streamId} setStreamId={setStreamId} />
      ) : (
        <ProductTab streams={streams} lines={lines} products={products} initialProduct={initialProduct}
          openStream={(id) => { setStreamId(id); setTab("stream"); window.scrollTo(0, 0); }} />
      )}

      {/* Print just the report, not the app around it. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #audit-print, #audit-print * { visibility: visible !important; }
          #audit-print { position: absolute; left: 0; top: 0; width: 100%; color: #000; }
          #audit-print .card { border: 1px solid #ccc; background: #fff; box-shadow: none; }
          #audit-print .text-dim { color: #555 !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------- stream

function StreamTab({
  streams, lines, products, singles, streamId, setStreamId,
}: {
  streams: Stream[]; lines: AuditLine[]; products: AuditProduct[]; singles: Record<string, AuditSingle>;
  streamId: string; setStreamId: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [showBack, setShowBack] = useState(false);
  const stream = streams.find((s) => s.id === streamId);
  const streamLines = useMemo(() => lines.filter((l) => l.streamId === streamId), [lines, streamId]);
  const report = useMemo(() => streamReport(streamLines, singles), [streamLines, singles]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f
      ? streams.filter((s) => `${s.date} ${niceDate(s.date)} ${s.title} ${s.streamer}`.toLowerCase().includes(f))
      : streams;
    // the selected stream always stays in the list, even when filtered out
    return stream && !list.includes(stream) ? [stream, ...list] : list;
  }, [streams, filter, stream]);

  const t = report.totals;

  return (
    <div className="space-y-5">
      <div className="card p-4 flex flex-wrap items-end gap-3 print:hidden">
        <label className="flex-1 min-w-[200px]">
          <span className="label">Find a stream</span>
          <input className="input mt-1" placeholder="Date, title or streamer" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        <label className="flex-[2] min-w-[260px]">
          <span className="label">Stream</span>
          <select className="input mt-1" value={streamId} onChange={(e) => setStreamId(e.target.value)}>
            {shown.map((s) => (
              <option key={s.id} value={s.id}>
                {niceDate(s.date)} - {s.title || "Untitled"}{s.streamer ? ` (${s.streamer})` : ""} - {s.status}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-ghost" onClick={() => window.print()} disabled={!stream}>Print report</button>
      </div>

      {!stream ? (
        <div className="card p-6 text-dim text-center">No streams yet.</div>
      ) : (
        <div id="audit-print" className="space-y-5">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-bold">{stream.title || "Untitled stream"}</h2>
              <div className="text-dim text-sm">
                {niceDate(stream.date)} - {stream.streamer || "No streamer"} - {stream.type} - {stream.status}
                {stream.returned ? " - items returned" : ""}
              </div>
            </div>
            <Link href={`/streams/${stream.id}`} className="text-foil text-sm hover:underline no-print">Open stream</Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Items hit" value={String(t.itemsHit)} sub={`${t.sealedHit} sealed - ${t.singlesHit} singles`} />
            <Tile label="Hit value" value={$(t.hitValue)} sub="at market on the set, store sales at sold price" tone="text-foil" />
            <Tile label="Cost of hits" value={$(t.hitCost)} sub="what was paid for what went out" />
            <Tile label="Came back" value={String(t.notHit)} sub={`of ${t.onSet} on the set${t.storeCount ? ` - ${t.storeCount} store sales` : ""}`} />
          </div>

          <section className="card overflow-x-auto">
            <div className="px-4 pt-4 pb-2 label">Everything hit</div>
            {report.hits.length === 0 ? (
              <div className="px-4 pb-4 text-dim text-sm">
                Nothing recorded as hit on this stream yet.
                {stream.status !== "Complete" && " It has not been closed out, so hits may not have been entered. Upload the Whatnot export below to see what actually sold."}
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr><th>Item</th><th>Type</th><th>Sticker</th><th>On set</th><th>Hit</th><th>Market ea</th><th>Hit value</th><th>Cost</th></tr>
                </thead>
                <tbody>
                  {report.hits.map((h) => (
                    <tr key={h.lineId}>
                      <td className="!font-medium">{h.name}{h.set ? <span className="text-dim text-xs"> - {h.set}</span> : null}</td>
                      <td className="text-dim text-xs">{KIND[h.kind]}</td>
                      <td className="num">{h.sticker !== null ? pad4(h.sticker) : ""}</td>
                      <td className="num">{h.kind === "store" ? "" : h.qty}</td>
                      <td className="num font-semibold">{h.hit}</td>
                      <td className="num">{$(h.market)}</td>
                      <td className="num">{$(h.hitValue)}</td>
                      <td className="num text-dim">{h.hitCost ? $(h.hitCost) : ""}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td colSpan={4}>Total</td>
                    <td className="num">{t.itemsHit}</td>
                    <td />
                    <td className="num">{$(t.hitValue)}</td>
                    <td className="num">{$(t.hitCost)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </section>

          {report.notHit.length > 0 && (
            <section className="card overflow-x-auto">
              <button type="button" className="w-full text-left px-4 py-3 label flex justify-between no-print" onClick={() => setShowBack((v) => !v)}>
                <span>On the set but not hit ({t.notHit})</span>
                <span className="text-dim">{showBack ? "Hide" : "Show"}</span>
              </button>
              {showBack && (
                <table className="w-full">
                  <thead><tr><th>Item</th><th>Type</th><th>On set</th><th>Not hit</th><th>Market ea</th></tr></thead>
                  <tbody>
                    {report.notHit.map((h) => (
                      <tr key={h.lineId}>
                        <td>{h.name}</td>
                        <td className="text-dim text-xs">{KIND[h.kind]}</td>
                        <td className="num">{h.qty}</td>
                        <td className="num">{h.back}</td>
                        <td className="num">{$(h.market)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}

          <WhatnotCheck key={stream.id} stream={stream} streamLines={streamLines} products={products} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- whatnot

const STATUS: Record<CheckRow["status"], { label: string; cls: string }> = {
  "not-on-set": { label: "Not on the set", cls: "text-bad border-bad/40 bg-bad/5" },
  "count-off": { label: "Count differs", cls: "text-amber-400 border-amber-400/40 bg-amber-400/5" },
  "no-match": { label: "No product match", cls: "text-dim border-edge" },
  ok: { label: "Matches", cls: "text-win border-win/40 bg-win/5" },
};

function WhatnotCheck({ stream, streamLines, products }: { stream: Stream; streamLines: AuditLine[]; products: AuditProduct[] }) {
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [showOk, setShowOk] = useState(false);
  const [showPick, setShowPick] = useState<string | null>(null);

  const catalog: Product[] = useMemo(
    () => products.flatMap((p) => [{ id: p.id, name: p.name }, ...p.aliases.map((a) => ({ id: p.id, name: a }))]),
    [products]
  );
  const nameOf = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])), [products]);

  const setByProduct = useMemo(() => {
    const m: Record<string, { onSet: number; hit: number }> = {};
    for (const l of streamLines) {
      if (!l.productId || l.store) continue;
      const cur = m[l.productId] || { onSet: 0, hit: 0 };
      cur.onSet += l.qty || 0;
      cur.hit += l.hit || 0;
      m[l.productId] = cur;
    }
    return m;
  }, [streamLines]);

  const parsed = useMemo(() => (text ? readWhatnotCsv(text) : null), [text]);
  // The weekly earnings report covers every show that week. Pick the one that
  // goes with this stream: same day, and the streamer's name in the title.
  const shows = useMemo(() => (parsed && !parsed.error ? showsIn(parsed.sales) : []), [parsed]);
  const guess = useMemo(() => suggestShow(shows, stream), [shows, stream]);
  const showId = shows.length > 1 ? showPick ?? guess : shows[0]?.id ?? "";

  const result = useMemo(() => {
    if (!parsed) return null;
    if (parsed.error) return { error: parsed.error } as const;
    const sales = shows.length > 1 ? parsed.sales.filter((s) => s.showId === showId) : parsed.sales;
    const g = splitGiveaways(sales);
    const check = checkAgainstSet(g.paid, catalog, setByProduct);
    return { error: null, parsed, g, check } as const;
  }, [parsed, shows, showId, catalog, setByProduct]);

  function onFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    setShowPick(null);
    const r = new FileReader();
    r.onload = () => setText(String(r.result || ""));
    r.readAsText(f);
  }

  return (
    <section className="card p-4 space-y-4 no-print">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="label">Check against the Whatnot export</div>
          <p className="text-dim text-xs mt-1 max-w-xl">
            Export this show&apos;s sales from Whatnot and drop the CSV here. Anything that sold but was never put on
            this set gets flagged. The file is read on this computer only and is not uploaded or saved.
          </p>
        </div>
        <label className="btn-ghost cursor-pointer">
          {fileName ? "Choose another file" : "Choose CSV"}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>

      {result?.error && <div className="text-bad text-sm">{result.error}</div>}

      {result && !result.error && (
        <>
          <div className="text-dim text-xs">{fileName}</div>
          {shows.length > 1 && (
            <label className="block">
              <span className="label">This file has {shows.length} shows. Which one is this stream?</span>
              <select className="input mt-1" value={showId} onChange={(e) => setShowPick(e.target.value)}>
                {!showId && <option value="">Pick a show</option>}
                {shows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {localDate(s.start)} - {s.title || "Untitled show"} ({s.orders} orders){s.id === guess ? " - best match" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Paid orders" value={String(result.g.paid.reduce((a, s) => a + s.qty, 0))} sub={`${$(result.g.gross)} before fees${result.parsed.skipped ? ` - ${result.parsed.skipped} cancelled or failed skipped` : ""}`} />
            <Tile label="Not on the set" value={String(result.check.counts["not-on-set"])}
              tone={result.check.counts["not-on-set"] ? "text-bad" : "text-win"} sub="products sold that were never added" />
            <Tile label="Free packs" value={String(result.g.freePacks)} sub={`stream records ${stream.giveaways} giveaways`}
              tone={result.g.freePacks !== stream.giveaways ? "text-amber-400" : ""} />
            <Tile label="Free singles" value={String(result.g.freeSingles)} sub={`stream records ${stream.singlesGiveaways} singles giveaways`}
              tone={result.g.freeSingles !== stream.singlesGiveaways ? "text-amber-400" : ""} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr><th>Status</th><th>Product</th><th>Sold on Whatnot</th><th>On the set</th><th>Hit recorded</th><th>Sales</th></tr>
              </thead>
              <tbody>
                {result.check.rows.filter((r) => showOk || r.status !== "ok").map((r) => (
                  <tr key={r.key}>
                    <td>
                      <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS[r.status].cls}`}>
                        {STATUS[r.status].label}
                      </span>
                    </td>
                    <td>
                      <div className="!font-medium">{r.product ? nameOf[r.product.id] || r.product.name : r.titles[0]}</div>
                      {r.product && <div className="text-dim text-[11px] truncate max-w-md">{r.titles[0]}</div>}
                      {!r.product && r.titles.length > 1 && <div className="text-dim text-[11px]">+{r.titles.length - 1} similar listings</div>}
                    </td>
                    <td className="num font-semibold">{r.sold}</td>
                    <td className="num">{r.product ? r.onSet : ""}</td>
                    <td className="num">{r.product && r.onSet ? r.hitOnSet : ""}</td>
                    <td className="num">{$(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.check.counts.ok > 0 && (
            <button type="button" className="text-dim text-xs underline underline-offset-2" onClick={() => setShowOk((v) => !v)}>
              {showOk ? "Hide" : "Show"} {result.check.counts.ok} that match
            </button>
          )}
          {result.check.counts["count-off"] > 0 && stream.status !== "Complete" && (
            <p className="text-dim text-xs">
              &quot;Count differs&quot; compares Whatnot sales to the hits entered in the app. This stream has not been closed
              out, so the hits may simply not be entered yet.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- product

type Extra = {
  onHand: number;
  lots: { date: string; qty: number; unitCost: number; source: string }[];
  changes: { date: string; source: string; delta: number; qtyNow: number }[];
};

function ProductTab({
  streams, lines, products, initialProduct, openStream,
}: {
  streams: Stream[]; lines: AuditLine[]; products: AuditProduct[]; initialProduct: string; openStream: (id: string) => void;
}) {
  const [q, setQ] = useState(() => products.find((p) => p.id === initialProduct)?.name || "");
  const [counted, setCounted] = useState("");
  const [extra, setExtra] = useState<Extra | null>(null);

  // An exact product name (picked from the list) searches by record, which
  // also catches the product under names it used to have. Anything else is a
  // word search across every set.
  const picked = useMemo(() => {
    const t = q.trim().toLowerCase();
    return products.find((p) => p.name.toLowerCase() === t) || null;
  }, [q, products]);

  const byId = useMemo(() => Object.fromEntries(streams.map((s) => [s.id, s])), [streams]);
  const hist = useMemo(
    () => (q.trim().length >= 2 ? productHistory(lines, byId, picked?.id || "", picked ? "" : q) : null),
    [lines, byId, picked, q]
  );

  useEffect(() => {
    setExtra(null);
    setCounted("");
    if (!picked) return;
    let dead = false;
    fetch(`/api/audit/product?id=${picked.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!dead && d) setExtra(d); })
      .catch(() => {});
    return () => { dead = true; };
  }, [picked]);

  const onHand = extra?.onHand ?? picked?.onHand ?? 0;
  const gap = shelfGap(onHand, counted.trim() === "" ? null : Number(counted));
  const sorted = useMemo(() => [...products].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)), [products]);

  return (
    <div className="space-y-5">
      <div className="card p-4 space-y-2">
        <label className="block">
          <span className="label">Product</span>
          <input className="input mt-1 !text-base" list="audit-products" placeholder="Start typing, e.g. Darkness Ablaze"
            value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <datalist id="audit-products">
            {sorted.map((p) => <option key={p.id} value={p.name} />)}
          </datalist>
        </label>
        <p className="text-dim text-xs">
          Pick a product from the list to follow that exact item, or type words to search every set.
          A show where it sold but is missing from this list is a show it was never added to.
        </p>
      </div>

      {picked && (
        <div className="grid md:grid-cols-3 gap-3">
          <Tile label="App says on hand" value={String(Math.max(0, onHand))} sub={picked.name} />
          <div className="card p-4">
            <div className="label">Shelf count</div>
            <input className="input mt-1 num" inputMode="numeric" placeholder="What is actually on the shelf?"
              value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^0-9]/g, ""))} />
            <div className="text-dim text-xs mt-1">Count it and type the number to check.</div>
          </div>
          <Tile
            label="Difference"
            value={gap === null ? "-" : gap === 0 ? "Matches" : gap > 0 ? `${gap} missing` : `${-gap} extra`}
            tone={gap === null ? "" : gap === 0 ? "text-win" : gap > 0 ? "text-bad" : "text-amber-400"}
            sub={gap && gap > 0 ? "left without being on a set or a store sale" : gap && gap < 0 ? "more on the shelf than the app knows about" : undefined}
          />
        </div>
      )}

      {hist && (
        <section className="card overflow-x-auto">
          <div className="px-4 pt-4 pb-2 flex items-baseline justify-between flex-wrap gap-2">
            <span className="label">Every stream it was on</span>
            <span className="text-dim text-xs num">
              {hist.totals.streams} streams - {hist.totals.onSet} put on - {hist.totals.hit} hit - {hist.totals.back} came back
              {hist.totals.storeSold ? ` - ${hist.totals.storeSold} store sales` : ""}
            </span>
          </div>
          {hist.rows.length === 0 ? (
            <div className="px-4 pb-4 text-dim text-sm">Not on any stream&apos;s set.</div>
          ) : (
            <table className="w-full">
              <thead><tr><th>Date</th><th>Stream</th><th>Streamer</th><th>Status</th><th>Put on</th><th>Hit</th><th>Came back</th><th>Store</th><th /></tr></thead>
              <tbody>
                {hist.rows.map((r) => (
                  <tr key={r.streamId}>
                    <td className="whitespace-nowrap">{niceDate(r.date)}</td>
                    <td>
                      <div className="!font-medium">{r.title || "Untitled"}</div>
                      {!picked && <div className="text-dim text-[11px]">{r.names.join(", ")}</div>}
                    </td>
                    <td>{r.streamer}</td>
                    <td className="text-dim text-xs">{r.status}{r.returned ? ", returned" : ""}</td>
                    <td className="num">{r.onSet}</td>
                    <td className="num font-semibold">{r.hit}</td>
                    <td className="num">{r.back}</td>
                    <td className="num">{r.storeSold || ""}</td>
                    <td><button type="button" className="text-foil text-xs hover:underline" onClick={() => openStream(r.streamId)}>Report</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {picked && extra && (
        <div className="grid md:grid-cols-2 gap-4">
          <section className="card overflow-x-auto">
            <div className="px-4 pt-4 pb-2 label">Stock received</div>
            {extra.lots.length === 0 ? (
              <div className="px-4 pb-4 text-dim text-sm">No purchases logged for this product.</div>
            ) : (
              <table className="w-full">
                <thead><tr><th>Date</th><th>Qty</th><th>Unit cost</th><th>Source</th></tr></thead>
                <tbody>
                  {extra.lots.map((l, i) => (
                    <tr key={i}><td>{niceDate(l.date)}</td><td className="num">{l.qty}</td><td className="num">{$(l.unitCost)}</td><td className="text-dim text-xs">{l.source}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="card overflow-x-auto">
            <div className="px-4 pt-4 pb-2 label">Stock changes</div>
            {extra.changes.length === 0 ? (
              <div className="px-4 pb-4 text-dim text-sm">No stock changes logged for this product.</div>
            ) : (
              <table className="w-full">
                <thead><tr><th>Date</th><th>Change</th><th>On hand after</th><th>Why</th></tr></thead>
                <tbody>
                  {extra.changes.map((c, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap">{niceDate(c.date)}</td>
                      <td className={`num font-semibold ${c.delta < 0 ? "text-bad" : "text-win"}`}>{c.delta > 0 ? `+${c.delta}` : c.delta}</td>
                      <td className="num">{Math.max(0, c.qtyNow)}</td>
                      <td className="text-dim text-xs">{c.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
