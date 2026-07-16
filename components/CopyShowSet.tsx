"use client";
import { useState } from "react";

// Copy for pasting into a show, or download as a CSV with quantity in its
// own column for spreadsheets and Whatnot bulk tools.
export default function CopyShowSet({ lines, streamTitle = "show-set" }: { lines: { qty: number; name: string; market?: number }[]; streamTitle?: string }) {
  const [copied, setCopied] = useState(false);
  const text = lines.map((l) => `${l.qty}x ${l.name}`).join("\n");

  function downloadCsv() {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    // hype tiers by market value, export-only: the app keeps clean names
    const hype = (m?: number) => !m || m < 20 ? "" : m >= 200 ? "\u{1F4B0} " : m >= 100 ? "\u{1F48E} " : m >= 50 ? "\u{1F525} " : "\u2B50 ";
    const csv = ["Product,Description,Quantity", ...lines.map((l) => `${esc(hype(l.market) + l.name)},,${l.qty}`)].join("\n");
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
