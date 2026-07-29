"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function MarkPaidButton({ streamIds, paid }: { streamIds: string[]; paid: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (!paid && !confirm(`Mark this pay period as paid? It stamps today's date on ${streamIds.length} stream(s).`)) return;
    if (paid && !confirm("Unmark this period as paid?")) return;
    setBusy(true);
    try {
      await Promise.all(
        streamIds.map((id) =>
          fetch(`/api/streams/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paidOut: !paid }),
          })
        )
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      className={paid ? "btn-ghost !py-1 text-xs" : "btn-foil !py-1 text-xs"}
      disabled={busy}
      onClick={toggle}
    >
      {busy ? "..." : paid ? "Unmark paid" : "Mark period paid"}
    </button>
  );
}
