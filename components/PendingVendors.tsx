"use client";
import { useEffect, useState } from "react";
import { toast } from "@/components/Toaster";

// Admin approval queue: pending vendor applications with one-click actions.
type P = { id: string; name: string; email: string; phone: string; company: string; experience: string; socials: string; signedUp: string };

export default function PendingVendors() {
  const [pending, setPending] = useState<P[] | null>(null);
  const [busy, setBusy] = useState("");

  function load() {
    fetch("/api/admin/signups").then((r) => r.json()).then((d) => setPending(d.pending || [])).catch(() => setPending([]));
  }
  useEffect(load, []);

  async function act(id: string, action: "approve" | "decline", name: string) {
    if (action === "decline" && !confirm(`Decline and remove ${name}'s application? This deletes their profile row.`)) return;
    setBusy(id + action);
    const r = await fetch("/api/admin/signups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    setBusy("");
    if (r.ok) { toast(action === "approve" ? `${name} approved - let them know by email or text` : "Application removed"); load(); }
    else toast("Something went wrong", "bad");
  }

  if (!pending || pending.length === 0) return null;

  return (
    <section className="card p-5 border-amber-400/40">
      <div className="label mb-3">Vendor applications - {pending.length} pending</div>
      <div className="space-y-3">
        {pending.map((p) => (
          <div key={p.id} className="flex items-start justify-between gap-4 flex-wrap border-b border-edge pb-3 last:border-0 last:pb-0">
            <div className="min-w-0">
              <div className="font-semibold">{p.company || "(no company)"} <span className="text-dim font-normal">- {p.name}</span></div>
              <div className="text-dim text-xs">{p.email} - {p.phone} - applied {p.signedUp}</div>
              {p.experience && <div className="text-sm mt-1 max-w-xl">{p.experience}</div>}
              {p.socials && <div className="text-dim text-xs mt-0.5 max-w-xl break-words">{p.socials}</div>}
            </div>
            <div className="flex gap-2">
              <button className="btn-foil !py-1.5 text-sm disabled:opacity-40" disabled={!!busy} onClick={() => act(p.id, "approve", p.name)}>
                {busy === p.id + "approve" ? "..." : "Approve"}
              </button>
              <button className="btn-ghost !py-1.5 text-sm disabled:opacity-40" disabled={!!busy} onClick={() => act(p.id, "decline", p.name)}>
                {busy === p.id + "decline" ? "..." : "Decline"}
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-dim text-xs mt-3">Approval flips their status instantly - they see it on their welcome page. No automatic email goes out yet, so reach out personally.</p>
    </section>
  );
}
