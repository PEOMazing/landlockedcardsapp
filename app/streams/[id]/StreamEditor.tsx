"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ProductPicker, { PickerItem } from "@/components/ProductPicker";
import CopyShowSet from "@/components/CopyShowSet";
import Timeclock from "@/components/Timeclock";
import BreakChecklist from "@/components/BreakChecklist";
import SinglesPicker from "@/components/SinglesPicker";
import RollSingles from "@/components/RollSingles";
import ReturnSingles from "@/components/ReturnSingles";
import CardBoard from "@/components/CardBoard";
import Thumb from "@/components/Thumb";
import { toast } from "@/components/Toaster";
import StoreSales from "@/components/StoreSales";
import WhatnotSync, { type SharedFile } from "@/components/WhatnotSync";
import { splitByKind } from "@/lib/calc";
import StatTile from "@/components/ui/StatTile";
import TableEmpty from "@/components/ui/TableEmpty";
import { cardNoOf, groupSetRows, groupTotals, keepSetLine, withoutCardNo } from "@/lib/setFilter";

const $ = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });


type LineT = {
  id: string; name: string; qty: number; qtyHit: number;
  market: number; isGiveaway: boolean; isHit: boolean; isGraded?: boolean; tcgUrl?: string; image?: string; buy?: number;
  singleRecId?: string; salePrice?: number | null; slot?: number | null; holdOut?: boolean;
};

