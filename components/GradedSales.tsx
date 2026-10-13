"use client";
import { useState } from "react";
import GradeStrip, { type GradedData } from "@/components/GradeStrip";

const $ = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

// gs-v1. "PSA" chip on a raw card in the singles list. Click it and it says
// what the card last sold for at each PSA grade, 10 down to 6.
//
// Click rather than hover, unlike the solds chip beside it, because this one
// spends a request against a monthly quota. Hovering a list while scanning it
// would burn the month in an afternoon.
//
// Fetched once per card per page load and kept, so re-opening the chip shows
// what you already paid for rather than paying again.

export default function GradedSales({ cardId, rawComp }: { cardId: string; rawComp: number | null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<GradedData | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (data || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/singles/graded-sales?id=${encodeURIComponent(cardId)}`);
      setData(await r.json());
    } catch {
      setData({ configured: true, error: "could not reach the server" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        title="What this card last sold for graded, PSA 10 down to 6"
        className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
          open ? "border-foil/60 bg-foil/15 text-foil" : "border-edge text-dim hover:text-body"
        }`}
      >
        PSA
      </button>

      {open && (
        <div
          className="absolute z-40 left-0 top-full mt-1 w-80 card p-3 space-y-2"
          onClick={(e) => e.stopPropagation()}
        >
          {busy && <div className="text-dim text-xs">Looking up graded sales...</div>}
          {!busy && data && (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="label">Last PSA sale</span>
                {rawComp ? <span className="text-dim text-xs num">raw {$(rawComp)}</span> : null}
              </div>
              <GradeStrip data={data} />
              {data.byGrade && (
                <div className="text-dim text-xs pt-1 border-t border-edge">
                  {/* The query is shown because it is the thing most likely to
                      be wrong. Five empty columns is usually a title mismatch,
                      not a card nobody grades, and this is how you tell. */}
                  searched &ldquo;{data.query}&rdquo;
                  {typeof data.considered === "number" && `, ${data.considered} sales read`}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
