import { NextResponse } from "next/server";
import { T, atList, atUpdate } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { MappedTarget, extractProductId, isTcgUrl, priceMappedProducts } from "@/lib/tcgMap";

export const maxDuration = 60;

// Once a product is mapped to an exact TCGplayer product, its real name is a
// known fact rather than a guess. This reads that name back for every mapped
// product so the inventory can stop carrying shorthand that points at the wrong
// card ("gengar tech sticker" for a product that is actually Gastly).
//
// GET previews. POST applies only the record ids it is given, so nothing is
// renamed without being looked at first.

type Row = { id: string; current: string; proposed: string; changed: boolean };

async function proposals(): Promise<{ rows: Row[]; mappedCount: number }> {
  const inventory = await atList(T.inventory, { filterByFormula: "{Active} = TRUE()" });
  const targets: MappedTarget[] = [];
  const byId = new Map<string, any>();
  for (const r of inventory) {
    const url = String(r.fields["TCGplayer URL"] || "");
    const groupId = Number(r.fields["TCG Group Id"]) || 0;
    const categoryId = Number(r.fields["TCG Category Id"]) || 0;
    const productId = isTcgUrl(url) ? extractProductId(url) : null;
    if (!productId || groupId <= 0 || categoryId <= 0) continue;
    targets.push({ recordId: r.id, productId, categoryId, groupId });
    byId.set(r.id, r);
  }
  if (targets.length === 0) return { rows: [], mappedCount: 0 };

  const hits = await priceMappedProducts(targets);
  const rows: Row[] = [];
  for (const [recId, hit] of hits) {
    const rec = byId.get(recId);
    const current = String(rec?.fields["Product Name"] || "");
    const proposed = String(hit.name || "").trim();
    if (!proposed) continue;
    rows.push({ id: recId, current, proposed, changed: proposed !== current });
  }
  rows.sort((a, b) => Number(b.changed) - Number(a.changed) || a.current.localeCompare(b.current));
  return { rows, mappedCount: targets.length };
}

export async function GET() {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const { rows, mappedCount } = await proposals();
    return NextResponse.json({
      rows,
      mappedCount,
      changedCount: rows.filter((r) => r.changed).length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Could not read names from TCGplayer." }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const wanted: string[] = Array.isArray(body.ids) ? body.ids : [];
  if (wanted.length === 0) return NextResponse.json({ error: "Nothing selected to rename." }, { status: 400 });
  const want = new Set(wanted);

  let renamed = 0;
  const applied: { from: string; to: string }[] = [];
  try {
    const { rows } = await proposals();
    const inventory = await atList(T.inventory, { filterByFormula: "{Active} = TRUE()" });
    const recById = new Map(inventory.map((r) => [r.id, r]));

    for (const row of rows) {
      if (!want.has(row.id) || !row.changed) continue;
      const rec = recById.get(row.id);
      if (!rec) continue;
      // Keep the old name so a show set pasted from memory still resolves to
      // this product rather than quietly creating a duplicate at $0.
      const priorRaw = String(rec.fields["Former Names"] || "");
      const prior = priorRaw.split("\n").map((s) => s.trim()).filter(Boolean);
      if (row.current && !prior.some((p) => p.toLowerCase() === row.current.toLowerCase())) {
        prior.push(row.current);
      }
      await atUpdate(T.inventory, row.id, {
        "Product Name": row.proposed,
        "Former Names": prior.join("\n"),
      });
      applied.push({ from: row.current, to: row.proposed });
      renamed++;
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Rename failed partway.", renamed, applied }, { status: 502 });
  }
  return NextResponse.json({ renamed, applied });
}
