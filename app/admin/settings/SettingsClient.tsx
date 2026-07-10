"use client";
import { useEffect, useState } from "react";

const FIELDS: { key: string; label: string; hint: string; pct?: boolean }[] = [
  { key: "default_hourly_rate", label: "Default hourly rate ($/hr)", hint: "Used unless a streamer has their own rate" },
  { key: "packing_rate", label: "Packing rate ($/hr)", hint: "Paid on top, deducted before commission" },
  { key: "support_pct", label: "Stream support %", hint: "Share of profit after streamer pay", pct: true },
  { key: "breakeven_mult", label: "Break-even multiplier", hint: "Value per spot x this = break-even price" },
  { key: "hit_threshold", label: "Hit threshold ($)", hint: "Items over this market price count as hits" },
  { key: "giveaway_cost", label: "Giveaway cost ($ each)", hint: "Deducted from profit per giveaway run on a stream" },
  { key: "tier1_limit", label: "Tier 1 cap ($)", hint: "First slice of weekly profit" },
  { key: "tier1_rate", label: "Tier 1 rate", hint: "Rate on the first slice", pct: true },
  { key: "tier2_limit", label: "Tier 2 cap ($)", hint: "Profit up to this amount hits tier 2" },
  { key: "tier2_rate", label: "Tier 2 rate", hint: "Rate on the second slice", pct: true },
  { key: "tier3_rate", label: "Tier 3 rate", hint: "Rate above the tier 2 cap", pct: true },
];

type Profile = {
  id: string; name: string; email: string; role: string;
  hourlyRate: number | null; overridePct: number | null; active: boolean; linked: boolean;
};

export default function SettingsClient() {
  const [s, setS] = useState<any>(null);
  const [saved, setSaved] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [pSaved, setPSaved] = useState("");
  const [adding, setAdding] = useState({ name: "", email: "", role: "streamer", hourlyRate: "", overridePct: "" });
  const [addErr, setAddErr] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  async function loadProfiles() {
    const r = await fetch("/api/streamers?full=1");
    if (r.ok) setProfiles((await r.json()).streamers || []);
  }

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => setS(d.settings));
    loadProfiles();
  }, []);

  async function saveProfile(id: string, patch: Record<string, any>) {
    await fetch(`/api/streamers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setPSaved(id);
    setTimeout(() => setPSaved(""), 1500);
    await loadProfiles();
  }

  async function addProfile() {
    setAddBusy(true); setAddErr("");
    const res = await fetch("/api/streamers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adding),
    });
    if (!res.ok) {
      setAddErr((await res.json()).error || "Could not add streamer");
    } else {
      setAdding({ name: "", email: "", role: "streamer", hourlyRate: "", overridePct: "" });
      await loadProfiles();
    }
    setAddBusy(false);
  }

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

      <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Streamer profiles</h1>
      <p className="text-dim text-sm">
        Add a profile with the person&apos;s email and they are connected automatically the first time they sign in
        with it. No further linking needed.
      </p>
      <div className="card divide-y divide-edge">
        {profiles.map((p) => (
          <div key={p.id} className="p-4 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
            <div>
              <label className="label">Name</label>
              <input className="input mt-1" defaultValue={p.name}
                onBlur={(e) => e.target.value !== p.name && saveProfile(p.id, { name: e.target.value })} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input mt-1" defaultValue={p.email}
                onBlur={(e) => e.target.value !== p.email && saveProfile(p.id, { email: e.target.value, relink: true })} />
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input mt-1" value={p.role}
                onChange={(e) => saveProfile(p.id, { role: e.target.value })}>
                <option value="streamer">streamer</option>
                <option value="manager">manager</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div>
              <label className="label">Hourly rate ($)</label>
              <input type="number" step="0.5" className="input mt-1" defaultValue={p.hourlyRate ?? ""}
                placeholder="default"
                onBlur={(e) => e.target.value !== String(p.hourlyRate ?? "") && saveProfile(p.id, { hourlyRate: e.target.value })} />
            </div>
            <div>
              <label className="label">Override %</label>
              <input type="number" step="0.01" className="input mt-1" defaultValue={p.overridePct ?? ""}
                placeholder="0.10 = 10%"
                onBlur={(e) => e.target.value !== String(p.overridePct ?? "") && saveProfile(p.id, { overridePct: e.target.value })} />
            </div>
            <div className="flex items-center gap-3 pb-2">
              <span className={`text-xs font-semibold ${p.linked ? "text-win" : "text-dim"}`}>
                {p.linked ? "Linked" : "Awaiting sign-in"}
              </span>
              <label className="flex items-center gap-1 text-xs text-dim cursor-pointer">
                <input type="checkbox" checked={p.active} onChange={(e) => saveProfile(p.id, { active: e.target.checked })} />
                Active
              </label>
              {pSaved === p.id && <span className="text-win text-xs">Saved</span>}
            </div>
          </div>
        ))}
        <div className="p-4 grid grid-cols-2 md:grid-cols-6 gap-3 items-end bg-edge/10">
          <div>
            <label className="label">Name</label>
            <input className="input mt-1" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input mt-1" value={adding.email} onChange={(e) => setAdding({ ...adding, email: e.target.value })} />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input mt-1" value={adding.role} onChange={(e) => setAdding({ ...adding, role: e.target.value })}>
              <option value="streamer">streamer</option>
              <option value="manager">manager</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div>
            <label className="label">Hourly rate ($)</label>
            <input type="number" step="0.5" className="input mt-1" value={adding.hourlyRate}
              placeholder="optional" onChange={(e) => setAdding({ ...adding, hourlyRate: e.target.value })} />
          </div>
          <div>
            <label className="label">Override %</label>
            <input type="number" step="0.01" className="input mt-1" value={adding.overridePct}
              placeholder="managers" onChange={(e) => setAdding({ ...adding, overridePct: e.target.value })} />
          </div>
          <div className="pb-1">
            <button className="btn-foil disabled:opacity-40" disabled={addBusy || !adding.name || !adding.email} onClick={addProfile}>
              {addBusy ? "Adding..." : "Add streamer"}
            </button>
          </div>
        </div>
      </div>
      {addErr && <div className="text-bad text-sm">{addErr}</div>}
    </main>
  );
}
