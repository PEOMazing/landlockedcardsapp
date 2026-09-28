"use client";
import { useState } from "react";

// Copy for pasting into a show, or download as a CSV with quantity in its
// own column for spreadsheets and Whatnot bulk tools.

// The mark that goes on a hit in the exported list. One symbol, on the hits
// only.
//
// This replaced a five-rung ladder of emoji by price - sparkle at $5, star at
// $20, fire at $50, gem at $100, money at $200. The problem was not the
// symbols, it was that the list stopped saying anything: almost every line
// carried one, and a buyer scanning forty titles has to learn and rank five
// marks before any of them mean something. One mark on the cards that are
// actually worth spinning for reads instantly, and a clean name on everything
// else is what makes the mark stand out.
const HIT_MARK = "\u{1F525}";

type Line = { qty: number; name: string; market?: number; isHit?: boolean };

export default function CopyShowSet({ lines, streamTitle = "show-set" }: { lines: Line[]; streamTitle?: string }) {
  const [copied, setCopied] = useState(false);
  const text = lines.map((l) => `${l.qty}x ${l.name}`).join("\n");

  function downloadCsv() {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    // Export only - the app itself keeps clean names. isHit comes down from
    // the server already decided, so the list marks exactly what the board
    // shows and the hit stats count. Working it out again from the price here
    // would be a second definition of a hit, free to drift from the first.
    const mark = (l: Line) => (l.isHit ? `${HIT_MARK} ` : "");
    const csv = ["Product,Description,Quantity", ...lines.map((l) => `${esc(mark(l) + l.name)},,${l.qty}`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${streamTitle.replace(/[^\w-]+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <span className="inline-flex gap-2">
      <button
        className={copied ? "btn-win" : "btn-ghost"}
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        disabled={lines.length === 0}
      >
        {copied ? "Copied - paste into your show" : "Copy show set"}
      </button>
      <button className="btn-ghost" onClick={downloadCsv} disabled={lines.length === 0}>
        Export CSV
      </button>
    </span>
  );
}
