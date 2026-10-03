"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PaidToggle({ week, personId, personName, amount, paid }: {
  week: string; personId: string; personName: string; amount: number; paid: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    // Records that a person was paid. On failure the refresh put the toggle
    // back and said nothing, so the only signal was noticing it had flipped
    // back. The route is idempotent, so clicking again is safe.
    const r = await fetch("/api/payroll/paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week, personId, personName, amount, paid: !paid }),
    }).catch(() => null);
    if (!r || !r.ok) setErr("Not recorded - try again");
    else setErr("");
    router.refresh();
    setBusy(false);
  }
  return (
    <span className="inline-flex items-center gap-2">
      {paid ? (
        <button className="text-win text-xs hover:underline disabled:opacity-40" disabled={busy} onClick={toggle} title="Click to unmark">
          paid &#10003;
        </button>
      ) : (
        <button className="btn-ghost !py-0.5 !px-2 text-xs disabled:opacity-40" disabled={busy} onClick={toggle}>
          {busy ? "..." : "mark paid"}
        </button>
      )}
      {err && <span className="text-bad text-xs">{err}</span>}
    </span>
  );
}
