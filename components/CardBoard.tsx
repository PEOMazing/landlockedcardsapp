"use client";
import { useCallback, useEffect, useState } from "react";
import Thumb from "@/components/Thumb";
import { toast } from "@/components/Toaster";

// The streamer's control for the OBS card board.
//
// The board itself lives at /overlay/<key> and is driven entirely by data, so
// there is nothing to drag around in OBS mid-show: add the Browser Source once
// and it follows the stream for the rest of the night. A card leaves the board
// when it is hit, and this panel is the other way - a checkbox per card for
// taking one off screen without claiming anyone won it.

const $ = (n: number) => `$${(n || 0).toFixed(2)}`;

type Line = {
  id: string; name: string; qty: number; qtyHit: number; market: number;
  isGiveaway?: boolean; isStore?: boolean; image?: string; offBoard?: boolean;
  singleRecId?: string;
};

export default function CardBoard({
  streamId,
  lines,
  onChanged,
}: {
  streamId: string;
  lines: Line[];
  onChanged: () => Promise<void> | void;
}) {
  const [url, setUrl] = useState("");
  const [kinds, setKinds] = useState({ singles: true, sealed: true });
  const [layout, setLayout] = useState<"grid" | "banner">("grid");
  const [hitThreshold, setHitThreshold] = useState(0);
  const [speed, setSpeed] = useState(1);
  // The price at which a card starts to shine. 0 is off, and it is a real
  // value rather than a blank, so it round-trips like any other setting.
  const [shine, setShine] = useState(0);
  const [shineDraft, setShineDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string>("");

  const loadUrl = useCallback(async () => {
    try {
      const r = await fetch(`/api/streams/${streamId}/overlay`);
      if (!r.ok) return;
      const d = await r.json();
      setUrl(d.url || "");
      if (d.kinds) setKinds(d.kinds);
      if (d.layout) setLayout(d.layout);
      if (Number(d.speed) > 0) setSpeed(Number(d.speed));
      if (Number.isFinite(Number(d.shine))) {
        setShine(Number(d.shine));
        setShineDraft(Number(d.shine) > 0 ? String(Number(d.shine)) : "");
      }
      if (typeof d.hitThreshold === "number") setHitThreshold(d.hitThreshold);
    } catch {}
  }, [streamId]);
  useEffect(() => { loadUrl(); }, [loadUrl]);

  // Only cards that could be on the board. Giveaways and store sales never
  // belong there, a card with no art cannot be drawn, and anything under the
  // hit threshold is not what the board is advertising.
  const eligible = lines.filter(
    (l) => !l.isGiveaway && !l.isStore && l.image && (l.market || 0) >= hitThreshold,
  );
  const remaining = eligible.filter((l) => l.qty - l.qtyHit > 0);
  const kindOk = (l: Line) => (l.singleRecId ? kinds.singles : kinds.sealed);
  const showing = remaining.filter((l) => !l.offBoard && kindOk(l));
  const singlesLeft = remaining.filter((l) => l.singleRecId).length;
  const sealedLeft = remaining.length - singlesLeft;
  // What the streamer is about to see, counted the same way the board counts
  // it. Worth showing: "$50 and up" means nothing until you know it is four
  // cards tonight and twenty-six tomorrow.
  const shinyCount = shine > 0 ? showing.filter((l) => (l.market || 0) >= shine).length : 0;

  async function setBoardSpeed(next: number) {
    const prev = speed;
    setSpeed(next);
    const r = await fetch(`/api/streams/${streamId}/overlay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speed: next }),
    });
    if (!r.ok) { setSpeed(prev); toast("Could not change the speed"); }
  }

  async function setBoardShine(next: number) {
    const prev = shine;
    setShine(next);
    setShineDraft(next > 0 ? String(next) : "");
    const r = await fetch(`/api/streams/${streamId}/overlay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shine: next }),
    });
    if (!r.ok) {
      setShine(prev);
      setShineDraft(prev > 0 ? String(prev) : "");
      toast("Could not change the shine");
    }
  }

  async function setBoardLayout(next: "grid" | "banner") {
    if (next === layout) return;
    const prev = layout;
    setLayout(next);
    const r = await fetch(`/api/streams/${streamId}/overlay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: next }),
    });
    if (!r.ok) { setLayout(prev); toast("Could not change the layout"); }
  }

  async function setKind(which: "singles" | "sealed", on: boolean) {
    // Never let both go off - that is an empty board and always a mistake
    // rather than a choice, and it is a confusing one to recover from mid-show.
    const next = { ...kinds, [which]: on };
    if (!next.singles && !next.sealed) {
      toast("Turn the other one on first - the board cannot show nothing");
      return;
    }
    setKinds(next);
    const r = await fetch(`/api/streams/${streamId}/overlay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [which]: on }),
    });
    if (!r.ok) { setKinds(kinds); toast("Could not change the board"); }
  }

  async function toggle(l: Line) {
    setSaving(l.id);
    const res = await fetch(`/api/lines/${l.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offBoard: !l.offBoard }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d.error || "Could not change the board");
    } else {
      await onChanged();
    }
    setSaving("");
  }

  async function setAll(offBoard: boolean) {
    const targets = remaining.filter((l) => !!l.offBoard !== offBoard);
    if (!targets.length) return;
    setSaving("all");
    for (const l of targets) {
      await fetch(`/api/lines/${l.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offBoard }),
      }).catch(() => {});
    }
    await onChanged();
    setSaving("");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast("Overlay link copied - add it in OBS as a Browser Source");
    } catch {
      // clipboard is blocked in plenty of browsers; the box below is selectable
      toast("Select the link and copy it");
    }
  }

  async function rotate() {
    if (!confirm("Make a new link? The old one stops working immediately, and any OBS source using it goes blank until you paste the new one.")) return;
    const r = await fetch(`/api/streams/${streamId}/overlay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rotate: true }),
    });
    if (r.ok) { setUrl((await r.json()).url || ""); toast("New link made - paste it into OBS"); }
    else toast("Could not make a new link");
  }

  if (eligible.length === 0) return null;

  return (
    <div className="space-y-2 border border-edge rounded-lg p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="label">Card board (OBS)</span>
        <span className="text-dim text-xs">
          <span className="num">{showing.length}</span> of{" "}
          <span className="num">{remaining.length}</span> on screen
          {hitThreshold > 0 && <> · hits are ${hitThreshold}+</>}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input className="input flex-1 !text-xs num" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn-foil !px-3 !py-1 text-xs" onClick={copy} disabled={!url}>Copy link</button>
        <a className="btn !px-3 !py-1 text-xs" href={url || "#"} target="_blank" rel="noreferrer">Preview</a>
      </div>
      <p className="text-dim text-xs">
        In OBS: Sources, add a Browser Source, paste the link and tick Shutdown source when not
        visible. Size it to your full canvas for the grid, or something like 1920 x 420 for the
        scrolling banner - the cards scale to whatever height you give it, so do not go small or
        the art renders soft. The background is fully transparent and a card disappears the moment
        you mark it hit.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setKind("singles", !kinds.singles)}
          className={`!px-3 !py-1 text-xs ${kinds.singles ? "btn-foil" : "btn opacity-60"}`}
        >
          {kinds.singles ? "Including singles" : "Include singles"}
          <span className="num ml-1.5 opacity-70">{singlesLeft}</span>
        </button>
        <button
          type="button"
          onClick={() => setKind("sealed", !kinds.sealed)}
          className={`!px-3 !py-1 text-xs ${kinds.sealed ? "btn-foil" : "btn opacity-60"}`}
        >
          {kinds.sealed ? "Including sealed" : "Include sealed"}
          <span className="num ml-1.5 opacity-70">{sealedLeft}</span>
        </button>

        <div className="flex items-center gap-1 rounded-lg border border-edge px-2 py-0.5 text-xs ml-auto">
          <span className="text-dim">layout</span>
          <button
            type="button"
            className={layout === "grid" ? "text-foil px-1" : "text-dim hover:text-body px-1"}
            onClick={() => setBoardLayout("grid")}
            title="Fills the whole canvas and grows the cards as the board empties"
          >
            grid
          </button>
          <button
            type="button"
            className={layout === "banner" ? "text-foil px-1" : "text-dim hover:text-body px-1"}
            onClick={() => setBoardLayout("banner")}
            title="One row that scrolls, for a strip along the bottom of the scene. Set the Browser Source to something like 1920 x 420."
          >
            scrolling banner
          </button>
        </div>
      </div>

      {/* Which cards get the foil treatment. Priced rather than counted, so it
          keeps meaning the same thing as the set changes underneath it. */}
      <div className="flex items-center gap-1 flex-wrap text-xs">
        <span className="text-dim">shine at</span>
        <div className={`flex items-center gap-1 rounded border px-1.5 py-0.5 ${shine > 0 ? "border-foil/60 bg-foil/10" : "border-edge"}`}>
          <span className={shine > 0 ? "text-foil" : "text-dim"}>$</span>
          <input
            className="input !w-16 !px-1 !py-0.5 !text-xs num"
            inputMode="decimal"
            placeholder="off"
            value={shineDraft}
            onChange={(e) => setShineDraft(e.target.value)}
            onBlur={() => {
              const n = Math.max(0, parseFloat(shineDraft) || 0);
              if (n !== shine) setBoardShine(n);
              else setShineDraft(shine > 0 ? String(shine) : "");
            }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
        </div>
        {[0, 25, 50, 100, 250].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setBoardShine(v)}
            className={`px-2 py-0.5 rounded border num ${
              shine === v ? "border-foil text-foil" : "border-edge text-dim hover:text-body"
            }`}
          >
            {v === 0 ? "off" : `$${v}`}
          </button>
        ))}
        <span className="text-dim">
          {shine > 0
            ? `${shinyCount} card${shinyCount === 1 ? "" : "s"} on screen will foil`
            : "cards render flat"}
        </span>
      </div>
      {shinyCount > 12 && (
        <p className="text-warn text-xs">
          That is a lot of cards shimmering at once. It is your streaming machine drawing every
          frame of it, so if OBS starts dropping frames, raise the number until only the chase
          cards foil.
        </p>
      )}

      {/* Only means anything to the banner, so it only appears for the banner. */}
      {layout === "banner" && (
        <div className="flex items-center gap-1 flex-wrap text-xs">
          <span className="text-dim">scroll speed</span>
          {[0.75, 1, 1.25, 1.5, 1.75, 2, 3].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setBoardSpeed(m)}
              className={`px-2 py-0.5 rounded border num ${
                Math.abs(speed - m) < 0.01
                  ? "border-foil text-foil"
                  : "border-edge text-dim hover:text-body"
              }`}
            >
              {m}x
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          className="text-dim hover:text-body underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide cards" : `Choose what is on screen (${remaining.length})`}
        </button>
        {open && remaining.length > 0 && (
          <>
            <button type="button" className="text-foil hover:underline" disabled={saving === "all"} onClick={() => setAll(false)}>
              all on
            </button>
            <button type="button" className="text-dim hover:text-body hover:underline" disabled={saving === "all"} onClick={() => setAll(true)}>
              all off
            </button>
            {saving === "all" && <span className="text-dim">working...</span>}
          </>
        )}
        <a className="text-dim hover:text-body underline ml-auto" onClick={rotate} role="button" tabIndex={0}>
          new link
        </a>
      </div>

      {open && (
        <div className="grid gap-1 max-h-72 overflow-auto">
          {remaining.map((l) => (
            <label
              key={l.id}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 cursor-pointer ${
                l.offBoard || !kindOk(l) ? "border-edge opacity-50" : "border-foil/40"
              }`}
              title={kindOk(l) ? "" : `Hidden by the ${l.singleRecId ? "singles" : "sealed"} filter`}
            >
              <input
                type="checkbox"
                checked={!l.offBoard}
                disabled={saving === l.id || saving === "all"}
                onChange={() => toggle(l)}
              />
              {l.image && <Thumb src={l.image} size={26} className="shrink-0" />}
              <span className="text-sm truncate">{l.name}</span>
              <span className="num text-xs text-dim ml-auto shrink-0">{$(l.market)}</span>
            </label>
          ))}
          {remaining.length === 0 && (
            <div className="text-dim text-sm">Every card has been hit. The board is empty.</div>
          )}
        </div>
      )}
    </div>
  );
}
