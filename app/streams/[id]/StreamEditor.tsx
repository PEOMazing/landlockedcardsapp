"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProductPicker, { PickerItem } from "@/components/ProductPicker";
import CopyShowSet from "@/components/CopyShowSet";
import Timeclock from "@/components/Timeclock";
import BreakChecklist from "@/components/BreakChecklist";
import SinglesPicker from "@/components/SinglesPicker";
import Thumb from "@/components/Thumb";

const $ = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type LineT = {
  id: string; name: string; qty: number; qtyHit: number;
  market: number; isGiveaway: boolean; isHit: boolean; isGraded?: boolean; tcgUrl?: string; image?: string; buy?: number;
  singleRecId?: string; salePrice?: number | null;
};

export default function StreamEditor({ id }: { id: string }) {
  const [data, setData] = useState<any>(null);
  const [lines, setLines] = useState<LineT[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>({});
  const [saved, setSaved] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteMsg, setPasteMsg] = useState("");
  const [returnArmed, setReturnArmed] = useState(false);
  const [returnMsg, setReturnMsg] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/streams/${id}`);
    if (!res.ok) {
      setLoadErr(res.status === 403 ? "You do not have access to this stream." : "Stream not found.");
      return;
    }
    const d = await res.json();
    setData(d);
    setLines(d.lines || []);
    setForm({
      afterFees: d.stream.afterFees ?? "",
      promotion: d.stream.promotion ?? "",
      tips: d.stream.tips ?? "",
      spotsSold: d.stream.spotsSold ?? "",
      giveaways: d.stream.giveaways ?? "",
    });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // live metrics computed locally - hit marking updates instantly, no reload
  const m = useMemo(() => {
    const cfg = data?.config || { hitThreshold: 10, breakevenMult: 1.45, histDeliveryRate: null };
    const spots = lines.filter((l) => !l.isGiveaway).reduce((a, l) => a + l.qty, 0);
    const givvyQty = lines.filter((l) => l.isGiveaway).reduce((a, l) => a + l.qty, 0);
    const givvyValue = lines.filter((l) => l.isGiveaway).reduce((a, l) => a + l.qty * l.market, 0);
    const totalValue = lines.reduce((a, l) => a + l.qty * l.market, 0);
    const hitLines = lines.filter((l) => l.isHit);
    const hitPoolQty = hitLines.reduce((a, l) => a + l.qty, 0);
    const hitPoolValue = hitLines.reduce((a, l) => a + l.qty * l.market, 0);
    const hitsDelivered = hitLines.reduce((a, l) => a + l.qtyHit, 0);
    const hitValueDelivered = hitLines.reduce((a, l) => a + l.qtyHit * l.market, 0);
    const hitCostDelivered = hitLines.reduce((a, l) => a + l.qtyHit * (l.buy ?? 0), 0);
    const hitValueRemaining = hitLines.reduce((a, l) => a + Math.max(l.qty - l.qtyHit, 0) * l.market, 0);
    const showBuy = lines.some((l) => typeof l.buy === "number"); // admin only
    const buyCost = lines.reduce((a, l) => a + l.qty * (l.buy ?? 0), 0);
    return {
      cfg, spots, givvyQty, givvyValue, totalValue, showBuy,
      buyCost: showBuy ? buyCost : null,
      valuePerSpot: spots > 0 ? totalValue / spots : 0,
      breakEven: spots > 0 ? (totalValue / spots) * cfg.breakevenMult : 0,
      hitPoolQty, hitPoolValue, hitsDelivered, hitValueDelivered,
      hitCostDelivered: showBuy ? hitCostDelivered : null,
      hitValueRemaining,
      hitOddsPerSpot: spots > 0 ? hitPoolQty / spots : 0,
      expectedHits: cfg.histDeliveryRate !== null ? Math.round(hitPoolQty * cfg.histDeliveryRate) : null,
    };
  }, [lines, data]);

  if (loadErr) {
    return (
      <main className="max-w-2xl mx-auto p-6">
        <div className="card p-6 text-dim">{loadErr} <Link className="text-foil ml-2" href="/dashboard">Back to my streams</Link></div>
      </main>
    );
  }
  if (!data) return <main className="max-w-6xl mx-auto p-6 text-dim">Loading stream...</main>;
  const { stream, canManage, timeEntries } = data;

  async function addLine(item: PickerItem, qty: number) {
    setBusy(true);
    await fetch("/api/lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamId: id, productId: item.id, qty }),
    });
    await load();
    setBusy(false);
  }

  // Parse pasted rows from Excel/Sheets: "Name<TAB>Qty", "Qty<TAB>Name", "4x Name", "Name x4", or just "Name"
  function parsePaste(text: string): { name: string; qty: number }[] {
    const out: { name: string; qty: number }[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      let name = line, qty = 1, m;
      if (line.includes("\t")) {
        const parts = line.split("\t").map((p) => p.trim()).filter(Boolean);
        const numIdx = parts.findIndex((p) => /^\d+$/.test(p));
        if (numIdx >= 0) {
          qty = parseInt(parts[numIdx]);
          name = parts.filter((_, i) => i !== numIdx).join(" ");
        } else name = parts.join(" ");
      } else if ((m = line.match(/^(\d+)\s*[xX]\s+(.+)$/))) {
        qty = parseInt(m[1]); name = m[2];
      } else if ((m = line.match(/^(.+?)\s+[xX]\s*(\d+)$/))) {
        name = m[1]; qty = parseInt(m[2]);
      }
      if (name) out.push({ name: name.trim(), qty: Math.max(1, qty) });
    }
    return out;
  }

  async function bulkAdd() {
    const items = parsePaste(pasteText);
    if (items.length === 0) return;
    setBusy(true); setPasteMsg("Adding " + items.length + " items...");
    const res = await fetch("/api/lines/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamId: id, items }),
    });
    const d = await res.json();
    if (!res.ok) setPasteMsg(d.error || "Bulk add failed");
    else {
      let msg = `Added ${d.added.length} items`;
      if (d.created.length) msg += ` - created ${d.created.length} new products (set their prices!)`;
      if (d.skipped.length) msg += ` - skipped (no match): ${d.skipped.join(", ")}`;
      setPasteMsg(msg);
      setPasteText("");
    }
    await load();
    setBusy(false);
  }

  async function removeLine(lineId: string) {
    setBusy(true);
    await fetch(`/api/lines/${lineId}`, { method: "DELETE" });
    await load();
    setBusy(false);
  }

  // pricing (admin/manager): updates the line snapshot and the inventory master
  function setMarket(lineId: string, market: number) {
    const cfg = data?.config || { hitThreshold: 10 };
    const mkt = Math.max(0, market);
    setLines((prev) =>
      prev.map((l) =>
        l.id === lineId ? { ...l, market: mkt, isHit: !l.isGiveaway && mkt > cfg.hitThreshold } : l
      )
    );
    fetch(`/api/lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market: mkt }),
    });
  }

  // optimistic hit updates: instant on screen, saved in the background
  function setHit(lineId: string, qtyHit: number) {
    const clamped = Math.max(0, qtyHit);
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, qtyHit: clamped } : l)));
    fetch(`/api/lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qtyHit: clamped }),
    });
  }

  // sale price on an auctioned single: marks the card Sold and counts the hit
  function setSale(lineId: string, salePrice: number) {
    const sale = Math.max(0, salePrice);
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, salePrice: sale, qtyHit: sale > 0 ? 1 : l.qtyHit } : l)));
    fetch(`/api/lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ salePrice: sale }),
    });
  }

  async function returnItems() {
    setBusy(true); setReturnMsg("");
    const res = await fetch(`/api/streams/${id}/return`, { method: "POST" });
    const d = await res.json();
    if (!res.ok) setReturnMsg(d.error || "Return failed");
    else setReturnMsg(`Returned ${d.itemsReturned} items to inventory`);
    setReturnArmed(false);
    await load();
    setBusy(false);
  }

  async function saveResults(markComplete: boolean) {
    setBusy(true);
    await fetch(`/api/streams/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        afterFees: parseFloat(form.afterFees) || 0,
        promotion: parseFloat(form.promotion) || 0,
        tips: parseFloat(form.tips) || 0,
        spotsSold: parseInt(form.spotsSold) || 0,
        giveaways: parseInt(form.giveaways) || 0,
        ...(markComplete ? { status: "Complete" } : {}),
      }),
    });
    await load();
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const field = (key: string, label: string, step = "0.01") => (
    <div>
      <label className="label">{label}</label>
      <input
        type="number" step={step} className="input mt-1"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  const spotsSoldNum = parseInt(form.spotsSold) || 0;
  const afterFeesNum = parseFloat(form.afterFees) || 0;
  const promoNum = parseFloat(form.promotion) || 0;
  const tipsNum = parseFloat(form.tips) || 0;
  const giveawaysNum = parseInt(form.giveaways) || 0;
  const resultsEntered = afterFeesNum > 0;

  // ---- the stream P&L waterfall ----
  // Product that was not hit goes back into inventory, so it is not a cost of
  // this stream. What the stream "sold" is the hits that went out plus the
  // giveaways it spent.
  const giveawaySpend = giveawaysNum * (data?.config?.giveawayCost || 0);
  const productSold = m.hitValueDelivered + giveawaySpend;
  const productBack = Math.max(0, m.totalValue - m.hitValueDelivered - m.givvyValue);
  const grossProfit = afterFeesNum - productSold;

  const packingPay = data?.pay ? ((stream?.packingHours || 0) + (stream?.managerPackingHours || 0)) * data.pay.packingRate : 0;
  const netProfit = grossProfit - packingPay - tipsNum - promoNum;
  const buyNet = m.hitCostDelivered !== null
    ? afterFeesNum - (m.hitCostDelivered + giveawaySpend) - packingPay - tipsNum - promoNum
    : null;

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Link href="/dashboard" className="text-dim text-sm hover:text-body">&larr; My streams</Link>
          <h1 className="text-2xl font-bold mt-1" style={{ fontFamily: "var(--font-display)" }}>
            {stream.title}
          </h1>
          <span className={`text-sm ${stream.status === "Complete" ? "text-win" : "text-foil"}`}>
            {stream.status}
          </span>
          <span className="text-dim text-sm ml-3 border border-edge rounded-full px-3 py-0.5">
            {stream.streamType || "Surprise Set"}
          </span>
          {stream.managerName && (
            <span className="text-dim text-sm ml-3">Managed by {stream.managerName}</span>
          )}
        </div>
        <CopyShowSet lines={lines.map((l) => ({ qty: l.qty, name: l.name }))} />
      </div>

      {/* Stream P&L: product that was not hit goes back to inventory, so the
          stream is only charged for what actually left the building */}
      <section className="card p-5 border-foil/40">
        <div className="label mb-3">Stream P&L</div>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-6">
              <span className="text-dim">Stream product at start</span>
              <span className="num">{$(m.totalValue)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-dim">Not hit, back to inventory</span>
              <span className="num">-{$(productBack)}</span>
            </div>
            <div className="flex justify-between gap-6 pl-3">
              <span className="text-dim">Hits delivered</span>
              <span className="num">{$(m.hitValueDelivered)}</span>
            </div>
            <div className="flex justify-between gap-6 pl-3">
              <span className="text-dim">Giveaways spent ({giveawaysNum} run{m.givvyQty > 0 ? ` + ${m.givvyQty} in set` : ""})</span>
              <span className="num">{$(giveawaySpend)}</span>
            </div>
            <div className="flex justify-between gap-6 border-t border-edge pt-1.5 font-semibold">
              <span>Product sold this show</span>
              <span className="num">{$(productSold)}</span>
            </div>
          </div>

          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-6">
              <span className="text-dim">Total sales after fees</span>
              <span className="num">{resultsEntered ? $(afterFeesNum) : "-"}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-dim">Product sold this show</span>
              <span className="num">-{$(productSold)}</span>
            </div>
            <div className="flex justify-between gap-6 border-t border-edge pt-1.5 font-semibold">
              <span>Gross profit</span>
              <span className={`num ${!resultsEntered ? "text-dim" : grossProfit >= 0 ? "text-win" : "text-bad"}`}>
                {resultsEntered ? $(grossProfit) : "-"}
              </span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-dim">Packing time</span>
              <span className="num">-{$(packingPay)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-dim">Tips (paid through)</span>
              <span className="num">-{$(tipsNum)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-dim">Promotion</span>
              <span className="num">-{$(promoNum)}</span>
            </div>
            <div className="flex justify-between gap-6 border-t border-edge pt-1.5">
              <span className="font-bold">Stream profit</span>
              <span className={`num text-xl font-bold ${!resultsEntered ? "text-dim" : netProfit >= 0 ? "text-win" : "text-bad"}`}>
                {resultsEntered ? $(netProfit) : "-"}
              </span>
            </div>
            {resultsEntered && buyNet !== null && (
              <div className="flex justify-between gap-6 text-xs">
                <span className="text-dim">over actual buy cost (admin)</span>
                <span className={`num ${buyNet >= 0 ? "text-win" : "text-bad"}`}>{$(buyNet)}</span>
              </div>
            )}
            {!resultsEntered && <div className="text-dim text-xs">enter results below and the right side fills in</div>}
            {resultsEntered && spotsSoldNum > 0 && (
              <div className="text-dim text-xs num text-right">{$(netProfit / spotsSoldNum)} per spin across {spotsSoldNum}</div>
            )}
          </div>
        </div>
        <div className="text-dim text-xs mt-3">
          Stream time: {stream.hours ? `${stream.hours}h streamed` : "no hours logged"}
          {(stream.packingHours || 0) > 0 && ` + ${stream.packingHours}h packing`}
          {(stream.managerPackingHours || 0) > 0 && ` + ${stream.managerPackingHours}h manager packing`}
        </div>
      </section>

      {/* Live hit tracker - updates the instant a hit is marked */}
      <section className="card p-5 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <div>
          <div className="label">Total $ hit so far</div>
          <div className="text-3xl font-bold num text-foil">{$(m.hitValueDelivered)}</div>
        </div>
        <div>
          <div className="label">Hits out</div>
          <div className="text-xl font-bold num">{m.hitsDelivered} <span className="text-dim text-sm">of {m.hitPoolQty}</span></div>
        </div>
        <div>
          <div className="label">Hit value remaining</div>
          <div className="text-xl font-bold num">{$(m.hitValueRemaining)}</div>
        </div>
        {m.hitCostDelivered !== null && (
          <div>
            <div className="label">Cost of hits out (admin)</div>
            <div className="text-xl font-bold num">{$(m.hitCostDelivered)}</div>
          </div>
        )}
        {spotsSoldNum > 0 && (
          <div>
            <div className="label">Hit rate per spin sold</div>
            <div className="text-xl font-bold num text-win">{((m.hitsDelivered / spotsSoldNum) * 100).toFixed(1)}%</div>
          </div>
        )}
        {spotsSoldNum > 0 && afterFeesNum > 0 && (
          <div>
            <div className="label">Avg spin value</div>
            <div className="text-xl font-bold num text-foil">{$(afterFeesNum / spotsSoldNum)}</div>
          </div>
        )}
      </section>

      {/* Show set builder */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="label">Show set</h2>
          {stream.streamType !== "Single Stream" && (
            <button className="text-foil text-xs hover:underline" onClick={() => setShowPaste(!showPaste)}>
              {showPaste ? "Hide paste" : "Paste a list"}
            </button>
          )}
        </div>
        {stream.streamType !== "Single Stream" && <ProductPicker onAdd={addLine} busy={busy} />}
        {stream.streamType === "Single Stream" && (
          <SinglesPicker streamId={id} onAdded={load} busy={busy} />
        )}
        {showPaste && (
          <div className="space-y-2 border border-edge rounded-lg p-3">
            <textarea
              className="input !h-32 font-mono text-xs"
              placeholder={"Paste from Excel - one item per line:\nPrismatic ETB\t2\n4x Topps Pack\nBlooming Waters"}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <div className="flex items-center gap-3 flex-wrap">
              <button className="btn-foil disabled:opacity-40" disabled={busy || !pasteText.trim()} onClick={bulkAdd}>
                Add all to show
              </button>
              {pasteMsg && <span className="text-dim text-xs">{pasteMsg}</span>}
            </div>
            <p className="text-dim text-xs">
              Accepts Name + Qty columns from Excel, or lines like "4x Topps Pack". Names are matched
              against inventory; anything unknown gets created as a new product (admin) for you to price.
            </p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th>Product</th><th>Qty</th><th>Market</th><th>Hits</th><th>Remain</th><th>Hit value left</th>
                {lines.some((l) => l.singleRecId) && <th>Sale</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className={l.isGiveaway ? "bg-givvy/5" : ""}>
                  <td className="!font-medium">
                    {l.image && <Thumb src={l.image} size={28} className="mr-2" />}
                    {l.name}
                    {l.isGiveaway && <span className="text-givvy text-xs ml-2">giveaway</span>}
                    {l.isHit && <span className="text-foil text-xs ml-2 font-bold">HIT</span>}
                  </td>
                  <td>{l.qty}</td>
                  <td>
                    {canManage ? (
                      <div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number" step="0.01" min={0}
                          className="input !w-24 !py-1"
                          value={l.market}
                          onChange={(e) => setMarket(l.id, parseFloat(e.target.value) || 0)}
                        />
                        <a
                          className="text-foil text-xs hover:underline whitespace-nowrap"
                          target="_blank" rel="noreferrer"
                          href={l.isGraded
                            ? `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(l.name)}&LH_Sold=1&LH_Complete=1`
                            : l.tcgUrl || `https://www.google.com/search?q=${encodeURIComponent(l.name)}+site:tcgplayer.com`}
                        >
                          {l.isGraded ? "Sold comps" : "TCG"}
                        </a>
                      </div>
                      {l.isGraded && (
                        <input
                          className="input !w-40 !py-1 mt-1 text-xs"
                          placeholder="avg: 180, 172, 195 ⏎"
                          title="Paste recent sale prices separated by commas and press Enter - the average fills the market price"
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            const nums = (e.target as HTMLInputElement).value
                              .split(/[^0-9.]+/).map(parseFloat).filter((n) => !isNaN(n) && n > 0);
                            if (nums.length > 0) {
                              const avg = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
                              setMarket(l.id, avg);
                              (e.target as HTMLInputElement).value = "";
                            }
                          }}
                        />
                      )}
                      </div>
                    ) : (
                      $(l.market)
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      <button
                        className="rounded-md border border-edge text-dim px-2 py-1 text-xs font-bold hover:bg-edge/40 hover:text-body disabled:opacity-30"
                        disabled={l.qtyHit <= 0}
                        onClick={() => setHit(l.id, l.qtyHit - 1)}
                        aria-label={`Undo one ${l.name} hit`}
                      >
                        -1
                      </button>
                      <input
                        type="number" min={0} max={l.qty}
                        className="input !w-16 !py-1"
                        value={l.qtyHit}
                        onChange={(e) => setHit(l.id, parseInt(e.target.value) || 0)}
                      />
                      <button
                        className="rounded-md border border-foil/50 text-foil px-2 py-1 text-xs font-bold hover:bg-foil/15 disabled:opacity-30"
                        disabled={l.qtyHit >= l.qty}
                        onClick={() => setHit(l.id, l.qtyHit + 1)}
                        aria-label={`Mark one ${l.name} hit`}
                      >
                        +1
                      </button>
                    </div>
                  </td>
                  <td>{Math.max(l.qty - l.qtyHit, 0)}</td>
                  <td>{$(Math.max(l.qty - l.qtyHit, 0) * l.market)}</td>
                  {lines.some((x) => x.singleRecId) && (
                    <td>
                      {l.singleRecId ? (
                        <input
                          type="number" step="0.01" min={0}
                          className="input !w-24 !py-1"
                          placeholder="hammer $"
                          title="Final auction price - entering it marks the card Sold"
                          defaultValue={l.salePrice ?? ""}
                          onBlur={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v !== (l.salePrice ?? 0)) setSale(l.id, v);
                          }}
                        />
                      ) : (
                        <span className="text-dim text-xs">-</span>
                      )}
                    </td>
                  )}
                  <td className="text-right">
                    <button className="text-bad text-xs hover:underline" onClick={() => removeLine(l.id)}>remove</button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr><td colSpan={8} className="text-dim">
                  {stream.streamType === "Single Stream"
                    ? "Search the singles inventory above to add auction cards - each starts at $1 on Whatnot"
                    : "Search the inventory above to build this stream's show set"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Character break checklist */}
      {stream.streamType === "Character Break" && (
        <BreakChecklist streamId={id} initial={stream.checklist || null} locked={stream.status === "Complete"} />
      )}

      {/* Spot economics */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Spots (excl. giveaways)" value={String(m.spots)} />
        <Stat label="Giveaways" value={`${m.givvyQty} / ${$(m.givvyValue)}`} accent="givvy" />
        <Stat label="Total product value" value={$(m.totalValue)} />
        <Stat label="Value per spot" value={m.spots ? $(m.valuePerSpot) : "-"} />
        <Stat label="Break even per spot" value={m.spots ? $(m.breakEven) : "-"} accent="win" />
        <Stat label={`Hit pool (> $${m.cfg.hitThreshold})`} value={`${m.hitPoolQty} items / ${$(m.hitPoolValue)}`} accent="foil" />
        <Stat label="Hit odds per spot" value={m.spots ? (m.hitOddsPerSpot * 100).toFixed(1) + "%" : "-"} accent="foil" />
        {m.expectedHits !== null ? (
          <Stat
            label={`Expected hits (history: ${(m.cfg.histDeliveryRate * 100).toFixed(0)}% of pool goes)`}
            value={`~${m.expectedHits} of ${m.hitPoolQty}`}
            accent="foil"
          />
        ) : (
          <Stat label="Pool delivered" value={m.hitPoolQty > 0 ? ((m.hitsDelivered / m.hitPoolQty) * 100).toFixed(0) + "%" : "-"} accent="win" />
        )}
      </section>

      {/* Timeclock */}
      <Timeclock
        streamId={id}
        streamDate={stream.date}
        entries={timeEntries || []}
        onChanged={load}
        hoursStreamed={stream.hours || 0}
        streamerPacking={stream.packingHours || 0}
        managerPacking={stream.managerPackingHours || 0}
        hasManager={!!stream.managerName}
      />

      {/* Post-stream results */}
      <section className="card p-5 space-y-4">
        <h2 className="label">After the stream</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {field("afterFees", "After fees ($)")}
          {field("promotion", "Promotion ($)")}
          {field("tips", "Tips ($)")}
          {field("spotsSold", "Spots sold (spins)", "1")}
          <div>
            {field("giveaways", "Giveaways run", "1")}
            {(parseInt(form.giveaways) || 0) > 0 && (
              <p className="text-dim text-xs mt-1">
                {parseInt(form.giveaways) || 0} x {$(m.cfg.giveawayCost ?? 2.5)} = <span className="text-bad">-{$((parseInt(form.giveaways) || 0) * (m.cfg.giveawayCost ?? 2.5))}</span> from profit
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-3 items-center flex-wrap">
          <button className="btn-ghost disabled:opacity-40" disabled={busy} onClick={() => saveResults(false)}>
            Save
          </button>
          <button className="btn-win disabled:opacity-40" disabled={busy} onClick={() => saveResults(true)}>
            Save and mark complete
          </button>
          {saved && <span className="text-win text-sm">Saved</span>}
          <span className="mx-2 text-edge">|</span>
          {stream.itemsReturned ? (
            <span className="text-win text-sm">✓ Unsold items returned to inventory - show set locked</span>
          ) : !returnArmed ? (
            <button
              className="btn-ghost disabled:opacity-40"
              disabled={busy || lines.length === 0}
              onClick={() => setReturnArmed(true)}
            >
              Return unsold items to inventory
            </button>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-givvy text-sm">
                Return {lines.reduce((a, l) => a + Math.max(l.qty - l.qtyHit, 0), 0)} items? Hits must be final - this locks the show set.
              </span>
              <button className="btn-win" disabled={busy} onClick={returnItems}>Yes, return</button>
              <button className="btn-ghost" onClick={() => setReturnArmed(false)}>Cancel</button>
            </span>
          )}
          {returnMsg && <span className="text-win text-sm">{returnMsg}</span>}
          <span className="text-dim text-xs">
            Hours come from the timeclock above. Pay settles weekly: profit is netted first, then you get
            the higher of hourly or commission.
          </span>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "win" | "givvy" | "foil" }) {
  const color = accent === "win" ? "text-win" : accent === "givvy" ? "text-givvy" : accent === "foil" ? "text-foil" : "text-body";
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`text-lg font-bold num mt-1 ${color}`}>{value}</div>
    </div>
  );
}
