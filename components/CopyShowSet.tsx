"use client";
import { useState } from "react";
import { HIT_MARK, conditionInText, whatnotLine } from "@/lib/showSetTitle";

// The show set, ready to paste straight into Whatnot.
//
// This used to copy the app's own display text and keep the hit mark for the
// CSV only. Both of those were wrong for the one job the button has.
//
// Whatnot sent a policy violation for a set whose listings carried no
// condition, and the sale report for that show said why: 44 card listings, 0
// with a condition in the title, while every line the app had written carried
// one. Something between the paste and the listing rewrites the middle of a
// title. What it leaves alone is bracketed text and emoji - the 33 listings
// that were wrapped in emoji came through with their full text, including the
// set names the bare ones lost.
//
// So the pasted line now puts the condition inside the leading bracket next to
// the binder slot, and the hit mark wraps the title rather than being dropped
// on the way to the clipboard.

type Line = {
  qty: number;
  /** The app's own display text. Still used as the fallback. */
  name: string;
  /** Built server side from the card itself: [0368 NM] Eevee - 200 #SVP 200 */
  exportTitle?: string;
  /** Brand and set, for the CSV column Whatnot also reads. */
  exportDescription?: string;
  market?: number;
  isHit?: boolean;
};

const titleOf = (l: Line) => l.exportTitle || l.name;

export default function CopyShowSet({ lines, streamTitle = "show-set" }: { lines: Line[]; streamTitle?: string }) {
  const [copied, setCopied] = useState(false);
  const text = lines
    .map((l) => whatnotLine({ qty: l.qty, name: titleOf(l), isHit: l.isHit }))
    .join("\n");

  // Counted before the paste, not discovered from a violation two days later.
  const uncompliant = lines.filter((l) => !conditionInText(titleOf(l)));

  function downloadCsv() {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [
      "Product,Description,Quantity",
      ...lines.map((l) => {
        const t = titleOf(l);
        const product = l.isHit ? `${HIT_MARK}${t}${HIT_MARK}` : t;
        return `${esc(product)},${esc(l.exportDescription || "")},${l.qty}`;
      }),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${streamTitle.replace(/[^\w-]+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <span className="inline-flex gap-2 items-center flex-wrap">
      <button
        className={copied ? "btn-win" : "btn-ghost"}
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        disabled={lines.length === 0}
      >
        {copied ? "Copied - paste into Whatnot" : "Copy show set"}
      </button>
      <button className="btn-ghost" onClick={downloadCsv} disabled={lines.length === 0}>
        Export CSV
      </button>
      {uncompliant.length > 0 && (
        <span className="t-meta text-warn" title={uncompliant.map((l) => titleOf(l)).join("\n")}>
          {uncompliant.length} line{uncompliant.length === 1 ? "" : "s"} with no condition in the title
        </span>
      )}
    </span>
  );
}
