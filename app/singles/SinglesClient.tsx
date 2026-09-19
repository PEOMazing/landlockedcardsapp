"use client";
import QRCode from "qrcode";
import { formatCardNo, parseCardNo, bucketFor, bucketRange, bucketDrifted } from "@/lib/cardNo";
import { isThinComp } from "@/lib/salesWindow";
import { useEffect, useMemo, useRef, useState } from "react";
import CompSales from "@/components/CompSales";
import EditCell from "@/components/EditCell";
import DeltaHover from "@/components/DeltaHover";
import { toast } from "@/components/Toaster";
import Thumb from "@/components/Thumb";
import CollectrImport from "@/components/CollectrImport";

const $ = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CONDITIONS = ["NM", "LP", "MP", "HP", "DM", "PSA 10", "PSA 9", "PSA 8", "CGC 10", "CGC 9.5", "BGS 9.5", "Other"];
const GRADED = ["PSA 10", "PSA 9", "PSA 8", "CGC 10", "CGC 9.5", "BGS 9.5", "Other"];
// The ungraded ladder, and the only conditions the row menu offers. A graded
// card's comp is manual by design, so flipping one to PSA 10 from a dropdown
// would silently strip its price with nothing to replace it.
const RAW_CONDITIONS = ["NM", "LP", "MP", "HP", "DM", "Raw"];
const CONDITION_LABELS: Record<string, string> = {
  NM: "NM - Near Mint", LP: "LP - Lightly Played", MP: "MP - Moderately Played",
  HP: "HP - Heavily Played", DM: "DM - Damaged",
};

type SingleT = {
  id: string; cardNo?: number | null; printedBucket?: string; labelPrinted?: string; name: string; setName: string; number: string; cardId: string; location?: string; language?: string;
  rarity: string; variant: string; condition: string; compSales?: number | null;
  comp: number | null; market?: number | null; marketBasis?: string; compSource: string; compDate: string; entryComp: number | null; printing: string;
  compDetail: { date: string; price: number; qty: number }[] | null; tcgProductId: number | null;
  lastSale?: { date: string; price: number } | null;
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

// ---------------- sorting ----------------

type SortKey = "newest" | "cardNo" | "name" | "condition" | "bucket" | "location" | "buy" | "comp" | "qty" | "status" | "salePrice";
type SortDir = "asc" | "desc";

// Columns that read best A to Z on first click. Everything else opens
// biggest-first, because nobody clicks Comp hoping to see the cheap cards.
const TEXTUAL = new Set<SortKey>(["name", "condition", "bucket", "location", "status"]);

// Condition is not alphabetical: NM before LP before MP is the order the
// cards actually rank in, so sort on position in CONDITIONS instead.
const CONDITION_RANK = new Map(CONDITIONS.map((c, i) => [c, i]));

// The value a row sorts on. null means "no value", and the comparator sinks
// those to the bottom in both directions rather than letting blanks lead.
function sortValue(s: SingleT, key: SortKey): string | number | null {
  switch (key) {
    case "cardNo": return s.cardNo ?? null;
    case "name": return s.name || null;
    case "condition": {
      const r = CONDITION_RANK.get(s.condition);
      return r === undefined ? null : r;
    }
    case "bucket": return bucketFor(s.comp) || null;
    case "location": return s.location || null;
    case "buy": return s.buy ?? null;
    case "comp": return s.comp ?? null;
    case "qty": return s.qty ?? null;
    case "status": return s.status || null;
    case "salePrice": return s.salePrice ?? null;
    default: return null;
  }
}

// Market and the most recent real sale, shown under the comp.
//
// Market lags: it is an average over a window, so on a thin vintage card the
// last real sale is often the truer number. Showing only one of them is how a
// card ends up mispriced on a sticker.
//
// "TCG low" is the cheapest live listing for this card's exact printing and
// condition, which is the number you land on after picking a condition on
// their site. It is directly comparable to the comp, so the gap between them
// is meaningful and gets flagged.
//
// One case is not comparable: the fallback where a card had no live listings
// and the price came from the condition-blind mirror instead. marketBasis says
// "any condition" there, and the number is shown greyed and unlabelled as a
// low, because a price that quietly means some other condition is what put the
// comps wrong in the first place.
function PriceContext({
  market, marketBasis, lastSale, comp, condition,
}: {
  market: number | null; marketBasis: string;
  lastSale: { date: string; price: number } | null;
  comp: number | null; condition: string;
}) {
  if (market === null && !lastSale) return null;
  const blind = /any condition/i.test(marketBasis);
  const comparable = market !== null && comp !== null && market > 0 && !blind;
  const gap = comparable ? (comp! - market!) / market! : 0;
  const under = comparable && gap <= -0.2; // comp well under the cheapest listing
  return (
    <div className="text-[10px] text-dim flex items-center gap-2 flex-wrap">
      {market !== null && (
        <span title={marketBasis || "lowest live TCGplayer listing"} className={under ? "text-amber-400" : ""}>
          {blind ? "mkt" : `TCG low ${condition}`} <span className="num">{$(market)}</span>
          {blind && <span className="opacity-60"> any cond.</span>}
          {under && <span className="ml-1">(comp {Math.round(gap * 100)}%)</span>}
        </span>
      )}
      {lastSale && (
        <span title={`Most recent ${condition} sale, ${lastSale.date}`}>
          last {condition} sale <span className="num">{$(lastSale.price)}</span>
        </span>
      )}
    </div>
  );
}

type Health = {
  canary: { ok: boolean; detail: string };
  coverage: { total: number; solds: number; listing: number; estimate: number; manual: number; none: number; conditionSpecific: number; stale: number; oldestHours: number | null };
  healthy: boolean;
  problems: string[];
};

// A standing readout of where the prices came from.
//
// The failure this exists to catch is not a crash, it is a quiet downgrade:
// the listings endpoint stops answering, every comp falls back to a blended
// number, and nothing looks broken. Coverage makes that visible as a number
// that moves. It loads on its own so nobody has to think to check it.
function PricingHealth({ isManager }: { isManager: boolean }) {
  const [h, setH] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);

  async function check(force = false) {
    setChecking(true);
    try {
      const r = await fetch(`/api/singles/pricing-health${force ? "?force=1" : ""}`);
      if (r.ok) setH(await r.json());
    } catch {
      // a health widget that breaks the page it is reporting on would be a joke
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => { if (isManager) check(false); }, [isManager]);

  if (!isManager || !h) return null;
  const c = h.coverage;
  const priced = c.total - c.none;
  const pct = priced > 0 ? Math.round((c.conditionSpecific / priced) * 100) : 0;

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs flex items-start gap-3 flex-wrap ${
      h.healthy ? "border-edge text-dim" : "border-givvy/60 bg-givvy/10 text-body"
    }`}>
      <div className="flex-1 min-w-[16rem]">
        <span className={h.canary.ok ? "text-win font-semibold" : "text-bad font-semibold"}>
          {h.canary.ok ? "Condition pricing live" : "Condition pricing DOWN"}
        </span>
        <span className="text-dim"> - {pct}% of priced cards use data for their own condition </span>
        {c.oldestHours !== null && (
          <span className="text-dim opacity-80">- every card repriced within {c.oldestHours}h </span>
        )}
        <span className="text-dim opacity-80">
          ({c.solds} from sales, {c.listing} from listings, {c.estimate} estimated, {c.manual} hand-set
          {c.none > 0 ? `, ${c.none} unpriced` : ""})
        </span>
        {h.problems.map((p, i) => (
          <div key={i} className="text-givvy mt-1">{p}</div>
        ))}
      </div>
      <button className="btn-ghost !py-1 text-[11px] shrink-0" onClick={() => check(true)} disabled={checking}>
        {checking ? "Checking..." : "Re-check"}
      </button>
    </div>
  );
}

function Th({ label, k, sortKey, sortDir, onSort }: { label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void }) {
  const active = sortKey === k;
  return (
    <th aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-body ${active ? "text-foil" : ""}`}
      >
        {label}
        {active ? (
          <span className="text-[8px] leading-none">{sortDir === "asc" ? "▲" : "▼"}</span>
        ) : (
          <span className="text-[8px] leading-none opacity-30 flex flex-col">
            <span>{"▲"}</span>
            <span>{"▼"}</span>
          </span>
        )}
      </button>
    </th>
  );
}

