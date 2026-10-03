"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Cmd+K.
//
// This app is 20 screens and 63 routes reached by clicking through a sidebar,
// and the thing you want is usually a specific card out of 800 or a specific
// product out of 1,200. Navigation was the tax on every task.
//
// Three decisions worth stating:
//
// The index loads once, on first open, and is held for the session. Opening a
// search box should never cost a round trip, and the alternative (query the
// server per keystroke) is exactly the latency this is meant to remove.
//
// Matching is all-tokens-must-appear, not fuzzy. Fuzzy matching feels clever
// in a demo and is miserable on a list where "151" and "1st" and "15" are all
// real, distinct things. Typing more always narrows.
//
// Actions sit in the same list as destinations, because "start a new show" and
// "go to the show page" are the same intent at different distances.

type Row = { id: string; label: string; sub: string; href: string; kind: string };
type Index = { singles: Row[]; products: Row[]; streams: Row[] };

const PAGES: { label: string; sub: string; href: string; manager?: boolean; admin?: boolean }[] = [
  { label: "Singles", sub: "the card inventory", href: "/singles" },
  { label: "Inventory", sub: "sealed product", href: "/admin/inventory", manager: true },
  { label: "All Streams", sub: "every show", href: "/admin/streams", manager: true },
  { label: "Collection", sub: "what the business owns", href: "/collection" },
  { label: "Movers", sub: "biggest price changes", href: "/singles/movers" },
  { label: "Card Show", sub: "the public catalog", href: "/show" },
  { label: "Set Lists", sub: "saved master sets", href: "/sets" },
  { label: "Quote", sub: "price a pile of cards", href: "/quote", manager: true },
  { label: "Audit", sub: "reconcile the shelf", href: "/admin/audit", manager: true },
  { label: "Payroll", sub: "what is owed this period", href: "/admin/payroll", manager: true },
  { label: "Analytics", sub: "show performance", href: "/admin/analytics", admin: true },
  { label: "Insights", sub: "per person", href: "/admin/insights", admin: true },
  { label: "Pay settings", sub: "commission ladder and rates", href: "/admin/settings", admin: true },
];

const ACTIONS: { label: string; sub: string; href: string; manager?: boolean }[] = [
  { label: "New show", sub: "build a set for tonight", href: "/streams/new" },
  { label: "Print labels", sub: "stickers for the current selection", href: "/singles/labels", manager: true },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export default function CommandPalette({ isAdmin = false, isManager = false }: { isAdmin?: boolean; isManager?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [index, setIndex] = useState<Index | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allowed = useCallback(
    (i: { manager?: boolean; admin?: boolean }) => (i.admin ? isAdmin : i.manager ? isManager || isAdmin : true),
    [isAdmin, isManager],
  );

  // Cmd+K anywhere, and the slash key when you are not already typing. Escape
  // closes. Deliberately not bound inside an input, or typing "/" in a search
  // box would open a second search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName || "");
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    // A keyboard shortcut nobody knows about is a feature for one person. The
    // sidebar carries a visible search button that fires this, so the palette
    // is discoverable by clicking and fast by typing.
    const onAsk = () => setOpen(true);
    window.addEventListener("palette:open", onAsk);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("palette:open", onAsk);
    };
  }, [open]);

  // Load the index the first time it is opened, not on page load: most page
  // views never open the palette and should not pay for it.
  useEffect(() => {
    if (!open || index || loading) return;
    setLoading(true);
    fetch("/api/search")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setIndex(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, index, loading]);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      // rAF, because the input does not exist until this render commits
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const groups = useMemo(() => {
    const tokens = norm(q).split(" ").filter(Boolean);
    const hit = (r: { label: string; sub: string }) => {
      if (tokens.length === 0) return true;
      const hay = norm(`${r.label} ${r.sub}`);
      return tokens.every((t) => hay.includes(t));
    };

    const pages = PAGES.filter(allowed).filter(hit).map((p) => ({ ...p, id: p.href, kind: "Go to" }));
    const actions = ACTIONS.filter(allowed).filter(hit).map((p) => ({ ...p, id: p.href, kind: "Do" }));

    // With no query the palette is a launcher, so it shows where you can go
    // rather than the first twelve cards in the binder.
    if (tokens.length === 0) {
      return [
        { kind: "Do", rows: actions as Row[] },
        { kind: "Go to", rows: pages as Row[] },
      ].filter((g) => g.rows.length > 0);
    }

    const cards = (index?.singles || []).filter(hit).slice(0, 8);
    const products = (index?.products || []).filter(hit).slice(0, 6);
    const shows = (index?.streams || []).filter(hit).slice(0, 5);

    return [
      { kind: "Do", rows: actions as Row[] },
      { kind: "Go to", rows: pages as Row[] },
      { kind: "Cards", rows: cards },
      { kind: "Products", rows: products },
      { kind: "Shows", rows: shows },
    ].filter((g) => g.rows.length > 0);
  }, [q, index, allowed]);

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  useEffect(() => setCursor(0), [q]);

  const go = useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      setOpen(false);
      router.push(row.href);
    },
    [router],
  );

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(flat[cursor]); }
    else if (e.key === "Home") { e.preventDefault(); setCursor(0); }
    else if (e.key === "End") { e.preventDefault(); setCursor(flat.length - 1); }
  }

  // Keep the highlighted row on screen when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  let i = -1;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center px-s4 pt-[18vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div
        className="palette relative w-full max-w-[34rem] card lifted overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-s3 border-b border-edge px-s4">
          <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-dim" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search cards, products, shows, or jump to a page"
            aria-label="Search"
            className="flex-1 bg-transparent border-0 outline-none py-s4 t-body placeholder:text-dim/70"
          />
          {loading && <span className="t-meta text-dim shrink-0">loading</span>}
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-s2">
          {flat.length === 0 && (
            <p className="px-s4 py-s4 text-dim t-body">
              {index ? `Nothing matches "${q.trim()}"` : "Still loading the index, try again in a second"}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.kind} className="mb-s2 last:mb-0">
              <div className="label px-s4 py-s1">{g.kind}</div>
              {g.rows.map((row) => {
                i++;
                const active = i === cursor;
                const myIndex = i;
                return (
                  <button
                    key={`${g.kind}-${row.id}`}
                    data-i={myIndex}
                    type="button"
                    onMouseEnter={() => setCursor(myIndex)}
                    onClick={() => go(row)}
                    className={`w-full text-left px-s4 py-s2 flex items-baseline gap-s3 ${
                      active ? "bg-foil/12 text-body" : "text-body hover:bg-edge/40"
                    }`}
                  >
                    <span className={`min-w-0 flex-1 truncate t-body ${active ? "font-semibold" : ""}`}>{row.label}</span>
                    {row.sub && <span className="t-meta text-dim shrink-0 max-w-[45%] truncate">{row.sub}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="border-t border-edge px-s4 py-s2 flex items-center gap-s4 t-meta text-dim">
          <span><kbd className="kbd">&uarr;</kbd><kbd className="kbd">&darr;</kbd> move</span>
          <span><kbd className="kbd">&crarr;</kbd> open</span>
          <span><kbd className="kbd">esc</kbd> close</span>
          <span className="ml-auto">{flat.length} result{flat.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}
