"use client";
import { useEffect, useState } from "react";

const FIELDS: { key: string; label: string; hint: string; pct?: boolean }[] = [
  { key: "default_hourly_rate", label: "Default hourly rate ($/hr)", hint: "Used unless a streamer has their own rate" },
  { key: "packing_rate", label: "Packing rate ($/hr)", hint: "Paid on top, deducted before commission" },
  { key: "support_pct", label: "Stream support %", hint: "Share of profit after streamer pay", pct: true },
  { key: "breakeven_mult", label: "Break-even multiplier", hint: "Value per spot x this = break-even price" },
  { key: "hit_threshold", label: "Hit threshold ($)", hint: "Items over this market price count as hits" },
  { key: "tier1_limit", label: "Tier 1 cap ($)", hint: "First slice of weekly profit" },
  { key: "tier1_rate", label: "Tier 1 rate", hint: "Rate on the first slice", pct: true },
  { key: "tier2_limit", label: "Tier 2 cap ($)", hint: "Profit up to this amount hits tier 2" },
  { key: "tier2_rate", label: "Tier 2 rate", hint: "Rate on the second slice", pct: true },
  { key: "tier3_rate", label: "Tier 3 rate", hint: "Rate above the tier 2 cap", pct: true },
];

export default function SettingsClient() {
  const [s, setS] = useState<any>(null);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => setS(d.settings));
  }, []);

  if (!s) return <main className="max-w-3xl mx-auto p-6 text-dim">Loading settings...</main>;

  async function save(key: string, value: number) {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    setSaved(key);
    setTimeout(() => setSaved(""), 1500);
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Pay settings</h1>
      <div className="card divide-y divide-edge">
        {FIELDS.map((f) => (
          <div key={f.key} className="p-4 flex items-center justify-between gap-4">
            <div>
              <div className="font-medium text-sm">{f.label}</div>
              <div className="text-dim text-xs">{f.hint}</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number" step={f.pct ? "0.01" : "1"}
                className="input !w-28"
                defaultValue={s[f.key]}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v !== s[f.key]) { setS({ ...s, [f.key]: v }); save(f.key, v); }
                }}
              />
              {saved === f.key && <span className="text-win text-xs">Saved</span>}
            </div>
          </div>
        ))}
      </div>
      <p className="text-dim text-xs">
        Percentages are decimals: 0.10 means 10%. Changes apply to pay calculations immediately, including past weeks,
        since pay is always computed live from stream data.
      </p>
    </main>
  );
}
