"use client";
import { useEffect, useState } from "react";

// Fire-and-forget notifications from anywhere: toast("Saved") or
// toast("Something broke", "bad"). The Toaster below listens globally.
export function toast(message: string, kind: "ok" | "bad" = "ok") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("llc-toast", { detail: { message, kind, id: Date.now() + Math.random() } }));
}

type ToastItem = { id: number; message: string; kind: "ok" | "bad" };

export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    function onToast(e: Event) {
      const d = (e as CustomEvent).detail as ToastItem;
      setItems((prev) => [...prev.slice(-3), d]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== d.id)), 2600);
    }
    window.addEventListener("llc-toast", onToast);
    return () => window.removeEventListener("llc-toast", onToast);
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] space-y-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`rounded-lg border px-4 py-2.5 text-sm font-medium shadow-2xl bg-panel backdrop-blur animate-[toast-in_.18s_ease-out] ${
            t.kind === "ok" ? "border-win/40 text-body" : "border-bad/50 text-bad"
          }`}
        >
          {t.kind === "ok" && <span className="text-win mr-2">{"\u2713"}</span>}
          {t.message}
        </div>
      ))}
    </div>
  );
}
