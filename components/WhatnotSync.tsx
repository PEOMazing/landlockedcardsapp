"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "@/components/Toaster";
import { readWhatnotCsv, showsIn, pickShow, planSetFromShow, storeRows, localDate, looksGeneric, type SetLine } from "@/lib/whatnotCsv";

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

const lineById = (lines: SetLine[], id: string) => lines.find((l) => l.id === id) || null;

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
  // What the operator said each unrecognised title really is. Keyed by the
  // folded title so a decision survives Whatnot's trailing dots, and cleared
  // whenever a new file is picked.
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [learn, setLearn] = useState<Record<string, boolean>>({});

  // "set:<lineId>" means it is that line after all; "store:<productId>" means
  // it came off the shelf and belongs in Store sales, not on the wheel.
  const decisions = useMemo(() => {
    const mapTo: Record<string, string> = {};
    const asStore: Record<string, string> = {};
    for (const [fold, v] of Object.entries(decided)) {
      if (v.startsWith("set:")) mapTo[fold] = v.slice(4);
      else if (v.startsWith("store:")) asStore[fold] = v.slice(6);
    }
    return { mapTo, asStore };
  }, [decided]);

  const plan = useMemo(
    () => (sales.length ? planSetFromShow(sales, lines, decisions) : null),
    [sales, lines, decisions]
  );
  const storeCount = useMemo(() => storeRows(sales).rows.length, [sales]);

  // Set lines worth offering as a target: a giveaway or an existing store line
  // is not something a spin landed on.
  const targets = useMemo(
    () => lines.filter((l) => !l.isStore && !l.isGiveaway).sort((a, b) => a.name.localeCompare(b.name)),
    [lines]
  );
  const [inv, setInv] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!plan || (plan.notOnSet.length === 0 && plan.toStore.length === 0)) return;
    if (inv.length) return;
    fetch("/api/inventory")
      .then((r) => r.json())
      .then((d) => setInv((d.items || []).map((i: any) => ({ id: i.id, name: i.name }))))
      .catch(() => {});
  }, [plan, inv.length]);

  async function pick(f: File | null) {
    if (!f) return;
    const t = await f.text();
    setFileName(f.name);
    setText(t);
    setDecided({});
    setLearn({});
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

    // Titles to teach the app, so a mapping made once is not asked for again.
    // Only lines backed by an Inventory product can learn one: the alias lives
    // on the product, and a single card has none.
    const lineById = new Map(lines.map((l) => [l.id, l]));
    const remember = Object.entries(decided)
      .filter(([fold]) => learn[fold])
      .map(([fold, v]) => {
        const title = [...plan.notOnSet, ...plan.toStore].find((m) => m.fold === fold)?.title || "";
        const productId = v.startsWith("store:") ? v.slice(6) : lineById.get(v.slice(4))?.productId || "";
        return { productId, listing: title };
      })
      .filter((r) => r.productId && r.listing);

    const r = await fetch(`/api/streams/${streamId}/whatnot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hits: plan.lines.map((l) => ({ lineId: l.lineId, qtyHit: l.now })),
        spotsSold: plan.spins,
        giveaways: plan.freePacks,
        singlesGiveaways: plan.freeSingles,
        remember,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); toast(d.error || "Could not update the show set", "bad"); return; }

    // Anything sent to the shelf is booked as a store sale in the same go, so
    // the operator is not left to re-enter it by hand downstairs.
    let storeMsg = "";
    if (plan.toStore.length) {
      const sr = await fetch("/api/lines/store/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          streamId,
          // one row per Whatnot order, so a second upload of the same file is
          // skipped on the order id instead of booking the sale again
          rows: plan.toStore.flatMap((t) =>
            t.orders.map((o) => ({
              productId: t.productId, units: o.units, soldPrice: o.price,
              listing: t.title, orderId: o.orderId,
            }))
          ),
        }),
      });
      const sd = await sr.json().catch(() => ({}));
      if (!sr.ok) storeMsg = sd.error || "store sales could not be booked";
      else {
        storeMsg = `${sd.added} store sale${sd.added === 1 ? "" : "s"} booked`;
        if (sd.errors?.length) storeMsg += `; ${sd.errors.join("; ")}`;
      }
    }

    setBusy(false);
    const parts = [`${d.changed} line${d.changed === 1 ? "" : "s"} changed`];
    if (d.learned) parts.push(`${d.learned} title${d.learned === 1 ? "" : "s"} remembered`);
    if (storeMsg) parts.push(storeMsg);
    toast(`Show set updated from Whatnot: ${parts.join(", ")}`, "ok");
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

          {(plan.notOnSet.length > 0 || plan.toStore.length > 0) && (
            <div className="rounded-lg border border-bad/60 bg-bad/10 p-3 text-sm space-y-2">
              <div className="font-semibold text-bad">{"⚠"} Sold on Whatnot but not matched to this show set</div>
              <div className="text-dim text-xs">
                Say what each one is. Pick a set line if the listing was just titled differently, or an
                inventory item if it sold off the shelf - a shelf sale comes out of spots sold and books
                itself into Store sales. Tick remember and the same title matches itself next time.
              </div>

              {plan.notOnSet.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-dim">All {plan.notOnSet.length} unanswered at once:</span>
                  <select
                    className="input text-xs py-0.5 max-w-full"
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      setDecided((p) => {
                        const next = { ...p };
                        for (const m of plan.notOnSet) next[m.fold] = v;
                        return next;
                      });
                    }}
                  >
                    <option value="">{"— map them all to —"}</option>
                    <optgroup label="One line on the set">
                      {targets.map((l) => (
                        <option key={l.id} value={`set:${l.id}`}>{l.name}</option>
                      ))}
                    </optgroup>
                  </select>
                  <span className="text-dim">
                    for a break, where every slot is one share of the same box
                  </span>
                </div>
              )}
              {[...plan.notOnSet, ...plan.toStore.map((t) => ({ title: t.title, fold: t.fold, sold: t.units, revenue: t.price }))].map((m) => {
                const choice = decided[m.fold] || "";
                const chosenLine = choice.startsWith("set:") ? lineById(lines, choice.slice(4)) : null;
                const hasProduct = choice.startsWith("store:") || !!chosenLine?.productId;
                const generic = looksGeneric(m.title);
                const canLearn = hasProduct && !generic;
                return (
                  <div key={m.fold} className="border-t border-edge/60 pt-2 space-y-1">
                    <div className="flex justify-between gap-3 text-xs">
                      <span className="truncate" title={m.title}>{m.title}</span>
                      <span className="num whitespace-nowrap">{m.sold} {"×"} - {$(m.revenue)}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        className="input text-xs py-0.5 max-w-full"
                        value={choice}
                        onChange={(e) => setDecided((p) => ({ ...p, [m.fold]: e.target.value }))}
                      >
                        <option value="">{"— what is this? —"}</option>
                        <optgroup label="It is this line on the set">
                          {targets.map((l) => (
                            <option key={l.id} value={`set:${l.id}`}>{l.name}</option>
                          ))}
                        </optgroup>
                        <optgroup label="It sold off the shelf (store sale)">
                          {inv.map((i) => (
                            <option key={i.id} value={`store:${i.id}`}>{i.name}</option>
                          ))}
                        </optgroup>
                      </select>
                      {choice && (
                        <label className={`text-xs flex items-center gap-1 ${canLearn ? "" : "opacity-40"}`}>
                          <input
                            type="checkbox"
                            disabled={!canLearn}
                            checked={!!learn[m.fold]}
                            onChange={(e) => setLearn((p) => ({ ...p, [m.fold]: e.target.checked }))}
                          />
                          remember this title
                        </label>
                      )}
                      {choice.startsWith("store:") && <span className="text-xs text-dim">out of spots sold</span>}
                      {choice && generic && (
                        <span className="text-xs text-dim">
                          {"“"}{m.title}{"”"} is a slot name, not a product - remembering it would
                          hijack the next break that uses it
                        </span>
                      )}
                      {choice && !generic && !hasProduct && (
                        <span className="text-xs text-dim">single cards cannot remember a title</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {plan.notOnSet.length > 0 && (
                <div className="text-dim text-xs">
                  Anything left unanswered still counts toward spots sold and spin sales, since the money
                  did come in. It just will not mark a hit.
                </div>
              )}
            </div>
          )}

          {plan.over.length > 0 && (
            <div className="rounded-lg border border-warn/60 bg-warn/10 p-3 text-sm space-y-1">
              <div className="font-semibold text-warn">{"⚠"} More hit than was on the set</div>
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
              <button
                className="btn-win disabled:opacity-40"
                disabled={
                  busy ||
                  (changes.length === 0 &&
                    !numbersChange &&
                    plan.toStore.length === 0 &&
                    !Object.values(learn).some(Boolean))
                }
                onClick={apply}
              >
                {busy ? "Updating..." : "Update show set"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
