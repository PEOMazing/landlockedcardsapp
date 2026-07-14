import { NextResponse } from "next/server";
import { atCreate, atCreateBatch, atList, atUpdate, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { categoryForName } from "@/lib/categories";

export const maxDuration = 60;

// Bulk import from a Collectr (or generic) CSV, parsed client-side and sent
// in chunks. Sealed rows merge into existing products by name (quantities
// add, blank prices fill); singles create new records. Admin only.

type SealedRow = { name: string; qty: number; buy?: number; market?: number; dateAdded?: string };
type SingleRow = {
  name: string; setName?: string; number?: string; rarity?: string;
  condition: string; qty: number; buy?: number; comp?: number;
  notes?: string; dateAdded?: string;
};

export async function POST(req: Request) {
  const me = await getMe();
  // managers and admins import into the business; approved collectors import
  // into their own collection. Everyone else stays out.
  if (!me?.isManager && !me?.isCollector) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json();
  let sealed: SealedRow[] = Array.isArray(b.sealed) ? b.sealed.slice(0, 200) : [];
  const singles: SingleRow[] = Array.isArray(b.singles) ? b.singles.slice(0, 200) : [];
  // collectors have no sealed inventory yet - counted, reported, not imported
  const sealedSkipped = me.isCollector ? sealed.length : 0;
  if (me.isCollector) sealed = [];
  const ownerRecId = me.isCollector ? me.streamer?.id || "" : "";

  let sealedCreated = 0, sealedMerged = 0, singlesCreated = 0;

  if (sealed.length) {
    const existing = await atList(T.inventory, {});
    const byName = new Map<string, any>();
    for (const r of existing) byName.set(String(r.fields["Product Name"] || "").trim().toLowerCase(), r);

    const toCreate: Record<string, any>[] = [];
    for (const row of sealed) {
      const name = String(row.name || "").trim();
      if (!name) continue;
      const hit = byName.get(name.toLowerCase());
      if (hit) {
        const oldQty = hit.fields["Qty On Hand"] ?? 0;
        const oldBuy = hit.fields["Buy Price"] ?? 0;
        const addQty = row.qty || 1;
        const fields: Record<string, any> = {
          "Qty On Hand": oldQty + addQty,
          "Active": true,
        };
        if (row.buy && row.buy > 0) {
          fields["Buy Price"] =
            oldBuy > 0 && oldQty > 0
              ? Math.round(((oldQty * oldBuy + addQty * row.buy) / (oldQty + addQty)) * 100) / 100
              : row.buy;
        }
        if (!(hit.fields["Market Price"] > 0) && row.market && row.market > 0) fields["Market Price"] = row.market;
        await atUpdate(T.inventory, hit.id, fields);
        if (row.buy && row.buy > 0) {
          await atCreate(T.purchases, {
            "Product Name": name, "Product Rec Id": hit.id, "Qty": addQty,
            "Unit Cost": row.buy, "Date": new Date().toISOString().slice(0, 10), "Source": "collectr import",
          }).catch(() => {});
        }
        sealedMerged++;
      } else {
        const create: Record<string, any> = {
          "Product Name": name,
          "Category": categoryForName(name),
          "Buy Price": row.buy && row.buy > 0 ? row.buy : 0,
          "Market Price": row.market && row.market > 0 ? row.market : 0,
          "Qty On Hand": row.qty || 1,
          "Active": true,
          "Date Added": row.dateAdded || new Date().toISOString().slice(0, 10),
        };
        if (row.market && row.market > 0) create["Entry Market"] = row.market;
        toCreate.push(create);
      }
    }
    if (toCreate.length) {
      const made = await atCreateBatch(T.inventory, toCreate);
      sealedCreated = made.length;
    }
  }

  if (singles.length) {
    const today = new Date().toISOString().slice(0, 10);
    const addedBy = me.streamer?.fields?.["Name"] || me.email;
    const toCreate = singles
      .filter((r) => String(r.name || "").trim())
      .map((r) => {
        const fields: Record<string, any> = {
          "Card Name": String(r.name).trim(),
          "Set Name": r.setName || "",
          "Card Number": r.number || "",
          "Rarity": r.rarity || "",
          "Condition": r.condition || "NM",
          "Qty": Math.max(1, r.qty || 1),
          "Status": "In Stock",
          "Notes": r.notes || "",
          "Added By": addedBy,
          "Date Added": r.dateAdded || today,
        };
        if ((r as any).printing) fields["Printing"] = (r as any).printing;
        if (ownerRecId) fields["Owner Rec Id"] = ownerRecId;
        if (r.buy && r.buy > 0) fields["Buy Price"] = r.buy;
        if (r.comp && r.comp > 0) {
          fields["Comp"] = r.comp;
          fields["Entry Comp"] = r.comp;
          fields["Comp Source"] = "Collectr import (market)";
          fields["Comp Date"] = today;
        }
        return fields;
      });
    if (toCreate.length) {
      const made = await atCreateBatch(T.singles, toCreate);
      singlesCreated = made.length;
    }
  }

  return NextResponse.json({ sealedCreated, sealedMerged, singlesCreated, sealedSkipped });
}
