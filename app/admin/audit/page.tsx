import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getMe } from "@/lib/auth";
import { atList, T } from "@/lib/airtable";
import type { AuditLine, AuditSingle, AuditStream } from "@/lib/audit";
import AuditClient, { type AuditProduct } from "./AuditClient";

export const dynamic = "force-dynamic";

// The audit. Admins and managers only: it shows cost, and it is where missing
// stock gets chased down.
export default async function AuditPage({ searchParams }: { searchParams: { stream?: string; product?: string } }) {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (!me.isAdmin && !me.isManager) redirect("/dashboard");

  const [streamRows, streamerRows, lineRows, invRows, singleRows] = await Promise.all([
    atList(T.streams, {
      filterByFormula: "{Deleted At} = BLANK()",
      "fields[]": ["Title", "Stream Date", "Status", "Stream Type", "Streamer Rec Id", "Items Returned", "Giveaways Run", "Singles Giveaways Run"],
      "sort[0][field]": "Stream Date",
      "sort[0][direction]": "desc",
    }),
    atList(T.streamers, { "fields[]": ["Name"] }),
    atList(T.lines, {
      "fields[]": ["Line", "Qty", "Qty Hit", "Stream Rec Id", "Market Price Snapshot", "Buy Price Snapshot", "Is Giveaway", "Is Store Purchase", "Sold Price", "Single Rec Id", "Product"],
    }),
    atList(T.inventory, { "fields[]": ["Product Name", "Former Names", "Qty On Hand", "Active", "Category"] }),
    atList(T.singles, { "fields[]": ["Card No", "Set Name"] }),
  ]);

  const nameById: Record<string, string> = {};
  for (const s of streamerRows) nameById[s.id] = s.fields["Name"] || "";

  const streams: (AuditStream & { giveaways: number; singlesGiveaways: number })[] = streamRows.map((r) => ({
    id: r.id,
    date: r.fields["Stream Date"] || "",
    title: String(r.fields["Title"] || "").replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, ""),
    streamer: nameById[r.fields["Streamer Rec Id"]] || "",
    type: r.fields["Stream Type"]?.name || r.fields["Stream Type"] || "Surprise Set",
    status: r.fields["Status"]?.name || r.fields["Status"] || "Planned",
    returned: !!r.fields["Items Returned"],
    giveaways: r.fields["Giveaways Run"] || 0,
    singlesGiveaways: r.fields["Singles Giveaways Run"] || 0,
  }));

  const lines: AuditLine[] = lineRows
    .filter((r) => r.fields["Stream Rec Id"])
    .map((r) => ({
      id: r.id,
      streamId: r.fields["Stream Rec Id"],
      productId: r.fields["Product"]?.[0] || "",
      singleId: r.fields["Single Rec Id"] || "",
      name: r.fields["Line"] || "",
      qty: r.fields["Qty"] || 0,
      hit: r.fields["Qty Hit"] || 0,
      market: r.fields["Market Price Snapshot"] || 0,
      buy: r.fields["Buy Price Snapshot"] || 0,
      giveaway: !!r.fields["Is Giveaway"],
      store: !!r.fields["Is Store Purchase"],
      soldPrice: r.fields["Sold Price"] || 0,
      created: (r as any).createdTime || "",
    }));

  const products: AuditProduct[] = invRows
    .map((r) => ({
      id: r.id,
      name: String(r.fields["Product Name"] || "").trim(),
      aliases: String(r.fields["Former Names"] || "").split("\n").map((s) => s.trim()).filter(Boolean),
      onHand: r.fields["Qty On Hand"] ?? 0,
      active: !!r.fields["Active"],
    }))
    .filter((p) => p.name);

  const singles: Record<string, AuditSingle> = {};
  for (const r of singleRows) {
    const no = Number(r.fields["Card No"]);
    singles[r.id] = { no: Number.isFinite(no) && r.fields["Card No"] !== undefined ? no : null, set: r.fields["Set Name"] || "" };
  }

  return (
    <>
      <Nav isAdmin={me.isAdmin} isManager={me.isManager} name={me.streamer?.fields?.["Name"] || "Admin"} />
      <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
        <AuditClient
          streams={streams}
          lines={lines}
          products={products}
          singles={singles}
          initialStream={searchParams.stream || ""}
          initialProduct={searchParams.product || ""}
        />
      </main>
    </>
  );
}