export default function StreamEditor({ id, isAdmin = false }: { id: string; isAdmin?: boolean }) {
  const [data, setData] = useState<any>(null);
  const [lines, setLines] = useState<LineT[]>([]);
  // Per-line promise chain for quantity edits. Declared up here with the other
  // hooks, above the `if (!data) return` below, because a hook called after an
  // early return changes the hook order between renders and React throws #310.
  // That is not hypothetical: it is what took the stream page down earlier.
  const qtyChain = useRef<Record<string, Promise<unknown>>>({});
  // Collapsed by default: most visits to this page are to build or run a show,
  // not to settle one.
  const [manageOpen, setManageOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>({});
  const [saved, setSaved] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const baselineRef = useRef("");
  const [loadErr, setLoadErr] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  // A Surprise Set's wheel can carry sealed product and single cards side by
  // side. This picks which inventory the add box searches; both kinds land on
  // the same show set.
  const [addFrom, setAddFrom] = useState<"sealed" | "singles">("sealed");
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDate, setMetaDate] = useState("");
  const [metaStreamer, setMetaStreamer] = useState("");
  const [metaManager, setMetaManager] = useState("");
  const [teamOptions, setTeamOptions] = useState<{ id: string; name: string }[]>([]);
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const [resultsErr, setResultsErr] = useState("");
  const [setSort, setSetSort] = useState<"board" | "name" | "price" | "hitValue">("board");
  // The set table could be sorted four ways and asked nothing. On a 250 unit
  // wheel that means the only way to reach a card is to scroll past the other
  // 249, and most of them are copies of each other. These three narrow it:
  // type anything, or show one kind, or show only what is still live.
  const [setQuery, setSetQuery] = useState("");
  const [setKind, setSetKind] = useState<"all" | "singles" | "sealed">("all");
  const [unhitOnly, setUnhitOnly] = useState(false);
  // Which collapsed runs of copies are open. Keyed by the group key rather
  // than by position, so an open run stays the same run when the sort or the
  // filter moves everything around underneath it.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  // A Single Stream auctions each card, so what it went for has to be recorded
  // per card. A Surprise Set does not: the spin price is the price, whatever
  // card comes out, so a per-card sale box there is a field asking to be filled
  // in wrongly. The column only exists on shows that actually sell one card at
  // a time.
  const sellsPerCard = (stream: any) => String(stream?.streamType || "") === "Single Stream";
  const [pasteText, setPasteText] = useState("");
  const [pasteMsg, setPasteMsg] = useState("");
  const [returnArmed, setReturnArmed] = useState(false);
  const [returnMsg, setReturnMsg] = useState("");
  // Singles lines the streamer has un-ticked on the return list: these cards
  // are staying out of stock for an upcoming show instead of going back in the
  // binder. Seeded from the lines so a flag set on an earlier visit, or by the
  // approve path, is still shown.
  const [holdOut, setHoldOut] = useState<Set<string>>(new Set());
  // one Whatnot upload feeds both the show set and the store sales
  const [whatnotFile, setWhatnotFile] = useState<SharedFile | null>(null);

  useEffect(() => {
    try { setManageOpen(localStorage.getItem("llcManageShow") === "1"); } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("llcManageShow", manageOpen ? "1" : "0"); } catch {}
  }, [manageOpen]);

  const load = useCallback(async () =>{
    const res = await fetch(`/api/streams/${id}`);
    if (!res.ok) {
      setLoadErr(res.status === 403 ? "You do not have access to this stream." : "Stream not found.");
      return;
    }
    const d = await res.json();
    setData(d);
    setLines(d.lines || []);
    setHoldOut(new Set(((d.lines || []) as LineT[]).filter((l) => l.holdOut).map((l) => l.id)));
    const f = {
      afterFees: d.stream.afterFees ?? "",
      promotion: d.stream.promotion ?? "",
      shippingAdjustments: d.stream.shippingAdjustments ?? "",
      tips: d.stream.tips ?? "",
      spotsSold: d.stream.spotsSold ?? "",
      giveaways: d.stream.giveaways ?? "",
      singlesGiveaways: d.stream.singlesGiveaways ?? "",
    };
    setForm(f);
    baselineRef.current = JSON.stringify(f);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // the whole team for the timeclock For selector - managers log anyone's hours
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/streamers");
        if (r.ok) {
          const d = await r.json();
          setTeam((d.streamers || []).map((p: any) => ({ id: p.id, name: p.name })));
        }
      } catch {}
    })();
  }, []);

  // results auto-save: whatever changes is on Airtable a moment later. No
  // reload on save - the P&L reads these fields from local state already.
  const pendingRef = useRef<string | null>(null);
  const removingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = JSON.stringify(form);
    if (!baselineRef.current || now === baselineRef.current) { pendingRef.current = null; return; }
    pendingRef.current = JSON.stringify({
      afterFees: parseFloat(form.afterFees) || 0,
      promotion: parseFloat(form.promotion) || 0,
      shippingAdjustments: parseFloat(form.shippingAdjustments) || 0,
      tips: parseFloat(form.tips) || 0,
      spotsSold: parseInt(form.spotsSold) || 0,
      giveaways: parseInt(form.giveaways) || 0,
      singlesGiveaways: parseInt(form.singlesGiveaways) || 0,
    });
    const t = setTimeout(async () => {
      const body = pendingRef.current;
      if (!body) return;
      setSaveState("saving");
      const r = await fetch(`/api/streams/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      });
      if (r.ok) {
        baselineRef.current = now;
        pendingRef.current = null;
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1800);
      } else {
        setSaveState("idle");
        const d = await r.json().catch(() => ({}));
        setResultsErr(d.error || "Could not save");
      }
    }, 900);
    return () => clearTimeout(t);
  }, [form, id]);

  // never lose a pending save: flush with keepalive when the tab hides or the
  // component unmounts - keepalive requests outlive navigation
  useEffect(() => {
    const flush = () => {
      if (!pendingRef.current) return;
      fetch(`/api/streams/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: pendingRef.current,
        keepalive: true,
      }).catch(() => {});
      pendingRef.current = null;
    };
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [id]);

  // live metrics computed locally - hit marking updates instantly, no reload
  const m = useMemo(() => {
    const cfg = data?.config || { hitThreshold: 10, breakevenMult: 1.45, histDeliveryRate: null };
    const storeLines = lines.filter((l: any) => l.isStore);
    const base = lines.filter((l: any) => !l.isStore); // spin math never sees store purchases
    const storeCount = storeLines.length;
    const storeSales = storeLines.reduce((a: number, l: any) => a + (l.soldPrice || 0), 0);
    const storeMarket = storeLines.reduce((a: number, l: any) => a + l.qty * l.market, 0);
    const storeBuy = storeLines.reduce((a: number, l: any) => a + l.qty * (l.buy ?? 0), 0);
    const spots = base.filter((l) => !l.isGiveaway).reduce((a, l) => a + l.qty, 0);
    const givvyQty = base.filter((l) => l.isGiveaway).reduce((a, l) => a + l.qty, 0);
    const givvyValue = base.filter((l) => l.isGiveaway).reduce((a, l) => a + l.qty * l.market, 0);
    const totalValue = base.reduce((a, l) => a + l.qty * l.market, 0);
    const itemsHit = base.reduce((a, l) => a + l.qtyHit, 0);
    const itemsTotal = base.reduce((a, l) => a + l.qty, 0);
    const hitLines = base.filter((l) => l.isHit);
    const hitPoolQty = hitLines.reduce((a, l) => a + l.qty, 0);
    const hitPoolValue = hitLines.reduce((a, l) => a + l.qty * l.market, 0);
    const hitsDelivered = hitLines.reduce((a, l) => a + l.qtyHit, 0);
    // cost counts EVERY delivered line at market, whatever its price - the hit
    // threshold defines odds stats only, and giveaway spend comes exclusively
    // from the giveaways-run counter, never from lines.
    const delivered = base;
    const hitValueDelivered = delivered.reduce((a, l) => a + l.qtyHit * l.market, 0);
    const hitCostDelivered = delivered.reduce((a, l) => a + l.qtyHit * (l.buy ?? 0), 0);
    const hitValueRemaining = hitLines.reduce((a, l) => a + Math.max(l.qty - l.qtyHit, 0) * l.market, 0);
    const unpricedQty = base.filter((l) => !l.isGiveaway && !(l.market > 0)).reduce((a, l) => a + l.qty, 0);
    const showBuy = lines.some((l) => typeof l.buy === "number"); // admin only
    const buyCost = base.reduce((a, l) => a + l.qty * (l.buy ?? 0), 0);
    // Splits the product at the top of the P&L into cards and sealed. Same
    // set of lines, so the two always add back up to totalValue.
    const kinds = splitByKind(base);
    return {
      cfg, spots, unpricedQty, givvyQty, givvyValue, totalValue, showBuy, kinds,
      buyCost: showBuy ? buyCost : null,
      valuePerSpot: spots > 0 ? totalValue / spots : 0,
      breakEven: spots > 0 ? (totalValue / spots) * cfg.breakevenMult : 0,
      hitPoolQty, hitPoolValue, hitsDelivered, hitValueDelivered, itemsHit, itemsTotal,
      hitCostDelivered: showBuy ? hitCostDelivered : null,
      hitValueRemaining,
      hitOddsPerSpot: spots > 0 ? hitPoolQty / spots : 0,
      storeCount, storeSales, storeMarket, storeBuy,
      expectedHits: cfg.histDeliveryRate !== null ? Math.round(hitPoolQty * cfg.histDeliveryRate) : null,
    };
  }, [lines, data]);

  // Singles that could still come back: the ones the return list asks about.
  //
  // These live up here, above the early returns below, and they have to. A
  // hook that sits after `if (!data) return` runs on the second render and not
  // the first, React counts a different number of hooks than last time, and
  // the whole page dies with error #310 before it paints. That is exactly what
  // took the stream page down: the first render has no data yet, so it bailed
  // out early, and the moment the fetch landed these two appeared out of
  // nowhere. Both only read state declared at the top, so there is no reason
  // for them to be anywhere else.
  const returnableSingles = useMemo(
    () => lines.filter((l) => !!l.singleRecId && Math.max(l.qty - l.qtyHit, 0) > 0),
    [lines],
  );
  const heldCount = useMemo(
    () => returnableSingles.filter((l) => holdOut.has(l.id)).length,
    [returnableSingles, holdOut],
  );

  // Rows the show-set table draws. Store purchases were always excluded and
  // the four sorts are unchanged; what is new is the filtering in front of
  // them. Up here with the other hooks, above the early return, for the same
  // reason the comment on qtyChain gives.
  const setPool = useMemo(() => (lines as any[]).filter((l) => !l.isStore), [lines]);
  const setRows = useMemo(() => {
    return setPool
      .filter((l) => keepSetLine(l, { kind: setKind, unhitOnly, query: setQuery }))
      .sort((a, b) =>
        setSort === "name"
          ? a.name.localeCompare(b.name)
          : setSort === "price"
          ? (b.market || 0) - (a.market || 0)
          // What is still on the table, biggest first: a $30 card with two
          // copies left outranks a $40 card that has already been hit. Price
          // sorts by the card, this sorts by the prize pool.
          : setSort === "hitValue"
          ? Math.max((b.qty || 0) - (b.qtyHit || 0), 0) * (b.market || 0) -
            Math.max((a.qty || 0) - (a.qtyHit || 0), 0) * (a.market || 0)
          // Slot order, so the set always reads the way the binder is filed no
          // matter what order the cards were added in. Sealed product and
          // unfiled cards have no slot and sort to the end, by name, rather
          // than all colliding at zero.
          : (a.slot ?? Number.MAX_SAFE_INTEGER) - (b.slot ?? Number.MAX_SAFE_INTEGER)
            || a.name.localeCompare(b.name),
      );
  }, [setPool, setQuery, setKind, unhitOnly, setSort]);

  const setCounts = useMemo(() => ({
    shown: setRows.length,
    all: setPool.length,
    units: setRows.reduce((a, l) => a + (l.qty || 0), 0),
    left: setRows.reduce((a, l) => a + Math.max((l.qty || 0) - (l.qtyHit || 0), 0) * (l.market || 0), 0),
    hasSingles: setPool.some((l) => !!l.singleRecId),
    hasSealed: setPool.some((l) => !l.singleRecId),
  }), [setRows, setPool]);
  const setFiltered = !!setQuery.trim() || setKind !== "all" || unhitOnly;

  // The table draws this: copies of one card collapse to a single row, and the
  // members slot back in underneath when it is opened. Flattened here so the
  // row markup below stays one map over one list.
  //
  // A filtered table never collapses. Searching for a card and being handed a
  // folded group containing it would hide the one thing that was asked for.
  const setFlat = useMemo(() => {
    const out: { type: "group" | "line"; g?: any; l?: any; nested?: boolean }[] = [];
    for (const g of groupSetRows(setRows as any[], setFiltered ? Number.MAX_SAFE_INTEGER : 3)) {
      if (g.kind === "line") { out.push({ type: "line", l: g.line, nested: false }); continue; }
      out.push({ type: "group", g });
      if (openGroups.has(g.key)) for (const l of g.lines) out.push({ type: "line", l, nested: true });
    }
    return out;
  }, [setRows, setFiltered, openGroups]);
  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  if (loadErr) {
    return (
      <main className="max-w-2xl mx-auto p-6">
        <div className="card p-6 text-dim">{loadErr} <Link className="text-foil ml-2" href="/dashboard">Back to my streams</Link></div>
      </main>
    );
  }
  if (!data) return <main className="max-w-6xl mx-auto p-6 text-dim">Loading stream...</main>;
  const { stream, canManage, timeEntries } = data;
  // Surprise Sets can mix sealed and singles on one wheel. Single Streams are
  // singles only; Character Breaks stay sealed only.
  const mixedSet = (stream.streamType || "Surprise Set") === "Surprise Set";
  const pickingSingles = stream.streamType === "Single Stream" || (mixedSet && addFrom === "singles");

  async function addLine(item: PickerItem, qty: number) {
    setBusy(true);
    const res = await fetch("/api/lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamId: id, productId: item.id, qty }),
    });
    if (!res.ok) toast((await res.json().catch(() => ({}))).error || "Could not add that product", "bad");
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
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    const res = await fetch("/api/lines/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamId: id, items }),
      keepalive: true,
    }).finally(() => window.removeEventListener("beforeunload", guard));
    const d = await res.json();
    if (!res.ok) { setPasteMsg(d.error || "Bulk add failed"); toast(d.error || "Bulk add failed", "bad"); }
    else {
      // `failed` is the honest half of a bulk add. The route checks the whole
      // paste before writing anything, so a line that fails here failed on the
      // way to Airtable, and the old message would have counted it as added.
      const failed: string[] = d.failed || [];
      let msg = `Added ${d.added.length} item${d.added.length === 1 ? "" : "s"}`;
      if (failed.length) msg += ` - ${failed.length} did not save: ${failed.join(", ")}. Paste just those again.`;
      setPasteMsg(msg);
      if (failed.length) toast(`${failed.length} of ${d.added.length + failed.length} lines did not save`, "bad");
      // Only clear the box on a clean run. Clearing it after a partial failure
      // throws away the one copy of the list that says what still needs adding.
      if (!failed.length) setPasteText("");
    }
    await load();
    setBusy(false);
  }

  async function removeLine(lineId: string) {
    if (removingRef.current.has(lineId)) return;
    removingRef.current.add(lineId);
    setBusy(true);
    try {
      // Removing a line moves stock. Unchecked, a refusal (a closed stream, or
      // a non-manager) looked exactly like a removal that worked, except the
      // row was still there after the reload.
      const r = await fetch(`/api/lines/${lineId}`, { method: "DELETE" }).catch(() => null);
      if (!r || !r.ok) {
        const d = r ? await r.json().catch(() => ({})) : {};
        toast(d.error || "Could not remove that line", "bad");
      }
      await load();
    } finally {
      removingRef.current.delete(lineId);
      setBusy(false);
    }
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

  // Reprice every copy of a card at once. Copies share a comp, so repricing a
  // run of 23 was 23 identical edits, and any one of them missed left the run
  // disagreeing with itself.
  function setMarketMany(lineIds: string[], market: number) {
    const cfg = data?.config || { hitThreshold: 10 };
    const mkt = Math.max(0, market);
    const ids = new Set(lineIds);
    setLines((prev) =>
      prev.map((l) => (ids.has(l.id) ? { ...l, market: mkt, isHit: !l.isGiveaway && mkt > cfg.hitThreshold } : l)),
    );
    for (const id of lineIds) {
      fetch(`/api/lines/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market: mkt }),
      }).catch(() => {});
    }
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

  // Quantity on a show-set line.
  //
  // This used to disable the whole toolbar, PATCH, and then re-read the entire
  // stream: the show set, the settings, the delivery-rate history and every
  // product in the base. Building a wheel is dozens of these in a row, so the
  // one control you press most was the slowest thing on the page.
  //
  // Optimistic like setHit above, with two differences, both because this one
  // moves physical stock rather than a counter:
  //
  // The server can legitimately refuse. It rejects going below the hits already
  // recorded, and it rejects pulling more than is on the shelf, and the message
  // it returns names the product and the shortfall. So the failure path puts
  // the old number back and shows what the server said, rather than leaving a
  // quantity on screen that nothing in the building agrees with.
  //
  // Requests are chained per line. The route reads the current qty to work out
  // the inventory delta, so two taps arriving out of order would restock the
  // wrong amount. Chaining keeps a fast double-tap correct without blocking the
  // button, which is the entire point of the change.
  function adjustQty(line: LineT, delta: number) {
    const from = line.qty;
    const to = from + delta;
    if (to < Math.max(1, line.qtyHit || 0)) return;
    setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, qty: to } : l)));

    const prior = qtyChain.current[line.id] ?? Promise.resolve();
    const next = prior
      .catch(() => {})
      .then(async () => {
        const r = await fetch(`/api/lines/${line.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qty: to }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, qty: from } : l)));
          toast(d.error || "Could not change the quantity", "bad");
        }
      })
      .catch(() => {
        setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, qty: from } : l)));
        toast("Could not reach the server - the quantity was put back", "bad");
      });
    qtyChain.current[line.id] = next;
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
    const res = await fetch(`/api/streams/${id}/return`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Only the lines still on the return list. A card whose line has since
      // been hit is gone and holding it would be meaningless.
      body: JSON.stringify({ holdLineIds: returnableSingles.filter((l) => holdOut.has(l.id)).map((l) => l.id) }),
    });
    const d = await res.json();
    if (!res.ok) setReturnMsg(d.error || "Return failed");
    else {
      const bits = [`Returned ${d.itemsReturned} sealed item${d.itemsReturned === 1 ? "" : "s"}`];
      if (d.singlesReturned) bits.push(`${d.singlesReturned} card${d.singlesReturned === 1 ? "" : "s"} back in stock`);
      if (d.singlesHeld) bits.push(`${d.singlesHeld} held out for the next show`);
      setReturnMsg(bits.join(", "));
    }
    setReturnArmed(false);
    await load();
    setBusy(false);
  }

  async function saveResults(markComplete: boolean) {
    setBusy(true);
    setResultsErr("");
    const res = await fetch(`/api/streams/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        afterFees: parseFloat(form.afterFees) || 0,
        promotion: parseFloat(form.promotion) || 0,
        shippingAdjustments: parseFloat(form.shippingAdjustments) || 0,
        tips: parseFloat(form.tips) || 0,
        spotsSold: parseInt(form.spotsSold) || 0,
        giveaways: parseInt(form.giveaways) || 0,
        singlesGiveaways: parseInt(form.singlesGiveaways) || 0,
        ...(markComplete ? { status: "Complete" } : {}),
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setResultsErr(d.error || "Could not save");
      setBusy(false);
      return;
    }
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
  // shipping Whatnot re-bills after the show; not in After Fees
  const shipAdjNum = parseFloat(form.shippingAdjustments) || 0;
  const tipsNum = parseFloat(form.tips) || 0;
  const giveawaysNum = parseInt(form.giveaways) || 0;
  const singlesGivvyNum = parseInt(form.singlesGiveaways) || 0;
  const resultsEntered = afterFeesNum > 0;

  // ---- the stream P&L waterfall ----
  // Product that was not hit goes back into inventory, so it is not a cost of
  // this stream. What the stream "sold" is the hits that went out plus the
  // giveaways it spent.
  const giveawaySpend = giveawaysNum * (data?.config?.giveawayCost || 0)
    + singlesGivvyNum * (data?.config?.singlesGiveawayCost || 0);
  const productSold = m.hitValueDelivered + giveawaySpend;
  const productBack = Math.max(0, m.totalValue - m.hitValueDelivered - m.givvyValue);
  const grossProfit = afterFeesNum - productSold - m.storeMarket;

  const packingPay = data?.pay ? ((stream?.packingHours || 0) + (stream?.managerPackingHours || 0)) * data.pay.packingRate : 0;
  // streaming labor at the streamer's hourly rate. Weekly settlement pays the
  // higher of hourly or commission, so this is the floor of true labor cost.
  const streamPay = data?.pay?.hourlyRate ? (stream?.hours || 0) * data.pay.hourlyRate : 0;
  const netProfit = grossProfit - streamPay - packingPay - promoNum - shipAdjNum;
  const buyNet = m.hitCostDelivered !== null
    ? afterFeesNum - (m.hitCostDelivered + giveawaySpend + (m.storeBuy || 0)) - streamPay - packingPay - promoNum - shipAdjNum
    : null;

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Link href={isAdmin ? "/admin/streams" : "/dashboard"} className="text-dim text-sm hover:text-body">
            &larr; {isAdmin ? "All streams" : "My streams"}
          </Link>
          {editingMeta ? (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <input className="input !py-1.5 text-lg font-bold w-72" value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} />
              <input type="date" className="input !py-1.5" value={metaDate} onChange={(e) => setMetaDate(e.target.value)} />
              {teamOptions.length > 0 && (
                <>
                  <select className="input !py-1.5" value={metaStreamer} onChange={(e) => setMetaStreamer(e.target.value)} title="Streamer">
                    {teamOptions.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <select className="input !py-1.5" value={metaManager} onChange={(e) => setMetaManager(e.target.value)} title="Packaging person">
                    <option value="">No packaging person</option>
                    {teamOptions.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} - packaging</option>
                    ))}
                  </select>
                </>
              )}
              <button
                className="btn-win !py-1.5 text-sm disabled:opacity-40"
                disabled={busy || !metaTitle.trim() || !metaDate}
                onClick={async () => {
                  setBusy(true);
                  const r = await fetch(`/api/streams/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: metaTitle.trim(), date: metaDate, ...(metaStreamer && metaStreamer !== stream.streamerRecId ? { streamerId: metaStreamer } : {}), ...(metaManager !== (stream.managerRecId || "") ? { managerId: metaManager || null } : {}) }) });
                  setBusy(false);
                  if (r.ok) { setEditingMeta(false); await load(); }
                }}
              >
                Save
              </button>
              <button className="btn-ghost !py-1.5 text-sm" onClick={() => setEditingMeta(false)}>Cancel</button>
            </div>
          ) : (
            <h1 className="t-page mt-1">
              {stream.title}
              {canManage && (
                <button
                  className="text-dim hover:text-foil text-sm ml-2 align-middle"
                  title="Rename or move this show"
                  onClick={async () => {
                    setMetaTitle(stream.title || ""); setMetaDate(stream.date || "");
                    setMetaStreamer(stream.streamerRecId || ""); setMetaManager(stream.managerRecId || ""); setEditingMeta(true);
                    try {
                      const r = await fetch("/api/streamers");
                      if (r.ok) {
                        const d = await r.json();
                        setTeamOptions((d.streamers || []).map((p: any) => ({ id: p.id, name: p.name })));
                      }
                    } catch {}
                  }}
                >
                  edit
                </button>
              )}
            </h1>
          )}
          <span className={`text-sm ${stream.status === "Complete" ? "text-win" : "text-foil"}`}>
            {stream.status}
          </span>
          <span className="text-dim text-sm ml-3 border border-edge rounded-full px-3 py-0.5">
            {stream.streamType || "Surprise Set"}
          </span>
          {stream.managerName && (
            <span className="text-dim text-sm ml-3">Packaging: {stream.managerName}</span>
          )}
        </div>
        <CopyShowSet lines={(lines as any[]).filter((l) => !l.isStore).map((l) => ({ qty: l.qty, name: l.name, market: l.market, isHit: l.isHit }))} streamTitle={stream.title || "show-set"} />
      </div>

      {(stream.status === "Planned" || stream.status === "Live") && !stream.itemsReturned && (
        <section className="card p-4 flex items-center gap-3 flex-wrap border-win/40">
          {stream.status === "Live" ? (
            <>
              <span className="text-win font-semibold text-sm">This stream is LIVE</span>
              <a className="btn-win !py-1.5" href={`/streams/${id}/live`}>Open live mode</a>
            </>
          ) : (
            <>
              <span className="text-dim text-sm">Going live? Start the stream to clock in and open the focused show view.</span>
              <button
                className="btn-win !py-1.5 disabled:opacity-40"
                disabled={busy}
                // The most time-critical tap in the app: they are already live
                // on Whatnot when they press it. It had no failure branch at
                // all, so a dropped request looked exactly like a button that
                // does nothing, with no way to tell whether the clock started.
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await fetch(`/api/streams/${id}/live`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) });
                    if (r.ok) { window.location.href = `/streams/${id}/live`; return; }
                    const d = await r.json().catch(() => ({}));
                    toast(d.error || "Could not start the stream - tap again", "bad");
                  } catch {
                    toast("Could not start the stream - check your signal and tap again", "bad");
                  }
                  setBusy(false);
                }}
              >
                Start stream
              </button>
            </>
          )}
        </section>
      )}
      {stream.status === "Review" && (
        <section className="card p-4 flex items-center gap-3 flex-wrap border-givvy/40">
          <span className="text-givvy font-semibold text-sm">Stream ended - hits need review and submission</span>
          <a className="btn-ghost !py-1.5" href={`/streams/${id}/live`}>Review and submit</a>
        </section>
      )}
      {stream.status === "Submitted" && (
        <section className="card p-4 flex items-center gap-3 flex-wrap border-foil/40">
          <span className="text-foil font-semibold text-sm">Submitted - awaiting approval</span>
          {canManage ? (
            <>
              <span className="text-dim text-sm">Re-check the hit tracker below, then approve. Approval returns unhit items to inventory and marks the stream approved for payroll.</span>
              <button
                className="btn-win !py-1.5 disabled:opacity-40"
                disabled={busy}
                onClick={async () => {
                  const r = await fetch(`/api/streams/${id}/live`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve" }) });
                  const d = await r.json().catch(() => ({}));
                  if (!r.ok) { setResultsErr(d.error || "could not approve"); return; }
                  await load();
                }}
              >
                Approve stream
              </button>
            </>
          ) : (
            <span className="text-dim text-sm">A manager will review and approve.</span>
          )}
        </section>
      )}

      {/* Stream P&L: product that was not hit goes back to inventory, so the
          stream is only charged for what actually left the building */}
      <section className="card p-5 border-foil/40">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div className="label">Stream P&L - live</div>
          {canManage && (
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-dim text-xs">Sales so far $</label>
              <input
                type="number" step="0.01" className="input !w-28 !py-1"
                value={form.afterFees}
                onChange={(e) => setForm({ ...form, afterFees: e.target.value })}
                placeholder="0.00"
              />
              <label className="text-dim text-xs">Spins sold</label>
              <input
                type="number" step="1" min={0} className="input !w-20 !py-1"
                value={form.spotsSold}
                onChange={(e) => setForm({ ...form, spotsSold: e.target.value })}
                placeholder="0"
              />
              <SaveChip state={saveState} />
            </div>
          )}
        </div>
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
              <span className="text-dim">Giveaways spent ({giveawaysNum} pack{singlesGivvyNum > 0 ? ` + ${singlesGivvyNum} single${singlesGivvyNum === 1 ? "" : "s"}` : ""}{m.givvyQty > 0 ? ` + ${m.givvyQty} in set` : ""})</span>
              <span className="num">{$(giveawaySpend)}</span>
            </div>
            <div className="flex justify-between gap-6 border-t border-edge pt-1.5 font-semibold">
              <span>Product sold this show</span>
              <span className="num">{$(productSold)}</span>
            </div>

            {/* What the product at the top is made of. Worth its own two lines
                because singles and sealed restock completely differently: a
                show that is mostly cards needs the binder pulled and repriced
                before the next one, and a glance here says which kind of show
                this was without counting the set by hand. */}
            <div className="pt-4 space-y-1.5">
              <div className="text-dim text-xs">What the product at start is made of</div>
              <div className="flex justify-between gap-6">
                <span className="text-dim">
                  Singles value
                  {m.kinds.singlesQty > 0 && (
                    <span className="text-dim/60"> ({m.kinds.singlesQty} card{m.kinds.singlesQty === 1 ? "" : "s"})</span>
                  )}
                </span>
                <span className="num">{$(m.kinds.singlesValue)}</span>
              </div>
              <div className="flex justify-between gap-6">
                <span className="text-dim">
                  Sealed value
                  {m.kinds.sealedQty > 0 && (
                    <span className="text-dim/60"> ({m.kinds.sealedQty} item{m.kinds.sealedQty === 1 ? "" : "s"})</span>
                  )}
                </span>
                <span className="num">{$(m.kinds.sealedValue)}</span>
              </div>
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
            {m.storeCount > 0 && (
              <div className="flex justify-between gap-6">
                <span className="text-dim">Store purchases ({m.storeCount}) - sold {$(m.storeSales)}</span>
                <span className="num">-{$(m.storeMarket)}</span>
              </div>
            )}
            {m.storeCount > 0 && (
              <div className="flex justify-between gap-6">
                <span className="text-dim">Additional profit over market</span>
                <span className={`num ${m.storeSales - m.storeMarket >= 0 ? "text-win" : "text-bad"}`}>
                  {m.storeSales - m.storeMarket >= 0 ? "+" : ""}{$(m.storeSales - m.storeMarket)}
                </span>
              </div>
            )}
            <div className="flex justify-between gap-6 border-t border-edge pt-1.5 font-semibold">
              <span>Gross profit</span>
              <span className={`num ${!resultsEntered ? "text-dim" : grossProfit >= 0 ? "text-win" : "text-bad"}`}>
                {resultsEntered ? $(grossProfit) : "-"}
              </span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-dim">Streaming time ({(stream?.hours || 0).toFixed(1)}h hourly est)</span>
              <span className="num">-{$(streamPay)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-dim">Packing time</span>
              <span className="num">-{$(packingPay)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-dim">Promotion</span>
              <span className="num">-{$(promoNum)}</span>
            </div>
            {shipAdjNum > 0 && (
              <div className="flex justify-between gap-6">
                <span className="text-dim">Shipping adjustments</span>
                <span className="num">-{$(shipAdjNum)}</span>
              </div>
            )}
            <div className="flex justify-between gap-6 border-t border-edge pt-1.5">
              <span className="font-bold">Stream profit</span>
              <span className={`num text-xl font-bold ${!resultsEntered ? "text-dim" : netProfit >= 0 ? "text-win" : "text-bad"}`}>
                {resultsEntered ? $(netProfit) : "-"}
              </span>
            </div>
            {!resultsEntered && (
              <div className="text-dim text-xs">
                {canManage ? "type sales up top as they come in - every number here updates live, and marking a hit updates it too" : "updates live once sales are entered"}
              </div>
            )}
            {resultsEntered && spotsSoldNum > 0 && (
              <div className="text-dim text-xs num text-right">
                {$((afterFeesNum - m.storeSales) / spotsSoldNum)} avg per spin - {$((netProfit - (m.storeSales - m.storeMarket)) / spotsSoldNum)} profit per spin so far
              </div>
            )}
            {m.unpricedQty > 0 && (
              <div className="text-xs text-warn text-right">
                {m.unpricedQty} items in this set have no price - set value and break even are understated. Set a per-item price on those lines in the set builder.
              </div>
            )}
            {m.spots > 0 && (() => {
              const costBE = data?.config?.costBreakEvenPerSpot ?? null;
              const primary = costBE ?? m.breakEven;
              const under = resultsEntered && spotsSoldNum > 0 && afterFeesNum / spotsSoldNum < primary;
              return (
                <>
                  <div className={`text-xs num text-right ${under ? "text-warn font-semibold" : "text-dim"}`}>
                    break even: {$(primary)} per spin ({m.cfg.breakevenMult}x average spin {costBE === null ? "value" : "cost"})
                    {under && " - current avg is under it"}
                  </div>
                  {costBE === null && (data?.config?.costMissingQty ?? 0) > 0 && (
                    <div className="text-warn/80 t-meta text-right">
                      market basis for now - {data.config.costMissingQty} items are missing a buy cost, so the true 1.5x cost basis cannot be computed yet
                    </div>
                  )}
                  {costBE !== null && (
                    <div className="text-dim t-meta num text-right">
                      on market value instead: {$(m.breakEven)} per spin
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
        <div className="text-dim text-xs mt-3">
          Stream time: {stream.hours ? `${stream.hours}h streamed` : "no hours logged"}
          {(stream.packingHours || 0) > 0 && ` + ${stream.packingHours}h packing`}
          {(stream.managerPackingHours || 0) > 0 && ` + ${stream.managerPackingHours}h manager packing`}
        </div>
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
        canAssign={canManage}
        people={(team.length ? team : [
          stream.streamerRecId ? { id: stream.streamerRecId, name: stream.streamerName || "Streamer" } : null,
          stream.managerRecId ? { id: stream.managerRecId, name: (stream.managerName || "Packaging") + " (packaging)" } : null,
        ].filter(Boolean)) as { id: string; name: string }[]}
      />

      {/* Everything that happens after the show, folded away.
          This page is used in three different moods - building a set, running
          a show, and settling up afterwards - and only the last one needs the
          earnings boxes, the Whatnot uploads and the store sales. Left open
          they push the show set itself below the fold on every visit, so they
          collapse, and the page remembers which way you left it. */}
      <section className="card !p-0 overflow-hidden">
        <button
          type="button"
          className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-edge/30"
          onClick={() => setManageOpen((v) => !v)}
          aria-expanded={manageOpen}
        >
          <span className="label !mb-0">Manage show</span>
          <span className="flex items-center gap-3">
            <span className="text-dim text-xs">
              {manageOpen ? "hide" : "earnings, Whatnot uploads, store sales"}
            </span>
            <span className={`text-dim transition-transform ${manageOpen ? "rotate-180" : ""}`} aria-hidden>
              v
            </span>
          </span>
        </button>
      </section>

      {manageOpen && (
        <>
      {/* Post-stream results */}
      <section className="card p-5 space-y-4">
        <h2 className="label">After the stream</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {field("afterFees", "After fees ($)")}
          {field("promotion", "Promotion ($)")}
          {field("tips", "Tips ($)")}
          {field("shippingAdjustments", "Shipping adjustments ($)")}
          {field("spotsSold", "Spots sold (spins)", "1")}
          <div>
            {field("giveaways", "Pack givvies run", "1")}
            {(parseInt(form.giveaways) || 0) > 0 && (
              <p className="text-dim text-xs mt-1">
                {parseInt(form.giveaways) || 0} x {$(m.cfg.giveawayCost ?? 2.5)} = <span className="text-bad">-{$((parseInt(form.giveaways) || 0) * (m.cfg.giveawayCost ?? 2.5))}</span> from profit
              </p>
            )}
          </div>
          <div>
            {field("singlesGiveaways", "Singles givvies", "1")}
            {singlesGivvyNum > 0 && (
              <p className="text-dim text-xs mt-1">
                {singlesGivvyNum} x {$(m.cfg.singlesGiveawayCost ?? 1)} = <span className="text-bad">-{$(singlesGivvyNum * (m.cfg.singlesGiveawayCost ?? 1))}</span> from profit
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-3 items-center flex-wrap">
          <SaveChip state={saveState} />
          {canManage && (
            <button className="btn-win disabled:opacity-40" disabled={busy} onClick={() => saveResults(true)}>
              Save and mark complete
            </button>
          )}
          {isAdmin && (
            <>
              <label className="flex items-center gap-2 text-sm text-dim cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!stream.overrideExcluded}
                onChange={async (e) => {
                  const r = await fetch(`/api/streams/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ overrideEligible: e.target.checked }) }).catch(() => null);
                  if (!r || !r.ok) toast("Could not change whether this show counts toward the override", "bad");
                  await load();
                }}
              />
              Counts toward packing override
            </label>
              <label className="flex items-center gap-2 text-sm text-dim" title="Who earns the commission override on this show. Independent of who packed it.">
                Override earned by
                <select
                  className="input !py-1 !w-40"
                  value={stream.overrideRecId || ""}
                  disabled={busy}
                  onChange={async (e) => {
                    setBusy(true);
                    // Who earns the override is a payroll field.
                    const r = await fetch(`/api/streams/${id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ overrideRecId: e.target.value || null }),
                    }).catch(() => null);
                    setBusy(false);
                    if (!r || !r.ok) toast("Could not change who earns the override - it is unchanged", "bad");
                    await load();
                  }}
                >
                  <option value="">nobody</option>
                  {team.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          {resultsErr && <span className="text-bad text-sm">{resultsErr}</span>}
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
            <>
              <span className="flex items-center gap-2 flex-wrap">
                <span className="text-givvy text-sm">
                  {(() => {
                    const sealed = lines.reduce(
                      (a, l) => a + (l.singleRecId ? 0 : Math.max(l.qty - l.qtyHit, 0)),
                      0,
                    );
                    const cardsBack = returnableSingles.length - heldCount;
                    const parts = [`${sealed} sealed item${sealed === 1 ? "" : "s"}`];
                    if (returnableSingles.length) parts.push(`${cardsBack} card${cardsBack === 1 ? "" : "s"}`);
                    return `Put ${parts.join(" and ")} back in stock?`;
                  })()}
                  {heldCount > 0 && ` ${heldCount} card${heldCount === 1 ? "" : "s"} stay out.`}
                  {" "}Hits must be final - this locks the show set.
                </span>
                <button className="btn-win" disabled={busy} onClick={returnItems}>Yes, return</button>
                <button className="btn-ghost" onClick={() => setReturnArmed(false)}>Cancel</button>
              </span>
              {/* The checklist opens under the confirm, so the default path is
                  still one click and picking cards is the deliberate detour. */}
              <ReturnSingles
                cards={returnableSingles.map((l) => ({
                  id: l.id,
                  name: l.name,
                  qty: l.qty,
                  qtyHit: l.qtyHit,
                  market: l.market,
                  image: l.image,
                  slot: l.slot ?? null,
                }))}
                hold={holdOut}
                onChange={setHoldOut}
              />
            </>
          )}
          {returnMsg && <span className="text-win text-sm">{returnMsg}</span>}
          <span className="text-dim text-xs">
            Hours come from the timeclock above. Pay settles weekly: profit is netted first, then you get
            the higher of hourly or commission.
          </span>
        </div>
      </section>

      {/* Live hit tracker - updates the instant a hit is marked */}
      <section className="card p-5 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <div>
          <div className="label">Total product hit so far</div>
          <div className="text-3xl font-bold num text-foil">{$(m.hitValueDelivered)}</div>
          <div className="text-dim text-xs num">{m.hitsDelivered} of {m.hitPoolQty} hits out</div>
        </div>
        <div>
          <div className="label">Items hit</div>
          <div className="text-3xl font-bold num text-win">{m.itemsHit}<span className="text-dim text-base font-normal"> / {m.itemsTotal}</span></div>
        </div>
        <div>
          <div className="label">Hit value remaining</div>
          <div className="text-xl font-bold num">{$(m.hitValueRemaining)}</div>
        </div>
        {(() => {
          const hitsLeft = Math.max(m.hitPoolQty - m.hitsDelivered, 0);
          const spotsLeft = spotsSoldNum > 0 ? Math.max(m.spots - spotsSoldNum, 0) : m.spots;
          const odds = spotsLeft > 0 ? (hitsLeft / spotsLeft) * 100 : 0;
          return (
            <div>
              <div className="label">% chance of a hit</div>
              <div className={`text-xl font-bold num ${odds > 0 ? "text-win" : "text-dim"}`}>
                {spotsLeft > 0 ? `${Math.min(odds, 100).toFixed(1)}%` : "-"}
              </div>
              <div className="text-dim text-xs num">
                {hitsLeft} hits in {spotsLeft} spins left{spotsSoldNum === 0 ? " (base odds)" : ""}
              </div>
            </div>
          );
        })()}
        {m.hitCostDelivered !== null && (
          <div>
            <div className="label">Cost of hits out (admin)</div>
            <div className="text-xl font-bold num">{$(m.hitCostDelivered)}</div>
          </div>
        )}
        {spotsSoldNum > 0 && afterFeesNum > 0 && (
          <div>
            <div className="label">Avg spin value</div>
            <div className="text-xl font-bold num text-foil">{$(afterFeesNum / spotsSoldNum)}</div>
          </div>
        )}
      </section>

      {/* Whatnot show report: fills in hits, spots sold and giveaways */}
      <WhatnotSync
        streamId={id}
        streamTitle={stream.title || ""}
        streamDate={stream.date || ""}
        streamerName={stream.streamerName || ""}
        closed={!!stream.itemsReturned}
        lines={(lines as any[]).map((l) => ({ id: l.id, name: l.name, qty: l.qty, qtyHit: l.qtyHit, isStore: !!l.isStore, isGiveaway: !!l.isGiveaway }))}
        current={{ spotsSold: stream.spotsSold ?? null, giveaways: stream.giveaways ?? null, singlesGiveaways: stream.singlesGiveaways ?? null }}
        onFile={setWhatnotFile}
        onApplied={load}
      />

      {/* Store sales: bought off the shelf, kept apart from the show set */}
      <StoreSales
        sharedFile={whatnotFile}
        streamId={id}
        streamTitle={stream.title || ""}
        streamDate={stream.date || ""}
        streamerName={stream.streamerName || ""}
        closed={!!stream.itemsReturned}
        canManage={!!data?.canManage}
        lines={(lines as any[]).filter((l) => l.isStore)}
        onChange={load}
      />

        </>
      )}

      {/* Show set builder */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="label">Show set</h2>
            <div className="flex gap-1 t-meta">
              {([["board", "Slot"], ["name", "A-Z"], ["price", "Price"], ["hitValue", "Hit value"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setSetSort(k)}
                  className={`px-2 py-0.5 rounded border ${setSort === k ? "border-foil text-foil" : "border-edge text-dim hover:text-paper"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {!pickingSingles && (
            <button className="text-foil text-xs hover:underline" onClick={() => setShowPaste(!showPaste)}>
              {showPaste ? "Hide paste" : "Paste a list"}
            </button>
          )}
        </div>
        {mixedSet && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-dim">Add from</span>
            <div className="inline-flex rounded-lg border border-edge overflow-hidden">
              {([["sealed", "Sealed"], ["singles", "Singles"]] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => { setAddFrom(k); if (k === "singles") setShowPaste(false); }}
                  className={`px-3 py-1 ${addFrom === k ? "bg-foil/15 text-foil" : "text-dim hover:text-paper"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {!pickingSingles && <ProductPicker onAdd={addLine} busy={busy} />}
        {pickingSingles && (
          <>
            {/* Before picking cards one at a time, the set from the last show
                that did not sell out is usually most of what belongs here. */}
            {!stream.itemsReturned && <RollSingles streamId={id} onRolled={load} />}
            <SinglesPicker streamId={id} onAdded={load} busy={busy} />
          </>
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
                {pasteText.trim() ? `Add pasted list (${parsePaste(pasteText).length} items)` : "Add pasted list"}
              </button>
              {pasteMsg && <span className="text-dim text-xs">{pasteMsg}</span>}
            </div>
            <p className="text-dim text-xs">
              Accepts Name + Qty columns from Excel, or lines like "4x Topps Pack". Names are matched
              against inventory; anything unknown gets created as a new product (admin) for you to price.
            </p>
          </div>
        )}
        {/* The OBS link lives here as well as on the live page, because OBS gets
            set up while the set is being built, not once the show has started. */}
        <CardBoard
          streamId={id}
          lines={(lines as any[]).filter((l) => !l.isStore)}
          onChanged={load}
        />
        {/* Ask the set a question rather than scrolling it. Hidden on a short
            set, where the controls would cost more room than they save. */}
        {setPool.length > 8 && (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={setQuery}
              onChange={(e) => setSetQuery(e.target.value)}
              placeholder="Filter the set - number, name or set"
              aria-label="Filter the show set"
              className="input !py-1 !w-60 text-sm"
            />
            {/* Labelled, because "Add from" above has its own Singles and
                Sealed buttons and two unlabelled pairs on one page that do
                different things is a trap. That one picks what the add box
                searches; this one picks what the table below shows. */}
            {setCounts.hasSingles && setCounts.hasSealed && (
              <span className="t-meta text-dim">Showing</span>
            )}
            {setCounts.hasSingles && setCounts.hasSealed && (
              <div className="inline-flex rounded-lg border border-edge overflow-hidden t-meta">
                {([["all", "All"], ["singles", "Singles"], ["sealed", "Sealed"]] as const).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setSetKind(k)}
                    className={`px-3 py-1 ${setKind === k ? "bg-foil/15 text-foil" : "text-dim hover:text-paper"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setUnhitOnly((v) => !v)}
              title="Hide anything already fully hit"
              className={`px-3 py-1 rounded-lg border t-meta ${unhitOnly ? "border-foil text-foil" : "border-edge text-dim hover:text-paper"}`}
            >
              Still live
            </button>
            {setFiltered && (
              <button
                className="t-meta text-foil hover:underline"
                onClick={() => { setSetQuery(""); setSetKind("all"); setUnhitOnly(false); }}
              >
                clear
              </button>
            )}
            <span className="t-meta text-dim ml-auto num">
              {setCounts.shown === setCounts.all ? `${setCounts.all} lines` : `${setCounts.shown} of ${setCounts.all} lines`}
              {`, ${setCounts.units} units, ${$(setCounts.left)} still live`}
            </span>
          </div>
        )}
        <div className="overflow-x-auto">
          {/* Tighter rows: the set is the longest table in the app and every
              pixel of padding is another flick of the wheel on a 250 unit show. */}
          <table className="w-full [&_td]:!py-1 [&_th]:!py-1">
            <thead>
              <tr>
                <th>Product</th><th>Qty</th><th>Market</th><th>Hits</th><th>Remain</th><th>Hit value left</th>
                {sellsPerCard(stream) && lines.some((l) => l.singleRecId) && <th>Sale</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {setFlat.map((it: any) => {
                if (it.type === "group") {
                  const g = it.g;
                  const t = groupTotals(g.lines);
                  const open = openGroups.has(g.key);
                  const ids = g.lines.map((x: any) => x.id);
                  const first = g.lines[0];
                  const last = g.lines[g.lines.length - 1];
                  return (
                    <tr key={g.key} className="border-t border-edge/60">
                      <td className="!font-medium">
                        <button
                          type="button"
                          aria-expanded={open}
                          className="flex items-center gap-2 min-w-0 text-left w-full"
                          onClick={() => toggleGroup(g.key)}
                        >
                          <span className="text-dim text-xs w-3 shrink-0">{open ? "-" : "+"}</span>
                          {first.image && <Thumb src={first.image} size={24} className="shrink-0" />}
                          <span className="num text-foil text-xs shrink-0">{g.lines.length}x</span>
                          <span className="truncate max-w-[19rem]" title={first.name}>{withoutCardNo(first.name)}</span>
                          {cardNoOf(first.name) && (
                            <span className="t-meta text-dim shrink-0 tabular-nums">{cardNoOf(first.name)} to {cardNoOf(last.name)}</span>
                          )}
                        </button>
                      </td>
                      <td className="num">{t.qty}</td>
                      <td>
                        {canManage ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number" step="0.01" min={0}
                              className="input !w-24 !py-1"
                              title={t.samePrice ? "Sets the price on every copy" : "These copies are priced differently - saving here sets them all"}
                              value={t.market}
                              onChange={(e) => setMarketMany(ids, parseFloat(e.target.value) || 0)}
                            />
                            {!t.samePrice && <span className="text-warn text-xs">mixed</span>}
                          </div>
                        ) : (
                          $(t.market)
                        )}
                      </td>
                      {/* No hit buttons on a group. A hit is one physical card
                          going to one buyer, so the row opens and the card
                          that actually went gets marked. */}
                      <td className="t-meta text-dim whitespace-nowrap">{t.hit} of {t.qty} hit</td>
                      <td className="num">{t.remain}</td>
                      <td className="num">{$(t.valueLeft)}</td>
                      {sellsPerCard(stream) && lines.some((x) => x.singleRecId) && <td />}
                      <td className="text-right">
                        <button type="button" className="t-meta text-foil hover:underline whitespace-nowrap" onClick={() => toggleGroup(g.key)}>
                          {open ? "collapse" : "show each"}
                        </button>
                      </td>
                    </tr>
                  );
                }
                const l = it.l;
                const nested = it.nested;
                return (
                <tr key={l.id} className={`${l.isGiveaway ? "bg-givvy/5" : ""} ${nested ? "bg-edge/20" : ""}`}>
                  <td className="!font-medium">
                    <div className={`flex items-center gap-2 min-w-0 ${nested ? "pl-5" : ""}`}>
                      {l.image && <Thumb src={l.image} size={24} className="shrink-0" />}
                      {cardNoOf(l.name) && (
                        <span className="num text-dim text-xs shrink-0 tabular-nums">{cardNoOf(l.name)}</span>
                      )}
                      {/* One line, always. A card name that wraps turns a 60
                          row set into 120 rows of scrolling; the full text is
                          still there on hover. */}
                      <span className="truncate max-w-[22rem]" title={l.name}>{withoutCardNo(l.name)}</span>
                      {l.isGiveaway && <span className="text-givvy text-xs shrink-0">giveaway</span>}
                      {l.isHit && <span className="text-foil text-xs font-bold shrink-0">HIT</span>}
                    </div>
                  </td>
                  <td>
                    {canManage && !stream.itemsReturned ? (
                      <span className="inline-flex items-center gap-1">
                        <button
                          className="w-5 h-5 rounded border border-edge text-dim hover:text-body leading-none disabled:opacity-30"
                          disabled={l.qty <= Math.max(1, l.qtyHit || 0)}
                          title="One fewer - the unit goes back to inventory"
                          onClick={() => adjustQty(l, -1)}
                        >
                          -
                        </button>
                        <span className="num min-w-[2ch] text-center">{l.qty}</span>
                        <button
                          className="w-5 h-5 rounded border border-edge text-dim hover:text-body leading-none disabled:opacity-30"
                          title="One more - pulled from inventory"
                          onClick={() => adjustQty(l, 1)}
                        >
                          +
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        {l.qty}
                        {canManage && (
                          <button
                            className="text-dim hover:text-bad text-xs"
                            title="Remove this line - restores its hit quantity to inventory, since the unhit portion already went back with the return"
                            disabled={busy}
                            onClick={async () => {
                              if (!confirm(`Remove ${l.name} from this closed stream? Its ${l.qtyHit || 0} hit unit(s) go back to inventory.`)) return;
                              setBusy(true);
                              const r = await fetch(`/api/lines/${l.id}`, { method: "DELETE" });
                              setBusy(false);
                              if (!r.ok) { const d = await r.json().catch(() => ({})); setReturnMsg(d.error || "could not remove"); return; }
                              await load();
                            }}
                          >
                            remove
                          </button>
                        )}
                      </span>
                    )}
                  </td>
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
                  {sellsPerCard(stream) && lines.some((x) => x.singleRecId) && (
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
                    <button
                      className="text-bad t-meta hover:underline"
                      // The same word, in the same column, confirmed on a closed
                      // stream and did not on an open one. An open show set is the
                      // thing someone is actively building, so this is the version
                      // that gets mis-tapped.
                      onClick={() => {
                        if (confirm(`Remove ${l.name} from this show set? The quantity goes back to inventory.`)) removeLine(l.id);
                      }}
                    >
                      remove
                    </button>
                  </td>
                </tr>
                );
              })}
              {setRows.length === 0 && setPool.length > 0 && (
                <TableEmpty>
                  Nothing on this set matches. <button className="text-foil hover:underline" onClick={() => { setSetQuery(""); setSetKind("all"); setUnhitOnly(false); }}>Show all {setPool.length} lines</button>
                </TableEmpty>
              )}
              {setPool.length === 0 && (
                <TableEmpty>
                  {stream.streamType === "Single Stream"
                    ? "Search the singles inventory above to add auction cards - each starts at $1 on Whatnot"
                    : mixedSet
                      ? "Search sealed or singles above to build the wheel - unhit singles go back to stock when the show closes"
                      : "Search the inventory above to build this stream's show set"}
                </TableEmpty>
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
        <StatTile label="Spots (excl. giveaways)" value={String(m.spots)} size="md" />
        <StatTile label="Giveaways" value={`${m.givvyQty} / ${$(m.givvyValue)}`} tone="givvy" size="md" />
        <StatTile label="Total product value" value={$(m.totalValue)} size="md" />
        <StatTile label="Value per spot" value={m.spots ? $(m.valuePerSpot) : "-"} size="md" />
        <StatTile label="Break even per spin" value={m.spots ? $(data?.config?.costBreakEvenPerSpot ?? m.breakEven) : "-"} tone="win" size="md" note={m.unpricedQty > 0 ? `${m.unpricedQty} unpriced items understate this` : (data?.config?.costBreakEvenPerSpot ?? null) === null && (data?.config?.costMissingQty ?? 0) > 0 ? `market basis - ${data.config.costMissingQty} items missing buy cost` : undefined} />
        <StatTile label={`Hit pool (> $${m.cfg.hitThreshold})`} value={`${m.hitPoolQty} items / ${$(m.hitPoolValue)}`} tone="foil" size="md" />
        <StatTile label="Hit odds per spot" value={m.spots ? (m.hitOddsPerSpot * 100).toFixed(1) + "%" : "-"} tone="foil" size="md" />
        {m.expectedHits !== null ? (
          <StatTile
            label={`Expected hits (history: ${(m.cfg.histDeliveryRate * 100).toFixed(0)}% of pool goes)`}
            value={`~${m.expectedHits} of ${m.hitPoolQty}`}
            tone="foil" size="md"
          />
        ) : (
          <StatTile label="Pool delivered" value={m.hitPoolQty > 0 ? ((m.hitsDelivered / m.hitPoolQty) * 100).toFixed(0) + "%" : "-"} tone="win" size="md" />
        )}
      </section>

    </main>
  );
}

function SaveChip({ state }: { state: "idle" | "saving" | "saved" }) {
  if (state === "idle") return <span className="text-dim text-xs">changes save automatically</span>;
  if (state === "saving") return <span className="text-givvy text-xs">saving...</span>;
  return <span className="text-win text-xs">saved</span>;
}
