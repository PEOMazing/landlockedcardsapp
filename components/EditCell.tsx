"use client";
import { useEffect, useRef, useState } from "react";

// Values read as text until clicked, then become an input. Enter or blur
// saves, Escape cancels. Empty required values get a quiet amber treatment.
export default function EditCell({
  value,
  onSave,
  money = true,
  step = "0.01",
  highlightEmpty = false,
  placeholder = "-",
  align = "right",
}: {
  value: number | null;
  onSave: (v: number) => void | Promise<void>;
  money?: boolean;
  step?: string;
  highlightEmpty?: boolean;
  placeholder?: string;
  align?: "right" | "left";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  const empty = value === null || value === 0;
  const display = empty
    ? placeholder
    : money
      ? "$" + (value as number).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : String(value);

  function commit() {
    setEditing(false);
    const v = parseFloat(draft);
    if (isNaN(v) || v === value) return;
    onSave(Math.max(0, v));
  }

  if (editing) {
    return (
      <input
        ref={ref}
        type="number"
        step={step}
        className="input !w-24 !py-1 text-right"
        defaultValue={value ?? ""}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
        autoFocus
      />
    );
  }

  return (
    <button
      className={`num rounded px-2 py-1 -mx-2 text-sm hover:bg-edge/60 transition-colors text-${align} ${
        empty
          ? highlightEmpty
            ? "text-amber-400 border border-amber-400/40 bg-amber-400/5"
            : "text-dim"
          : ""
      }`}
      title="Click to edit"
      onClick={() => { setDraft(String(value ?? "")); setEditing(true); }}
    >
      {display}
    </button>
  );
}
