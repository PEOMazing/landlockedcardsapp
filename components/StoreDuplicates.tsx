"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/Toaster";

// sd-v2. A show set that has been mass mis-booked: dozens of shelf sales of
// dozens of different listings all landed on one inventory product. Removing
// them one at a time is about six Airtable calls each, which goes over the
// rate limit in under a second, so some deletes fail, the page's own reload
// gets rate limited too, and the whole thing reads as "the lines will not
// delete". They delete. The confirmation never arrives.
//
// This takes them out in one batch request and puts back any stock they took.
// It only appears when there is something to take out.

const money = (n: number) => "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Preview = { count: number; phantomCost: number; unitsToRestore: number; name: string; threshold: number };

export default function StoreDuplicates({ streamId, onChange }: { streamId: string; onChange: () => Promise<void> }) {
  const [p, setP] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    try {
      const r = await fetch(`/api/streams/${streamId}/store-duplicates`);
      if (!r.ok) return;
      setP(await r.json());
    } catch {}
  }, [streamId]);

  useEffect(() => { check(); }, [check]);

  if (!p || p.count === 0) return null;

  async function remove() {
    if (!confirm(`Remove ${p!.count} duplicate store lines from this show? Any stock they took comes back. This cannot be undone.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/streams/${streamId}/store-duplicates`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.error || "Could not remove them", "bad"); setBusy(false); return; }
      const back = Object.entries(d.restored || {}).map(([n, u]) => `${u} ${n} back on the shelf`);
      toast(`${d.removed} duplicate line${d.removed === 1 ? "" : "s"} removed${back.length ? `, ${back.join(", ")}` : ""}`, "ok");
      await onChange();
      await check();
    } catch {
      toast("Could not reach the server", "bad");
    }
    setBusy(false);
  }

  return (
    <div className="rounded-lg border border-bad/50 bg-bad/10 p-3 space-y-2">
      <div className="label text-bad">This show has duplicate store lines</div>
      <p className="text-sm leading-snug">
        {p.count} store lines on this show are all the same item
        {p.name ? <> - <span className="font-medium">{p.name.replace(/^\d+x\s+/, "")}</span></> : null} - with no Whatnot
        order id between them. That is a mis-booking rather than {p.count} real sales, and it is putting{" "}
        <span className="num font-semibold">{money(p.phantomCost)}</span> of product cost on this show.
      </p>
      <p className="text-dim t-meta">
        Removing them takes one request instead of {p.count}, so it will not trip Airtable&apos;s rate limit the way
        deleting them one by one does.
        {p.unitsToRestore > 0 ? ` ${p.unitsToRestore} unit${p.unitsToRestore === 1 ? "" : "s"} of stock comes back.` : " No stock was taken, so none comes back."}
      </p>
      <button className="btn-foil !py-1.5 text-xs disabled:opacity-40" disabled={busy} onClick={remove}>
        {busy ? "Removing..." : `Remove ${p.count} duplicate lines`}
      </button>
    </div>
  );
}
