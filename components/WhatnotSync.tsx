"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "@/components/Toaster";
import { readWhatnotCsv, showsIn, pickShow, planSetFromShow, storeRows, localDate, type SetLine } from "@/lib/whatnotCsv";

// Whatnot show report -> show set. Drop the show's sales export (or the weekly
// earnings report and pick the show) and the set fills itself in: every paid
// spin marks a hit on the item it landed on, the spin count becomes spots
// sold, and the free orders become the pack and singles giveaway counts.
// Store sales in the same file are handed to the Store sales section.
//
// The file is read here in the browser. Only hit counts per set line and the
// three totals are sent; buyer names and addresses never leave this computer.
// Hits are set, not added, so uploading the same report twice is harmless.

const $ = (n: number) => "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type SharedFile = { name: string; text: string; nonce: number };

export default function WhatnotSync({
  streamId, streamTitle, streamDate, streamerName, closed, lines, current, onFile, onApplied,
}: {
  streamId: string;
  streamTitle: string;
  streamDate: string;
  streamerName: string;
  closed: boolean;
  lines: SetLine[];
  current: { spotsSold: number | null; giveaways: number | null; singlesGiveaways: number | null };
  onFile: (f: SharedFile) => void;
  onApplied: () => Promise<void>;
}) {
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [showId, setShowId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => (text ? readWhatnotCsv(text) : null), [text]);
  const shows = useMemo(() => (parsed && !parsed.error ? showsIn(parsed.sales) : []), [parsed]);
  const multiShow = shows.length > 1;
  useEffect(() => {
    if (!multiShow) { setShowId(null); return; }
    setShowId(pickShow(shows, { title: streamTitle, date: streamDate, streamer: streamerName }) || shows[0].id);
  }, [multiShow, shows, streamTitle, streamDate, streamerName]);

  const sales = useMemo(
    () => (!parsed || parsed.error ? [] : multiShow ? parsed.sales.filter((s) => s.showId === showId) : parsed.sales),
    [parsed, multiShow, showId]
  );
  const plan = useMemo(() => (sales.length ? planSetFromShow(sales, lines) : null), [sales, lines]);
  const storeCount = useMemo(() => storeRows(sales).rows.length, [sales]);

  async function pick(f: File | null) {
    if (!f) return;
    const t = await f.text();
    setFileName(f.name);
    setText(t);
    onFile({ name: f.name, text: t, nonce: Date.now() });
  }

  const changes = plan ? plan.lines.filter((l) => l.now !== l.was) : [];
  const numbersChange =
    !!plan &&
    (plan.spins !== (current.spotsSold ?? -1) ||
      plan.freePacks !== (current.giveaways ?? -1) ||
      plan.freeSingles !== (current.singlesGiveaways ?? -1));

  async function apply() {
    if (!plan) return;
    setBusy(true);
    const r = await fetch(`/api/streams/${streamId}/whatnot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hits: plan.lines.map((l) => ({ lineId: l.lineId, qtyHit: l.now })),
        spotsSold: plan.spins,
        giveaways: plan.freePacks,
        singlesGiveaways: plan.freeSingles,
      }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { toast(d.error || "Could not update the show set", "bad"); return; }
    toast(`Show set updated from Whatnot: ${d.changed} line${d.changed === 1 ? "" : "s"} changed`, "ok");
    if (d.errors?.length) toast(d.errors.join("; "), "bad");
    await onApplied();
  }

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="label">Whatnot show report</h2>
          <div className="text-dim text-xs mt-0.5">
            Upload the show&apos;s sales export and the set fills itself in: hits, spots sold and giveaways. Store sales go to the section below. Read on this computer only.
          </div>
        </div>
        <label className="btn-ghost text-xs cursor-pointer">
          {fileName ? "Choose another file" : "Upload show report"}
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0] || null)} />
        </label>
      </div>

      {parsed?.error && <div className="text-bad text-sm">{parsed.error}</div>}

      {plan && (
        <div className="space-y-4">
          <div className="text-xs text-dim">
            {fileName}
            {multiShow && showId && (
              <>
                {" "}has {shows.length} shows. This stream:{" "}
                <select className="input inline-block w-auto text-xs py-0.5 ml-1" value={showId} onChange={(e) => setShowId(e.target.value)}>
                  {shows.map((s) => (
                    <option key={s.id} value={s.id}>{localDate(s.start)} - {s.title.slice(0, 70)} ({s.orders})</option>
                  ))}
                </select>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="label">Spots sold</div>
              <div className="num text-lg font-bold">{plan.spins}</div>
              <div className="text-dim text-xs">now {current.spotsSold ?? "blank"}</div>
            </div>
            <div>
              <div className="label">Spin sales</div>
              <div className="num text-lg font-bold">{$(plan.gross)}</div>
              <div className="text-dim text-xs">before Whatnot fees - enter After Fees yourself</div>
            </div>
            <div>
              <div className="label">Pack giveaways</div>
              <div className="num text-lg font-bold">{plan.freePacks}</div>
              <div className="text-dim text-xs">now {current.giveaways ?? "blank"}</div>
            </div>
            <div>
              <div className="label">Singles giveaways</div>
              <div className="num text-lg font-bold">{plan.freeSingles}</div>
              <div className="text-dim text-xs">now {current.singlesGiveaways ?? "blank"}</div>
            </div>
          </div>

          {plan.notOnSet.length > 0 && (
            <div className="rounded-lg border border-bad/60 bg-bad/10 p-3 text-sm space-y-1">
              <div className="font-semibold text-bad">{"⚠"} Sold on Whatnot but not on this show set</div>
              {plan.notOnSet.map((m) => (
                <div key={m.title} className="flex justify-between gap-3 text-xs">
                  <span className="truncate">{m.title}</span>
                  <span className="num">{m.sold} spin{m.sold === 1 ? "" : "s"} - {$(m.revenue)}</span>
                </div>
              ))}
              <div className="text-dim text-xs">Add these to the show set below, then upload the report again so they get their hits.</div>
            </div>
          )}

          {plan.over.length > 0 && (
            <div className="rounded-lg border border-amber-400/60 bg-amber-400/10 p-3 text-sm space-y-1">
              <div className="font-semibold text-amber-400">{"⚠"} More hit than was on the set</div>
              {plan.over.map((o) => (
                <div key={o.name} className="text-xs">{o.name}: {o.sold} spins, only {o.onSet} on the set. Raise the quantity on the set, then upload again.</div>
              ))}
            </div>
          )}

          <div className="space-y-1 text-sm">
            <div className="label">Hits</div>
            {changes.length === 0 && <div className="text-dim text-xs">Every line already matches the report.</div>}
            {changes.map((l) => (
              <div key={l.lineId} className="flex justify-between gap-3 border-t border-edge pt-1">
                <span className="truncate">{l.name}</span>
                <span className="num text-xs">
                  {l.was} {"→"} <span className="font-semibold">{l.now}</span> of {l.qty}
                </span>
              </div>
            ))}
          </div>

          {storeCount > 0 && (
            <div className="text-xs text-dim">
              {storeCount} store sale{storeCount === 1 ? "" : "s"} in this file - review {storeCount === 1 ? "it" : "them"} in Store sales below.
            </div>
          )}

          {closed ? (
            <div className="text-dim text-sm">Items were already returned on this stream, so hits are locked.</div>
          ) : (
            <div className="flex justify-end">
              <button className="btn-win disabled:opacity-40" disabled={busy || (changes.length === 0 && !numbersChange)} onClick={apply}>
                {busy ? "Updating..." : "Update show set"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
