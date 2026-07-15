import { atCreateBatch, atList, atUpdate, T } from "@/lib/airtable";
import { categoryForName } from "@/lib/categories";

// Shared portfolio writer used by the inbound email webhook. Team profiles
// import sealed into company inventory (merging by name) and singles into the
// company list; collector profiles import singles into their own walled
// collection and sealed rows are skipped.
export async function importPortfolio(opts: {
  profileRecId: string;
  profileName: string;
  isTeam: boolean;
  sealed: any[];
  singles: any[];
}) {
  const { profileRecId, profileName, isTeam } = opts;
  const sealed = isTeam ? opts.sealed.slice(0, 500) : [];
  const sealedSkipped = isTeam ? 0 : opts.sealed.length;
  const singles = opts.singles.slice(0, 1500);
  const today = new Date().toISOString().slice(0, 10);
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
        const fields: Record<string, any> = { "Qty On Hand": oldQty + addQty, "Active": true };
        if (row.buy && row.buy > 0) {
          fields["Buy Price"] = oldBuy > 0 && oldQty > 0
            ? Math.round(((oldQty * oldBuy + addQty * row.buy) / (oldQty + addQty)) * 100) / 100
            : row.buy;
        }
        await atUpdate(T.inventory, hit.id, fields);
        sealedMerged++;
      } else {
        const create: Record<string, any> = {
          "Product Name": name,
          "Category": categoryForName(name),
          "Buy Price": row.buy && row.buy > 0 ? row.buy : 0,
          "Market Price": row.market && row.market > 0 ? row.market : 0,
          "Qty On Hand": row.qty || 1,
          "Active": true,
          "Date Added": row.dateAdded || today,
        };
        if (row.market && row.market > 0) create["Entry Market"] = row.market;
        toCreate.push(create);
      }
    }
    if (toCreate.length) sealedCreated = (await atCreateBatch(T.inventory, toCreate)).length;
  }

  if (singles.length) {
    const toCreate = singles
      .filter((r) => String(r.name || "").trim())
      .map((r) => {
        const fields: Record<string, any> = {
          "Card Name": String(r.name).trim(),
          "Set Name": r.setName || "",
          "Card Number": r.number || "",
          "Rarity": r.rarity || "",
          "Condition": r.condition || "NM",
      "Language": /japan|\bjpn\b|\bjp\b/i.test(`${r.name} ${r.setName || ""}`) ? "Japanese" :
        /chinese|\bcn\b/i.test(`${r.name} ${r.setName || ""}`) ? "Chinese" :
        /korean|\bkr\b/i.test(`${r.name} ${r.setName || ""}`) ? "Korean" :
        /spanish|\bes\b/i.test(`${r.name} ${r.setName || ""}`) ? "Spanish" : "English",
          "Qty": Math.max(1, r.qty || 1),
          "Status": "In Stock",
          "Notes": r.notes || "",
          "Added By": profileName,
          "Date Added": r.dateAdded || today,
        };
        if (r.printing) fields["Printing"] = r.printing;
        if (!isTeam) fields["Owner Rec Id"] = profileRecId;
        if (r.buy && r.buy > 0) fields["Buy Price"] = r.buy;
        if (r.comp && r.comp > 0) {
          fields["Comp"] = r.comp;
          fields["Entry Comp"] = r.comp;
          fields["Comp Source"] = "Collectr import (market)";
          fields["Comp Date"] = today;
        }
        return fields;
      });
    if (toCreate.length) singlesCreated = (await atCreateBatch(T.singles, toCreate)).length;
  }
  return { sealedCreated, sealedMerged, singlesCreated, sealedSkipped };
}
