"use client";
import { useState } from "react";

export default function CopyShowSet({ lines }: { lines: { qty: number; name: string }[] }) {
  const [copied, setCopied] = useState(false);
  const text = lines.map((l) => `${l.qty}x ${l.name}`).join("\n");
  return (
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
  );
}
