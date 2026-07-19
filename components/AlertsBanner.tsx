"use client";
import { useEffect, useState } from "react";

type Alert = { id: string; type: "price" | "stock"; title: string; created: string; payload: any };

// Shown to every signed-in team member at the top of every page until
// someone acknowledges: sealed price jumps (adjust show pricing up) and
// Whatnot listing quantities that no longer match on-hand stock.
export default function AlertsBanner() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/alerts");
        if (r.ok) setAlerts((await r.json()).alerts || []);
      } catch {}
    })();
  }, []);

  if (alerts.length === 0) return null;

  async function ack(id: string) {
    setAlerts((a) => a.filter((x) => x.id !== id));
    await fetch("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
  }

  return (
    <div className="max-w-6xl mx-auto px-6 pt-3 space-y-2">
      {alerts.map((a) => (
        <div key={a.id} className={`card !py-2.5 px-4 text-sm flex items-start gap-3 ${a.type === "price" ? "!border-win/40" : "!border-givvy/40"}`}>
          <span className={a.type === "price" ? "text-win" : "text-givvy"}>{a.type === "price" ? "\u2191" : "\u26A0"}</span>
          <div className="flex-1 min-w-0">
            <button className="text-left font-medium hover:underline" onClick={() => setOpen(open === a.id ? "" : a.id)}>
              {a.title}
            </button>
            {open === a.id && a.payload?.items && (
              <ul className="mt-1 text-xs text-dim space-y-0.5">
                {a.payload.items.slice(0, 12).map((it: any, i: number) => (
                  <li key={i}>
                    {a.type === "price"
                      ? `${it.name}: $${Number(it.old).toFixed(2)} \u2192 $${Number(it.now).toFixed(2)} (+${Number(it.pct).toFixed(1)}%)`
                      : `${it.name}: now ${it.qtyNow} on hand (${it.delta > 0 ? "+" : ""}${it.delta}) - set Whatnot to ${Math.max(it.qtyNow, 0)}`}
                  </li>
                ))}
                {a.payload.items.length > 12 && <li>...and {a.payload.items.length - 12} more</li>}
              </ul>
            )}
          </div>
          <button className="text-dim hover:text-body text-xs whitespace-nowrap" onClick={() => ack(a.id)}>done</button>
        </div>
      ))}
    </div>
  );
}
