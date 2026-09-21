import { NextResponse } from "next/server";
import { atGet, atList, isRecId, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

// The extra detail behind one product on the audit page: every lot received
// and every recorded stock change. Stream history is already on the page;
// this fills in the rest of the trail so a missing batch of packs can be
// traced from when it came in to where it went.
export async function GET(req: Request) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!isRecId(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const product = await atGet(T.inventory, id).catch(() => null);
  if (!product) return NextResponse.json({ error: "unknown product" }, { status: 404 });
  const name = String(product.fields["Product Name"] || "");
  const names = [name, ...String(product.fields["Former Names"] || "").split("\n")]
    .map((n) => n.trim())
    .filter(Boolean);

  const [lots, alertRows] = await Promise.all([
    atList(T.purchases, {
      filterByFormula: `{Product Rec Id} = '${id}'`,
      "sort[0][field]": "Date",
      "sort[0][direction]": "desc",
    }).catch(() => []),
    // Stock changes are logged by product name, so search the log for any
    // name this product has gone by.
    atList(T.alerts, {
      filterByFormula: `AND({Type} = 'stock', OR(${names
        .map((n) => `SEARCH('${n.toLowerCase().replace(/\\/g, "\\\\").replace(/'/g, "\\'")}', LOWER({Payload}))`)
        .join(", ")}))`,
      "sort[0][field]": "Created",
      "sort[0][direction]": "desc",
    }).catch(() => []),
  ]);

  const lower = new Set(names.map((n) => n.toLowerCase()));
  const changes: { date: string; source: string; delta: number; qtyNow: number }[] = [];
  for (const r of alertRows) {
    let p: any = null;
    try { p = JSON.parse(r.fields["Payload"] || "null"); } catch {}
    for (const it of p?.items || []) {
      if (!lower.has(String(it?.name || "").trim().toLowerCase())) continue;
      changes.push({
        date: String(r.fields["Created"] || ""),
        source: String(p?.source || ""),
        delta: Number(it.delta) || 0,
        qtyNow: Number(it.qtyNow) || 0,
      });
    }
  }

  return NextResponse.json({
    name,
    onHand: product.fields["Qty On Hand"] ?? 0,
    lots: lots.map((r) => ({
      date: r.fields["Date"] || "",
      qty: r.fields["Qty"] ?? 0,
      unitCost: r.fields["Unit Cost"] ?? 0,
      source: r.fields["Source"] || "",
    })),
    changes: changes.slice(0, 200),
  });
}
