"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PaidToggle({ week, personId, personName, amount, paid }: {
  week: string; personId: string; personName: string; amount: number; paid: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    await fetch("/api/payroll/paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week, personId, personName, amount, paid: !paid }),
    });
    router.refresh();
    setBusy(false);
  }
  return paid ? (
    <button className="text-win text-xs hover:underline disabled:opacity-40" disabled={busy} onClick={toggle} title="Click to unmark">
      paid &#10003;
    </button>
  ) : (
    <button className="btn-ghost !py-0.5 !px-2 text-xs disabled:opacity-40" disabled={busy} onClick={toggle}>
      {busy ? "..." : "mark paid"}
    </button>
  );
}
