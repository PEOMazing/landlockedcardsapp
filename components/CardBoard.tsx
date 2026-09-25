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
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string>("");

  const loadUrl = useCallback(async () => {
    try {
      const r = await fetch(`/api/streams/${streamId}/overlay`);
      if (r.ok) setUrl((await r.json()).url || "");
    } catch {}
  }, [streamId]);
  useEffect(() => { loadUrl(); }, [loadUrl]);

  // Only cards that could be on the board. Giveaways and store sales never
  // belong there, and a card with no art cannot be drawn.
  const eligible = lines.filter((l) => !l.isGiveaway && !l.isStore && l.image);
  const remaining = eligible.filter((l) => l.qty - l.qtyHit > 0);
  const showing = remaining.filter((l) => !l.offBoard);

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
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input className="input flex-1 !text-xs num" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn-foil !px-3 !py-1 text-xs" onClick={copy} disabled={!url}>Copy link</button>
        <a className="btn !px-3 !py-1 text-xs" href={url || "#"} target="_blank" rel="noreferrer">Preview</a>
      </div>
      <p className="text-dim text-xs">
        In OBS: Sources, add a Browser Source, paste the link, set the size to your canvas
        (1920 x 1080) and tick Shutdown source when not visible. The background is transparent,
        the tiles grow as cards come off, and a card disappears the moment you mark it hit.
      </p>

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
                l.offBoard ? "border-edge opacity-50" : "border-foil/40"
              }`}
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
