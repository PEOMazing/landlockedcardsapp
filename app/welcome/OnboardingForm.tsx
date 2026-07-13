"use client";
import { useState } from "react";

export default function OnboardingForm() {
  const [role, setRole] = useState<"collector" | "vendor">("collector");
  const [f, setF] = useState({ firstName: "", lastName: "", phone: "", company: "", experience: "", socials: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function submit() {
    setErr("");
    if (!f.firstName.trim() || !f.lastName.trim()) { setErr("First and last name are required"); return; }
    if (!f.phone.trim()) { setErr("Phone number is required"); return; }
    if (role === "vendor" && !f.company.trim()) { setErr("Company name is required for vendors"); return; }
    setBusy(true);
    const r = await fetch("/api/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, ...f }),
    });
    setBusy(false);
    if (r.ok) window.location.href = "/welcome";
    else setErr((await r.json()).error || "Something went wrong");
  }

  return (
    <div className="card p-6 w-full max-w-md space-y-4">
      <div>
        <div className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Tell us about you</div>
        <div className="text-dim text-sm">One quick step and you are in</div>
      </div>

      <div className="flex rounded-lg border border-edge overflow-hidden">
        {(["collector", "vendor"] as const).map((r) => (
          <button
            key={r}
            className={`flex-1 py-2.5 text-sm capitalize ${role === r ? "bg-foil/15 text-body font-semibold" : "text-dim hover:text-body"}`}
            onClick={() => setRole(r)}
          >
            {r === "collector" ? "I collect cards" : "I sell cards"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">First name</label>
          <input className="input mt-1 w-full" value={f.firstName} onChange={set("firstName")} autoComplete="given-name" />
        </div>
        <div>
          <label className="label">Last name</label>
          <input className="input mt-1 w-full" value={f.lastName} onChange={set("lastName")} autoComplete="family-name" />
        </div>
      </div>
      <div>
        <label className="label">Phone</label>
        <input className="input mt-1 w-full" type="tel" inputMode="tel" placeholder="(555) 555-5555" value={f.phone} onChange={set("phone")} autoComplete="tel" />
      </div>

      {role === "vendor" && (
        <>
          <div>
            <label className="label">Company or store name</label>
            <input className="input mt-1 w-full" value={f.company} onChange={set("company")} placeholder="e.g. LandLocked Cards" />
          </div>
          <div>
            <label className="label">Vending experience</label>
            <textarea className="input mt-1 w-full" rows={3} value={f.experience} onChange={set("experience")} placeholder="How long have you been selling? Shows, streams, online stores..." />
          </div>
          <div>
            <label className="label">Social media links</label>
            <textarea className="input mt-1 w-full" rows={2} value={f.socials} onChange={set("socials")} placeholder="Whatnot, TikTok, Instagram, eBay store..." />
          </div>
          <p className="text-dim text-xs">
            Vendor accounts are reviewed personally - expect access within 1 to 2 days.
          </p>
        </>
      )}

      {err && <div className="text-bad text-sm">{err}</div>}
      <button className="btn-foil w-full !py-3 disabled:opacity-40" disabled={busy} onClick={submit}>
        {busy ? "Saving..." : role === "vendor" ? "Apply as a vendor" : "Create my account"}
      </button>
    </div>
  );
}