export default function SinglesClient({ isAdmin, isManager, mode = "raw" }: { isAdmin: boolean; isManager: boolean; mode?: "raw" | "graded" }) {
  const [singles, setSingles] = useState<SingleT[]>([]);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupMsg, setSetupMsg] = useState("");
  const [statusFilter, setStatusFilter] = useState("In Stock");
  const [needsResticker, setNeedsResticker] = useState(false);
  // cards that have never had a sticker printed - the batch you just entered
  const [neverPrinted, setNeverPrinted] = useState(false);
  const [thinData, setThinData] = useState(false);
  const [tableQ, setTableQ] = useState("");
  const [busy, setBusy] = useState("");
  const [qrFor, setQrFor] = useState<SingleT | null>(null);
  const [qrData, setQrData] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // Where to draw the row menu, in viewport coordinates.
  //
  // The table sits in a horizontally scrolling wrapper, and CSS will not let a
  // box scroll on one axis and overflow visibly on the other - asking for
  // overflow-x auto silently makes overflow-y auto too. So an absolutely
  // positioned menu gets clipped by that wrapper, and the shorter the table
  // the worse it is: search down to one row and the wrapper is 171px tall
  // while the menu is 269px, so two thirds of it is unreachable.
  //
  // Fixed positioning takes the menu out of that box entirely. No ancestor
  // sets transform, filter or containment, so fixed resolves against the
  // viewport here rather than some intermediate element.
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const [err, setErr] = useState("");

  // multi-select for bulk actions
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const lastClicked = useRef<number | null>(null);
  const selSet = useMemo(() => new Set(selected), [selected]);

  // add flow
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SearchCard | null>(null);
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState({ name: "", setName: "", number: "", condition: "NM", qty: "1", buyPrice: "", comp: "", notes: "", printing: "", language: "English" });
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
      ...(draft.language !== "English" ? { language: draft.language } : {}),
      qty: parseInt(draft.qty) || 1,
      notes: draft.notes,
      ...(draft.printing.trim() ? { printing: draft.printing.trim() } : {}),
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
      setDraft({ name: "", setName: "", number: "", condition: "NM", qty: "1", buyPrice: "", comp: "", notes: "", printing: "", language: draft.language });
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

  // Change the condition, then immediately reprice on it.
  //
  // The comp is condition-specific - it is the median of sales in that exact
  // condition - so the moment the condition changes the stored price is for a
  // card we no longer say we have. Leaving that to the rolling job means the
  // card can be stickered, scanned and sold at the old grade's price in the
  // meantime, which is the one outcome worth a second API call to avoid.
  async function setCondition(s: SingleT, next: string) {
    if (s.condition === next) return;
    setBusy(s.id); setErr("");
    try {
      const r = await fetch(`/api/singles/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ condition: next }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || "Could not change condition"); toast(d.error || "Could not change condition", "bad"); return; }
      setSingles((prev) => prev.map((x) => (x.id === s.id ? d.single : x)));

      const before = s.comp;
      const c = await fetch(`/api/singles/${s.id}/comp`, { method: "POST" });
      const cd = await c.json();
      if (c.ok && cd.single) {
        setSingles((prev) => prev.map((x) => (x.id === s.id ? cd.single : x)));
        const after = cd.single.comp;
        // Say what the price did, because that is the consequence the person
        // actually cares about and they are usually about to print a sticker.
        toast(
          after != null && before != null && after !== before
            ? `${next} - comp ${$(before)} to ${$(after)}`
            : `${next} - comp ${after != null ? $(after) : "not available"}`
        );
      } else {
        toast(`${next} - comp not updated: ${cd.reason || cd.error || "no price available"}`, "bad");
      }
    } finally {
      setBusy("");
    }
  }

  // One record holding several cards becomes one record per card, so each gets
  // its own sticker number and can be sold on its own.
  async function splitCard(s: SingleT) {
    const n = s.qty || 1;
    if (n <= 1) return;
    if (!window.confirm(
      `Split ${s.name} into ${n} separate cards?\n\n` +
      `Each gets its own card number and its own sticker, and can be sold on its own. ` +
      `Total value does not change. This cannot be undone in one click.`
    )) return;
    setBusy(s.id); setErr("");
    try {
      const r = await fetch(`/api/singles/${s.id}/split`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || "Split failed"); toast(d.error || "Split failed", "bad"); return; }
      toast(d.complete ? `Split into ${n} cards` : `Only ${d.created} of ${d.of} copies were made - the rest are still on the original`, d.complete ? undefined : "bad");
      await load();
    } finally {
      setBusy("");
    }
  }

  // Split every selected record that holds more than one card. Sequential on
  // purpose: each split writes several rows, and firing 50 of those at Airtable
  // at once is how you get rate-limited into a half-finished collection.
  async function splitSelected() {
    // shown, not singles: the button's count comes from selStats, which is
    // built from the visible rows. Splitting a selected card that a filter is
    // currently hiding would do more than the button said it would.
    const rows = shown.filter((s) => selSet.has(s.id) && (s.qty || 1) > 1 && s.status === "In Stock");
    if (rows.length === 0) { toast("Nothing in the selection to split", "bad"); return; }
    const extra = rows.reduce((a, s) => a + (s.qty || 1) - 1, 0);
    if (!window.confirm(
      `Split ${rows.length} record${rows.length === 1 ? "" : "s"} into ${rows.length + extra} cards?\n\n` +
      `This creates ${extra} new record${extra === 1 ? "" : "s"}, each with its own card number so it can be stickered ` +
      `and sold on its own. Total value does not change. This cannot be undone in one click.`
    )) return;
    setBulkBusy(true); setErr("");
    let done = 0, made = 0;
    const failed: string[] = [];
    try {
      for (const s of rows) {
        toast(`Splitting... ${done}/${rows.length}`);
        try {
          const r = await fetch(`/api/singles/${s.id}/split`, { method: "POST" });
          const d = await r.json();
          if (r.ok) made += d.created || 0;
          else failed.push(`${s.name}: ${d.error || r.status}`);
        } catch {
          failed.push(`${s.name}: request failed`);
        }
        done++;
      }
      toast(
        failed.length === 0
          ? `${made} new card record${made === 1 ? "" : "s"} created`
          : `${made} created, ${failed.length} failed`,
        failed.length === 0 ? undefined : "bad"
      );
      if (failed.length > 0) setErr(failed.slice(0, 5).join("; "));
      setSelected([]);
      await load();
    } finally {
      setBulkBusy(false);
    }
  }

  async function assignLocations() {
    if (shown.length === 0) { toast("Nothing shown to number", "bad"); return; }
    const prefix = (window.prompt("Location prefix - our recommended scheme: B1 for binder 1, C1 for case 1, BOX1 for a box", "B1") || "").trim().toUpperCase();
    if (!prefix) return;
    const startRaw = window.prompt("Start numbering at", "1") || "";
    const start = Math.max(1, parseInt(startRaw) || 1);
    const end = start + shown.length - 1;
    if (!window.confirm(`Number all ${shown.length} shown cards as ${prefix}-${start} through ${prefix}-${end}, top to bottom in the current order? This overwrites existing locations on these cards. Tip: filter or search first to number one binder at a time.`)) return;
    toast(`Numbering ${shown.length} cards...`);
    let n = start, ok = 0;
    for (const s of shown) {
      const code = `${prefix}-${n++}`;
      const r = await fetch(`/api/singles/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: code }) });
      if (r.ok) ok++;
    }
    toast(`${ok} cards numbered ${prefix}-${start} to ${prefix}-${end}`);
    load();
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

  // Open the menu against the button that was clicked, flipping it above when
  // there is more room up than down. The estimate is deliberately generous:
  // being wrong costs a menu that opens upward unnecessarily, while being
  // short costs a menu with its bottom off the screen, which is the bug.
  const MENU_W = 176;
  const MENU_H = 300;
  function openMenu(id: string, el: HTMLElement) {
    if (menuFor === id) { setMenuFor(null); setMenuPos(null); return; }
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < MENU_H && r.top > below;
    setMenuPos({
      // right-aligned to the button, but never off the left edge
      left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)),
      top: up ? r.top - 4 : r.bottom + 4,
      up,
    });
    setMenuFor(id);
  }

  // A fixed menu does not travel with the row it belongs to, so anything that
  // moves the page underneath it has to dismiss it rather than leave it
  // hovering over unrelated cards. Clicking away closes it too - that never
  // worked before, because the menu was only ever dismissed by picking an item
  // or hitting the same dots again.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => { setMenuFor(null); setMenuPos(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('[data-row-menu], [aria-label="Row actions"]')) return;
      close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [menuFor]);

  async function remove(id: string) {
    if (!confirm("Delete this card from the singles inventory?")) return;
    const r = await fetch(`/api/singles/${id}`, { method: "DELETE" });
    if (r.ok) { setSingles((prev) => prev.filter((s) => s.id !== id)); setSelected((p) => p.filter((x) => x !== id)); toast("Card deleted"); }
    else { const e = (await r.json()).error || "Delete failed"; setErr(e); toast(e, "bad"); }
  }

  // Checkbox handling. Shift-click extends from the last box you touched, so
  // clearing a run of cards down a binder page is one click and one shift-click.
  function toggleOne(index: number, shiftKey: boolean) {
    const row = shown[index];
    if (!row) return;
    if (shiftKey && lastClicked.current !== null && lastClicked.current !== index) {
      const [a, b] = [lastClicked.current, index].sort((x, y) => x - y);
      const range = shown.slice(a, b + 1).map((s) => s.id);
      const turningOn = !selSet.has(row.id);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of range) turningOn ? next.add(id) : next.delete(id);
        return Array.from(next);
      });
    } else {
      setSelected((prev) => (prev.includes(row.id) ? prev.filter((x) => x !== row.id) : [...prev, row.id]));
    }
    lastClicked.current = index;
  }

  function toggleAllShown() {
    const ids = shown.map((s) => s.id);
    const allOn = ids.length > 0 && ids.every((id) => selSet.has(id));
    lastClicked.current = null;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) allOn ? next.delete(id) : next.add(id);
      return Array.from(next);
    });
  }

  // Hand the chosen cards to the label page. sessionStorage rather than a query
  // string because a hundred record ids will not fit in a URL, and the list is
  // throwaway: it belongs to this tab and this trip to the printer.
  function printLabels(ids: string[]) {
    if (ids.length === 0) { toast("Nothing selected to print", "bad"); return; }
    try {
      sessionStorage.setItem("llc-label-ids", JSON.stringify(ids));
    } catch {
      toast("Could not hand the list to the label page", "bad");
      return;
    }
    // Same tab on purpose. A new tab only inherits sessionStorage by spec, and
    // anything that strips the opener relationship would land the label page
    // with an empty list and no clue why. The label page has a Back link.
    window.location.href = "/singles/labels";
  }

  // Re-pull prices for a batch of cards.
  //
  // Sticker-safe by construction: this only writes price fields. The QR on a
  // printed label encodes the card's record id and the big number is a fixed
  // Airtable autoNumber, so neither can move. What a refresh CAN change is the
  // price bucket letter, which is exactly what the Printed Bucket stamp and
  // the Needs re-sticker filter exist to catch.
  async function refreshComps(ids: string[]) {
    if (ids.length === 0) { toast("Nothing to refresh", "bad"); return; }
    setBulkBusy(true); setErr("");
    let done = 0, linkedTotal = 0, skippedTotal = 0, estTotal = 0;
    const reasons: { id: string; reason: string }[] = [];
    const review: { name: string; condition: string; before: number | null; after: number }[] = [];
    try {
      // The route caps each call so a long batch cannot be killed mid-write.
      // Loop until it reports nothing remaining.
      let queue = [...ids];
      while (queue.length > 0) {
        toast(`Refreshing prices... ${done}/${ids.length}`);
        const r = await fetch("/api/singles/comps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: queue }),
        });
        const d = await r.json();
        if (!r.ok) { setErr(d.error || "Price refresh failed"); break; }
        done += d.updated;
        linkedTotal += d.linked || 0;
        skippedTotal += d.skipped || 0;
        estTotal += d.estimated || 0;
        if (Array.isArray(d.reasons)) reasons.push(...d.reasons);
        if (Array.isArray(d.review)) review.push(...d.review);
        if (!d.remaining) break;
        queue = queue.slice(queue.length - d.remaining);
      }
      const bits = [`${done} ${done === 1 ? "price" : "prices"} updated`];
      if (linkedTotal) bits.push(`${linkedTotal} newly linked to TCGplayer`);
      if (estTotal) bits.push(`${estTotal} estimated (no recent sales)`);
      if (skippedTotal) bits.push(`${skippedTotal} skipped`);
      toast(bits.join(" - "), skippedTotal && !done ? "bad" : "ok");

      // Named, not counted. A card whose price just doubled off a guess is
      // something to go look at, and a number in a toast does not get looked at.
      const notes: string[] = [];
      if (review.length) {
        notes.push(
          `Check these ${review.length} by hand - the new price is an estimate and moved a long way: ` +
          review.map((x) => `${x.name} (${x.condition}) ${x.before !== null ? $(x.before) : "no comp"} to ${$(x.after)}`).join("; ")
        );
      }
      if (reasons.length) {
        notes.push("Skipped: " + reasons.map((x) => x.reason).filter((v, i, a) => a.indexOf(v) === i).join("; "));
      }
      if (notes.length) setErr(notes.join("  |  "));
      await load();
    } finally {
      setBulkBusy(false);
    }
  }

  async function deleteSelected() {
    const picked = shown.filter((s) => selSet.has(s.id));
    if (picked.length === 0) return;
    const onStream = picked.filter((s) => s.status === "In Stream").length;
    const note = onStream ? `\n\n${onStream} of them ${onStream === 1 ? "is" : "are"} on a stream and will be skipped - pull the line from the stream first.` : "";
    if (!confirm(`Delete ${picked.length} ${picked.length === 1 ? "card" : "cards"} from the singles inventory? This cannot be undone.${note}`)) return;
    setBulkBusy(true); setErr("");
    try {
      const r = await fetch("/api/singles/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: picked.map((s) => s.id) }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || "Bulk delete failed"); toast(d.error || "Bulk delete failed", "bad"); return; }
      const gone = new Set<string>(d.deleted || []);
      setSingles((prev) => prev.filter((s) => !gone.has(s.id)));
      setSelected((prev) => prev.filter((id) => !gone.has(id)));
      lastClicked.current = null;
      const skipped = (d.skipped || []).length;
      toast(`${d.count} ${d.count === 1 ? "card" : "cards"} deleted` + (skipped ? ` - ${skipped} skipped` : ""), skipped ? "bad" : "ok");
      if (skipped) setErr("Skipped: " + (d.skipped || []).map((x: any) => `${x.name || x.id} (${x.reason})`).join(", "));
    } finally {
      setBulkBusy(false);
    }
  }

  const [setFilter, setSetFilter] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Clicking the active column flips it; a new column opens in the direction
  // that reads best - A to Z for text, biggest first for money and quantity.
  function sortByCol(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(TEXTUAL.has(k) ? "asc" : "desc");
    }
  }

  // a changed view means a changed list - drop the selection so nothing gets
  // deleted that the user can no longer see
  useEffect(() => { setSelected([]); lastClicked.current = null; }, [statusFilter, setFilter, tableQ, mode, needsResticker, neverPrinted, thinData]);
  // re-sorting keeps the selection but retires the shift-click anchor, since
  // the row that index pointed at just moved
  useEffect(() => { lastClicked.current = null; }, [sortKey, sortDir]);

  const setNames = useMemo(
    () => Array.from(new Set(singles.map((s) => s.setName).filter(Boolean))).sort(),
    [singles]
  );

  const shown = useMemo(() => {
    let list = statusFilter === "All" ? singles : singles.filter((s) => s.status === statusFilter);
    // cards whose comp crossed a band since their sticker printed: they are
    // physically in the wrong box until someone moves and reprints them
    if (needsResticker) list = list.filter((s) => bucketDrifted(s.comp, s.printedBucket || ""));
    // Never stickered. Reads Label Printed rather than Printed Bucket, which
    // is blank for unpriced cards however many times they have been printed.
    if (neverPrinted) list = list.filter((s) => !s.labelPrinted);
    if (thinData) list = list.filter((s) => s.comp !== null && isThinComp(s.compSales));
    list = mode === "graded" ? list.filter((s) => GRADED.includes(s.condition)) : list.filter((s) => !GRADED.includes(s.condition));
    if (setFilter !== "All") list = list.filter((s) => s.setName === setFilter);
    // token search: every word must match somewhere, so "umbreon prismatic"
    // finds Umbreons in Prismatic Evolutions
    // A bare number is someone reading a sticker or a called-out hit, so it
    // means that exact card rather than "any card with a 142 in it anywhere".
    const wantNo = parseCardNo(tableQ);
    const exactNo = wantNo !== null ? list.filter((s) => s.cardNo === wantNo) : [];
    if (exactNo.length > 0) {
      list = exactNo;
    } else {
      const tokens = tableQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (tokens.length) {
        list = list.filter((s) => {
          const hay = `${formatCardNo(s.cardNo)} ${s.name} ${s.setName} ${s.number} ${s.condition} ${s.rarity} ${s.language || ""}`.toLowerCase();
          return tokens.every((t) => hay.includes(t));
        });
      }
    }
    list = [...list];
    if (sortKey !== "newest") {
      const dir = sortDir === "asc" ? 1 : -1;
      list.sort((a, b) => {
        const av = sortValue(a, sortKey);
        const bv = sortValue(b, sortKey);
        // Nulls sink to the bottom whichever way you sort, so a card with no
        // comp never leads a cheapest-first list.
        if (av === null && bv === null) return a.name.localeCompare(b.name);
        if (av === null) return 1;
        if (bv === null) return -1;
        const c = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
        return c !== 0 ? c * dir : a.name.localeCompare(b.name);
      });
    } else if (sortDir === "asc") {
      // API order is newest first, so oldest first is just the reverse
      list.reverse();
    }
    // "newest" keeps API order (Date Added desc)
    return list;
  }, [singles, statusFilter, setFilter, sortKey, sortDir, tableQ, mode, needsResticker, neverPrinted, thinData]);

  const restickerCount = useMemo(
    () => singles.filter((s) => bucketDrifted(s.comp, s.printedBucket || "")).length,
    [singles]
  );

  // Only In Stock: a card already on a stream or sold does not need a sticker,
  // and counting them would make the chip look permanently unfinished.
  const neverPrintedCount = useMemo(
    () => singles.filter((s) => !s.labelPrinted && s.status === "In Stock").length,
    [singles]
  );

  // In Stock only, same reasoning as never-printed: a sold card's comp is
  // history and re-examining it changes nothing.
  const thinCount = useMemo(
    () => singles.filter((s) => s.status === "In Stock" && s.comp !== null && isThinComp(s.compSales)).length,
    [singles]
  );

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

  const selStats = useMemo(() => {
    const rows = shown.filter((s) => selSet.has(s.id));
    return {
      rows: rows.length,
      cards: rows.reduce((a, s) => a + (s.qty || 1), 0),
      market: rows.reduce((a, s) => a + (s.comp || 0) * (s.qty || 1), 0),
      locked: rows.filter((s) => s.status === "In Stream").length,
      // extra cards that could get their own record. In Stock only: a sold or
      // streaming record cannot be split, because its sale price and stream
      // line belong to the whole stack.
      splittable: rows
        .filter((s) => s.status === "In Stock")
        .reduce((a, s) => a + Math.max(0, (s.qty || 1) - 1), 0),
    };
  }, [shown, selSet]);
  const allShownSelected = shown.length > 0 && shown.every((s) => selSet.has(s.id));

  function exportCsv() {
    const header = [
      "Card No", "Bucket", "Printed Bucket", "Label Printed", "Location",
      "Card", "Set", "Number", "Condition", "Printing", "Rarity", "Qty", "Status",
      "Comp", "Comp Source", "Comp Date",
      ...(isAdmin ? ["Buy Price"] : []),
      "Sale Price", "Sold Date", "Date Added", "Added By", "Notes",
    ];
    const rows = shown.map((s) => [
      formatCardNo(s.cardNo), bucketFor(s.comp), s.printedBucket ?? "", (s.labelPrinted || "").slice(0, 10), s.location ?? "",
      s.name.replace(/\s*-\s*[\w]+\/[\w]+\s*$/, ""), s.setName, s.number, s.condition, s.printing, s.rarity, s.qty, s.status,
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
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${s.name} ${s.setName} ${s.number} ${s.condition !== "Raw" ? s.condition : ""} ${s.language && s.language !== "English" ? s.language : ""}`.replace(/\s+/g, " ").trim())}&LH_Sold=1&LH_Complete=1`;

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
          <h2 className="label">{mode === "graded" ? "Add a graded card" : "Add a card"}</h2>
          <button className="text-foil text-xs hover:underline" onClick={() => { setManual(!manual); setPicked(null); setResults([]); }}>
            {manual ? "Back to card search" : "Card not found? Add manually"}
          </button>
        </div>

        {!manual && !picked && (
          <div className="space-y-2">
            <div>
              <label className="label">Condition first</label>
              <div className="flex gap-1 flex-wrap mt-1">
                {(mode === "graded" ? CONDITIONS.filter((c) => GRADED.includes(c)) : CONDITIONS.filter((c) => !GRADED.includes(c))).map((c) => (
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
              <div className="flex gap-1 mt-2 flex-wrap items-center">
                <span className="label !text-[10px]">Language</span>
                {["English", "Japanese", "Chinese", "Korean", "Spanish", "Other"].map((lg) => (
                  <button
                    key={lg}
                    className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${
                      draft.language === lg ? "border-givvy text-givvy bg-givvy/10" : "border-edge text-dim hover:text-body"
                    }`}
                    onClick={() => setDraft({ ...draft, language: lg })}
                  >
                    {lg}
                  </button>
                ))}
              </div>
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
                  {(mode === "graded" ? CONDITIONS.filter((c) => GRADED.includes(c)) : CONDITIONS.filter((c) => !GRADED.includes(c))).map((c) => <option key={c}>{c}</option>)}
                </select>
              <a href="/conditions" target="_blank" className="text-dim text-[11px] hover:text-foil block mt-0.5">condition guide</a>
              </div>
              <div>
                <label className="label">Printing</label>
                <input
                  className="input mt-1 !w-32"
                  list="printing-options"
                  placeholder="Unlimited"
                  value={draft.printing}
                  onChange={(e) => setDraft({ ...draft, printing: e.target.value })}
                  title="For vintage cards: 1st Edition, Shadowless, or Unlimited"
                />
                <datalist id="printing-options">
                  <option value="1st Edition" />
                  <option value="Shadowless" />
                  <option value="Unlimited" />
                </datalist>
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
          <h2 className="label">{mode === "graded" ? "Graded cards" : "Cards"}</h2>
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
            <select
              className="input !w-44"
              value={`${sortKey}:${sortDir}`}
              onChange={(e) => {
                const [k, d] = e.target.value.split(":");
                setSortKey(k as SortKey);
                setSortDir(d as SortDir);
              }}
            >
              <option value="newest:desc">Newest first</option>
              <option value="newest:asc">Oldest first</option>
              <option value="cardNo:asc">Card no low-high</option>
              <option value="cardNo:desc">Card no high-low</option>
              <option value="name:asc">Name A-Z</option>
              <option value="name:desc">Name Z-A</option>
              <option value="condition:asc">Condition NM first</option>
              <option value="bucket:asc">Price box A-H</option>
              <option value="location:asc">Location A-Z</option>
              <option value="comp:desc">Comp high-low</option>
              <option value="comp:asc">Comp low-high</option>
              <option value="qty:desc">Qty high-low</option>
              <option value="status:asc">Status A-Z</option>
            </select>
            {isManager && (
              <button className="btn-ghost !py-1.5 text-xs" onClick={assignLocations} title="Number every card currently shown, in the order shown">Assign locations</button>
            )}
            {neverPrintedCount > 0 && (
              <button
                type="button"
                aria-pressed={neverPrinted}
                onClick={() => setNeverPrinted((v) => !v)}
                title="Cards that have never had a sticker printed. Turn this on, then Print labels, and they drop off the list once the paper comes out."
                className={`px-3 py-1.5 text-xs whitespace-nowrap rounded-lg border transition-colors ${
                  neverPrinted ? "border-foil/60 bg-foil/15 text-foil font-semibold" : "border-edge text-dim hover:text-body"
                }`}
              >
                Never printed <span className="num ml-1 opacity-70">{neverPrintedCount}</span>
              </button>
            )}
            {thinCount > 0 && (
              <button
                type="button"
                aria-pressed={thinData}
                onClick={() => setThinData((v) => !v)}
                title="Cards priced on fewer than three recent sales, or on asking prices with no sales at all. The number is not necessarily wrong, there is just not much holding it up - worth a look before a stream."
                className={`px-3 py-1.5 text-xs whitespace-nowrap rounded-lg border transition-colors ${
                  thinData ? "border-givvy/60 bg-givvy/15 text-givvy font-semibold" : "border-edge text-dim hover:text-body"
                }`}
              >
                Thin data <span className="num ml-1 opacity-70">{thinCount}</span>
              </button>
            )}
            {restickerCount > 0 && (
              <button
                type="button"
                aria-pressed={needsResticker}
                onClick={() => setNeedsResticker((v) => !v)}
                title="Cards whose comp has crossed a price band since their sticker was printed, so they are in the wrong box"
                className={`px-3 py-1.5 text-xs whitespace-nowrap rounded-lg border transition-colors ${
                  needsResticker ? "border-givvy/60 bg-givvy/15 text-givvy font-semibold" : "border-edge text-dim hover:text-body"
                }`}
              >
                Needs re-sticker <span className="num ml-1 opacity-70">{restickerCount}</span>
              </button>
            )}
            {isManager && shown.length > 0 && (
              <button
                className="btn-ghost !py-1.5 text-xs"
                onClick={() => printLabels(shown.map((s) => s.id))}
                title="Print a sticker for every card currently shown, in the order shown"
              >
                Print labels ({shown.length})
              </button>
            )}
            {isManager && shown.length > 0 && (
              <button
                className="btn-ghost !py-1.5 text-xs disabled:opacity-40"
                disabled={bulkBusy}
                onClick={() => refreshComps(shown.map((s) => s.id))}
                title="Re-pull comps and market prices for every card shown. Card numbers and printed QR codes are not affected."
              >
                {bulkBusy ? "Refreshing..." : `Refresh prices (${shown.length})`}
              </button>
            )}
            <button className="btn-ghost !py-1.5 text-xs" onClick={exportCsv}>Export CSV</button>
            <CollectrImport onDone={load} />
          </div>
        </div>
        <PricingHealth isManager={isManager} />
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
        {isAdmin && selStats.rows > 0 && (
          <div className="sticky top-2 z-30 flex items-center gap-3 flex-wrap rounded-lg border border-foil/40 bg-panel/95 backdrop-blur px-4 py-2.5 shadow-2xl">
            <span className="text-sm font-semibold">
              {selStats.rows} selected
              <span className="text-dim font-normal">
                {" "}- {selStats.cards} {selStats.cards === 1 ? "card" : "cards"} worth <span className="num text-foil">{$(selStats.market)}</span>
              </span>
            </span>
            {selStats.locked > 0 && (
              <span className="text-xs text-dim">{selStats.locked} on a stream, will be skipped</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button className="btn-ghost !py-1.5 text-xs" onClick={() => { setSelected([]); lastClicked.current = null; }}>Clear</button>
              <button
                className="btn-ghost !py-1.5 text-xs disabled:opacity-40"
                disabled={bulkBusy}
                onClick={() => refreshComps(Array.from(selSet))}
                title="Re-pull comps and market prices for the selected cards"
              >
                {bulkBusy ? "Refreshing..." : `Refresh ${selStats.rows} prices`}
              </button>
              {/* Only offered when the selection actually has cards that can
                  get their own record, so the count on the button is exactly
                  what the action will do. */}
              {selStats.splittable > 0 && (
                <button
                  className="rounded-lg border border-givvy/60 text-givvy hover:bg-givvy/10 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                  disabled={bulkBusy}
                  onClick={splitSelected}
                  title="Give every physical card its own record, number and sticker"
                >
                  {bulkBusy ? "Splitting..." : `Split ${selStats.splittable} extra card${selStats.splittable === 1 ? "" : "s"} out`}
                </button>
              )}
              <button
                className="btn-foil !py-1.5 text-xs"
                onClick={() => printLabels(Array.from(selSet))}
                title="Print a sticker for each selected card"
              >
                Print {selStats.rows} labels
              </button>
              <button
                className="rounded-lg border border-bad/60 text-bad hover:bg-bad/10 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                disabled={bulkBusy}
                onClick={deleteSelected}
              >
                {bulkBusy ? "Deleting..." : `Delete ${selStats.rows} selected`}
              </button>
            </div>
          </div>
        )}

        {isAdmin && shown.length > 0 && (
          <label className="md:hidden flex items-center gap-2 text-xs text-dim">
            <input type="checkbox" className="accent-foil h-4 w-4" checked={allShownSelected} onChange={toggleAllShown} />
            Select all {shown.length} shown
          </label>
        )}

        {/* mobile: one card per item, built for thumbs at a card show */}
        <div className="md:hidden space-y-2">
          {shown.map((s, i) => (
            <div key={s.id} className={`card p-3 ${selSet.has(s.id) ? "border-foil/60" : ""}`}>
              <div className="flex gap-3">
                {isAdmin && (
                  <input
                    type="checkbox"
                    className="accent-foil h-4 w-4 self-start mt-1"
                    aria-label={`Select ${s.name}`}
                    checked={selSet.has(s.id)}
                    onChange={(e) => toggleOne(i, (e.nativeEvent as any).shiftKey)}
                  />
                )}
                {s.image && <Thumb src={s.image} size={48} className="self-start" />}
                {s.cardNo ? (
                  <span className="num text-[10px] font-bold text-foil border border-foil/40 rounded px-1 py-px self-start" title="Card number - printed on the sticker and shown on the stream line">
                    {formatCardNo(s.cardNo)}
                  </span>
                ) : null}
                {bucketFor(s.comp) ? (
                  <span
                    className={`text-[10px] font-bold rounded px-1 py-px self-start ${
                      bucketDrifted(s.comp, s.printedBucket || "")
                        ? "text-givvy border border-givvy/60 bg-givvy/10"
                        : "text-dim border border-edge"
                    }`}
                    title={
                      bucketDrifted(s.comp, s.printedBucket || "")
                        ? `Sticker says ${s.printedBucket}, comp now puts it in ${bucketFor(s.comp)} (${bucketRange(bucketFor(s.comp))}). Move the card and reprint.`
                        : `Box ${bucketFor(s.comp)} (${bucketRange(bucketFor(s.comp))})`
                    }
                  >
                    {bucketFor(s.comp)}
                    {bucketDrifted(s.comp, s.printedBucket || "") ? ` was ${s.printedBucket}` : ""}
                  </span>
                ) : null}
                {s.location && <span className="text-[10px] text-dim border border-edge rounded px-1 py-px self-start">{s.location}</span>}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold leading-tight">{s.name}</div>
                  <div className="text-dim text-xs">
                    {s.setName}{s.number ? ` #${s.number}` : ""}
                    {s.printing && <span className="ml-1.5 text-[10px] text-foil border border-foil/40 rounded px-1 py-px">{s.printing}</span>}
                    {s.language && s.language !== "English" && <span className="ml-1.5 text-[10px] text-givvy border border-givvy/40 rounded px-1 py-px">{s.language === "Japanese" ? "JP" : s.language === "Chinese" ? "CN" : s.language === "Korean" ? "KR" : s.language === "Spanish" ? "ES" : s.language}</span>}
                  </div>
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    <span className="text-[10px] border border-edge rounded-full px-2 py-0.5 text-dim">{s.condition}</span>
                    <span className={`text-[10px] border rounded-full px-2 py-0.5 ${s.status === "Sold" ? "border-win/50 text-win" : s.status === "In Stream" ? "border-givvy/50 text-givvy" : "border-edge text-dim"}`}>{s.status}</span>
                  </div>
                </div>
                <button
                  className="text-dim hover:text-body px-2 self-start"
                  onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}
                  aria-label="Row actions"
                >
                  {"\u22EF"}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div>
                  <div className="label">Comp</div>
                  <span className="inline-flex items-center gap-1">
                    {isManager ? <EditCell value={s.comp} onSave={(v) => patch(s.id, { comp: v })} /> : <span className="num text-sm">{s.comp !== null ? $(s.comp) : "-"}</span>}
                    <DeltaHover current={s.comp} entry={s.entryComp} date={s.dateAdded} />
                  </span>
                </div>
                {isAdmin && (
                  <div>
                    <div className="label">Buy</div>
                    <EditCell value={s.buy ?? null} highlightEmpty onSave={(v) => patch(s.id, { buyPrice: v })} />
                  </div>
                )}
                <div>
                  <div className="label">Sale</div>
                  {isManager && s.status !== "In Stream" ? (
                    <EditCell value={s.salePrice} onSave={(v) => patch(s.id, { salePrice: v, ...(s.status === "In Stock" ? { status: "Sold" } : {}) })} />
                  ) : (
                    <span className="num text-sm">{s.salePrice ? $(s.salePrice) : "-"}</span>
                  )}
                </div>
              </div>
              {menuFor === s.id && (
                <div className="mt-2 rounded-lg border border-edge bg-ink/60 py-1">
                  {["Raw", "NM", "LP", "MP", "HP", "DM"].includes(s.condition) && s.cardId && (
                    <button className="block w-full text-left px-3 py-1.5 text-sm text-body hover:bg-edge/50 disabled:opacity-40" disabled={busy === s.id} onClick={() => { setMenuFor(null); refreshComp(s.id); }}>
                      {busy === s.id ? "Refreshing..." : "Refresh comp"}
                    </button>
                  )}
                  <a className="block px-3 py-1.5 text-sm text-body hover:bg-edge/50" target="_blank" rel="noreferrer" href={ebayLink(s)} onClick={() => setMenuFor(null)}>
                    eBay solds {"\u2197"}
                  </a>
                  {isAdmin && s.status !== "In Stream" && (
                    <button className="block w-full text-left px-3 py-1.5 text-sm text-bad hover:bg-bad/10" onClick={() => { setMenuFor(null); remove(s.id); }}>
                      Delete card
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {shown.length === 0 && <div className="text-dim text-sm">No cards match</div>}
        </div>

        <div className="overflow-x-auto hidden md:block">
          <table className="w-full">
            <thead>
              <tr>
                {isAdmin && (
                  <th className="w-8">
                    <input
                      type="checkbox"
                      className="accent-foil h-4 w-4 align-middle"
                      aria-label="Select all shown cards"
                      title="Select every card currently shown"
                      checked={allShownSelected}
                      onChange={toggleAllShown}
                    />
                  </th>
                )}
                <Th label="No" k="cardNo" sortKey={sortKey} sortDir={sortDir} onSort={sortByCol} />
                <Th label="Card" k="name" sortKey={sortKey} sortDir={sortDir} onSort={sortByCol} />
                <Th label="Condition" k="condition" sortKey={sortKey} sortDir={sortDir} onSort={sortByCol} />
                <Th label="Qty" k="qty" sortKey={sortKey} sortDir={sortDir} onSort={sortByCol} />
                <Th label="Loc" k="location" sortKey={sortKey} sortDir={sortDir} onSort={sortByCol} />
                {isAdmin && <Th label="Buy" k="buy" sortKey={sortKey} sortDir={sortDir} onSort={sortByCol} />}
                <Th label="Comp" k="comp" sortKey={sortKey} sortDir={sortDir} onSort={sortByCol} />
                <Th label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onSort={sortByCol} />
                <Th label="Sale" k="salePrice" sortKey={sortKey} sortDir={sortDir} onSort={sortByCol} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s, i) => (
                <tr key={s.id} className={selSet.has(s.id) ? "bg-foil/5" : ""}>
                  {isAdmin && (
                    <td className="w-8">
                      <input
                        type="checkbox"
                        className="accent-foil h-4 w-4 align-middle"
                        aria-label={`Select ${s.name}`}
                        checked={selSet.has(s.id)}
                        onChange={(e) => toggleOne(i, (e.nativeEvent as any).shiftKey)}
                      />
                    </td>
                  )}
                  <td className="whitespace-nowrap align-top">
                    <div className="num text-xs font-bold text-foil" title="Card number - printed on the sticker and shown on the stream line">
                      {formatCardNo(s.cardNo)}
                    </div>
                    {bucketFor(s.comp) ? (
                      <div
                        className={`text-[10px] font-bold leading-tight ${
                          bucketDrifted(s.comp, s.printedBucket || "") ? "text-givvy" : "text-dim"
                        }`}
                        title={
                          bucketDrifted(s.comp, s.printedBucket || "")
                            ? `Sticker says ${s.printedBucket}, comp now puts it in ${bucketFor(s.comp)} (${bucketRange(bucketFor(s.comp))}). Move the card and reprint.`
                            : `Box ${bucketFor(s.comp)} (${bucketRange(bucketFor(s.comp))})`
                        }
                      >
                        {bucketFor(s.comp)}
                        {bucketDrifted(s.comp, s.printedBucket || "") ? ` was ${s.printedBucket}` : ""}
                      </div>
                    ) : null}
                  </td>
                  <td className="!font-medium">
                    <span className="inline-flex items-center gap-2">
                      {s.image && <Thumb src={s.image} size={28} />}
                      <span>
                        {s.name}
                        <span className="block text-dim text-xs font-normal">
                          {s.setName}{s.number ? ` #${s.number}` : ""}{s.rarity ? ` - ${s.rarity}` : ""}
                          {s.printing && (
                            <span className="ml-1.5 text-[10px] text-foil border border-foil/40 rounded px-1 py-px">{s.printing}</span>
                          )}
                          {s.language && s.language !== "English" && (
                            <span className="ml-1.5 text-[10px] text-givvy border border-givvy/40 rounded px-1 py-px">{s.language === "Japanese" ? "JP" : s.language === "Chinese" ? "CN" : s.language === "Korean" ? "KR" : s.language === "Spanish" ? "ES" : s.language}</span>
                          )}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="text-dim text-xs">{s.condition}</td>
                  <td>{s.qty}</td>
                  <td>
                    <LocCell value={s.location || ""} canEdit={isManager} onSave={(v) => patch(s.id, { location: v })} />
                  </td>
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
                      <DeltaHover current={s.comp} entry={s.entryComp} date={s.dateAdded} />
                      {s.compDetail && <CompSales detail={s.compDetail} condition={s.condition} productId={s.tcgProductId} />}
                      {!s.compDetail && s.comp !== null && s.compSource.includes("est.") && (
                        <span
                          className="text-amber-400 text-xs cursor-help whitespace-nowrap underline decoration-dotted"
                          title={`${s.compSource} - no recent sales in this condition, comp is a discount off NM market. Verify before pricing.`}
                        >
                          est.
                        </span>
                      )}
                      {/* Not a second opinion on the price, a statement about
                          how much is holding it up. Sits next to the number
                          because that is where it changes what you do. */}
                      {isThinComp(s.compSales) && s.comp !== null && !s.compSource.includes("est.") && (
                        <span
                          className="text-givvy text-xs cursor-help whitespace-nowrap underline decoration-dotted"
                          title={
                            s.compSales === 0
                              ? `No sales behind this price - it came from live asking prices, which is what sellers hope for rather than what anyone paid. ${s.compSource}`
                              : `Only ${s.compSales} sale${s.compSales === 1 ? "" : "s"} in the last 30 days is behind this price, so one odd sale decides it. Check it before quoting. ${s.compSource}`
                          }
                        >
                          {s.compSales === 0 ? "asks only" : `${s.compSales} sale${s.compSales === 1 ? "" : "s"}`}
                        </span>
                      )}
                    </div>
                    <PriceContext
                      market={s.market ?? null}
                      marketBasis={s.marketBasis || ""}
                      lastSale={s.lastSale ?? null}
                      comp={s.comp}
                      condition={s.condition}
                    />
                    {s.compDate && <div className="text-dim text-[10px]">{s.compSource} {s.compDate}</div>}

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
                      onClick={(e) => openMenu(s.id, e.currentTarget)}
                      aria-label="Row actions"
                    >
                      {"\u22EF"}
                    </button>
                    {menuFor === s.id && (
                      <div
                        data-row-menu
                        className="fixed z-50 w-44 rounded-lg border border-edge bg-panel shadow-2xl py-1 text-left max-h-[80vh] overflow-y-auto"
                        style={{
                          left: menuPos ? menuPos.left : undefined,
                          top: menuPos ? menuPos.top : undefined,
                          transform: menuPos?.up ? "translateY(-100%)" : undefined,
                        }}
                      >
                        {["Raw", "NM", "LP", "MP", "HP", "DM"].includes(s.condition) && s.cardId && (
                          <button
                            className="block w-full text-left px-3 py-1.5 text-sm text-body hover:bg-edge/50 disabled:opacity-40"
                            disabled={busy === s.id}
                            onClick={() => { setMenuFor(null); refreshComp(s.id); }}
                          >
                            {busy === s.id ? "Refreshing..." : "Refresh comp"}
                          </button>
                        )}
                        {/* Condition, changeable in place.
                            Grading a card by eye is the one judgement the feed
                            cannot make, and getting it wrong moves the price by
                            more than anything else here: NM to MP is a third of
                            the value gone. It sits behind the row menu rather
                            than on the cell so it cannot be nudged by a stray
                            click while scrolling a 250-row table. */}
                        <div className="px-3 pt-1.5 pb-1">
                          <div className="label !text-[10px] mb-1">Condition</div>
                          <div className="flex flex-wrap gap-1">
                            {RAW_CONDITIONS.map((c) => (
                              <button
                                key={c}
                                disabled={busy === s.id}
                                className={`num text-[11px] rounded px-1.5 py-0.5 border disabled:opacity-40 ${
                                  s.condition === c
                                    ? "border-foil text-foil bg-foil/10"
                                    : "border-edge text-dim hover:text-body hover:border-foil/50"
                                }`}
                                onClick={() => { setMenuFor(null); setCondition(s, c); }}
                              >
                                {c}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="border-t border-edge/60 my-1" />
                        {(s.qty || 1) > 1 && s.status === "In Stock" && (
                          <button
                            className="block w-full text-left px-3 py-1.5 text-sm text-body hover:bg-edge/50 disabled:opacity-40"
                            disabled={busy === s.id}
                            onClick={() => { setMenuFor(null); splitCard(s); }}
                          >
                            Split into {s.qty} cards
                            <span className="block text-dim text-[10px]">one sticker each</span>
                          </button>
                        )}
                        <button
                          className="block w-full text-left px-3 py-1.5 text-sm text-body hover:bg-edge/50"
                          onClick={async () => {
                            setMenuFor(null);
                            const next = s.language === "Japanese" ? "English" : "Japanese";
                            await fetch(`/api/singles/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: next }) });
                            await load();
                          }}
                        >
                          Mark {s.language === "Japanese" ? "English" : "Japanese"}
                        </button>
                        <button
                          className="block w-full text-left px-3 py-1.5 text-sm text-body hover:bg-edge/50"
                          onClick={async () => {
                            setMenuFor(null);
                            setQrFor(s);
                            setQrData(await QRCode.toDataURL(`${window.location.origin}/label/${s.id}`, { margin: 1, width: 280 }));
                          }}
                        >
                          View QR code
                        </button>
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
                <tr><td colSpan={isAdmin ? 11 : 9} className="text-dim">No cards here yet - add one above</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {isAdmin && (
          <p className="text-dim text-xs">
            Tick the boxes to select cards, shift-click to grab a run of them, then delete the whole selection at once.
            Cards sitting on a stream are skipped.
          </p>
        )}
        <p className="text-dim text-xs">
          Cards get pulled onto a Single Stream from the stream editor. When a sale price is entered there,
          the card flips to Sold here automatically. Removing it from the stream puts it back In Stock.
        </p>
      </section>
      {qrFor && qrData && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setQrFor(null)}>
          <div className="card p-6 max-w-sm w-full text-center space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold">{qrFor.name.replace(/\s*-\s*[\w]+\/[\w]+\s*$/, "")}</h3>
            <p className="text-dim text-xs">{qrFor.setName} #{qrFor.number} - {qrFor.condition}{qrFor.location ? ` - ${qrFor.location}` : ""}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrData} alt="QR code" className="mx-auto rounded bg-white p-2" style={{ width: 280, height: 280 }} />
            <p className="text-dim text-xs">
              This code is permanent for this card - it always resolves to the same quick-sell page,
              so reprints and old stickers keep working. Scan it to open the card.
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              <a className="btn-ghost !py-1.5 text-sm" href={qrData} download={"qr-" + qrFor.id + ".png"}>Download PNG</a>
              <a className="btn-ghost !py-1.5 text-sm" href={"/label/" + qrFor.id} target="_blank" rel="noreferrer">Open quick-sell {"\u2197"}</a>
              <button className="btn-ghost !py-1.5 text-sm" onClick={() => setQrFor(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// Physical location code cell: click to edit, shows #B1-12 style badges.
function LocCell({ value, canEdit, onSave }: { value: string; canEdit: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (!canEdit) return value ? <span className="text-xs font-bold text-foil">#{value}</span> : <span className="text-dim">-</span>;
  if (!editing)
    return (
      <button className="text-xs hover:bg-white/5 rounded px-1 py-0.5 -mx-1" onClick={() => setEditing(true)} title="Click to set a location code like B1-12">
        {value ? <span className="font-bold text-foil">#{value}</span> : <span className="text-dim">set</span>}
      </button>
    );
  return (
    <input
      autoFocus
      className="input !py-0.5 !px-1.5 w-20 text-xs uppercase"
      value={v}
      placeholder="B1-12"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { setEditing(false); if (v.trim() !== value) onSave(v.trim()); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setV(value); setEditing(false); } }}
    />
  );
}
