import { NextResponse } from "next/server";
import { atCreate, atCreateBatch, atList, atUpdate, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { categoryForName } from "@/lib/categories";
import { indexByName } from "@/lib/productNames";
import { getTcgcsvCardByProductId } from "@/lib/tcgcsvCards";

// cl-v2. Raised from 60 because linking each card to its TCGplayer product is
// an upstream lookup, and the client sends singles 60 at a time. The loop
// below also stops itself well before this, so the ceiling is a safety net
// rather than the thing being relied on.
export const maxDuration = 300;

// Bulk import from a Collectr or TCGplayer CSV, parsed client-side and sent
// in chunks. Sealed rows merge into existing products by name (quantities
// add, blank prices fill); singles create new records. Admin only.

type SealedRow = { name: string; qty: number; buy?: number; market?: number; dateAdded?: string };
type SingleRow = {
  name: string; setName?: string; number?: string; rarity?: string;
  condition: string; qty: number; buy?: number; comp?: number;
  printing?: string; imageUrl?: string; compSource?: string;
  notes?: string; dateAdded?: string;
  /** cl-v2. Blank for English. */
  language?: string;
  /** cl-v2. The TCGplayer product id off column one of the export, and the
   *  URL-shaped slug built from the Product Line and Set Name columns. */
  productId?: number;
  tcgSlug?: string;
};

// cl-v2. Linking a card to its TCGplayer product at import time rather than
// never.
//
// This is the difference between a card that reprices itself and a card that
// sits at whatever the export said forever. Without a Card ID there is no
// rolling reprice, no condition-specific sold comp and no graded sweep, which
// is exactly the state 68 of the 70 slabs were found in.
//
// Budgeted, and it fails OPEN. A row whose lookup is slow, refused or simply
// not in the nightly mirror still imports with everything the CSV said about
// it - the same record this route would have created before any of this
// existed. Linking is an upgrade on the old behaviour, so it must never be
// the reason an import does not happen.
const LINK_BUDGET_MS = 180_000;
const EXPECTED_LOOKUP_MS = 6_000;

async function linkProducts(rows: SingleRow[]) {
  const out = new Map<number, { cardId: string; variant: string; image: string; rarity: string }>();
  const ids = [...new Set(rows.map((r) => r.productId).filter((n): n is number => !!n))];
  const startedAt = Date.now();
  let ranOutOfTime = false;
  for (const id of ids) {
    if (Date.now() - startedAt > LINK_BUDGET_MS - EXPECTED_LOOKUP_MS) {
      ranOutOfTime = true;
      break;
    }
    // The slug off the row this id came from. Any row with the id will do -
    // the id IS the product, so they all name the same set.
    const slug = rows.find((r) => r.productId === id)?.tcgSlug || "";
    const card = await getTcgcsvCardByProductId(id, slug).catch(() => null);
    if (card?.id) {
      out.set(id, {
        cardId: card.id,
        variant: String(card.variant || ""),
        image: String(card.imageLarge || card.image || ""),
        rarity: String(card.rarity || ""),
      });
    }
  }
  return { linked: out, ranOutOfTime, attempted: ids.length };
}

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
    // alias-aware: also matches names products have been renamed away from,
    // so an import using an old name merges instead of creating a duplicate
    const byName = indexByName(existing);

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
        // Keep the cached record in step with what was just written, so two
        // rows that resolve to the same product add up instead of the second
        // overwriting the first. A Collectr export naming a product by its
        // current name on one line and a former name on another does exactly
        // that, and indexByName points both at the same record.
        hit.fields["Qty On Hand"] = fields["Qty On Hand"];
        if (fields["Buy Price"] !== undefined) hit.fields["Buy Price"] = fields["Buy Price"];
        if (fields["Market Price"] !== undefined) hit.fields["Market Price"] = fields["Market Price"];
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

  let singlesLinked = 0;
  let linkRanOutOfTime = false;

  if (singles.length) {
    const today = new Date().toISOString().slice(0, 10);
    const addedBy = me.streamer?.fields?.["Name"] || me.email;
    const link = await linkProducts(singles).catch(() => null);
    linkRanOutOfTime = !!link?.ranOutOfTime;
    const toCreate = singles
      .filter((r) => String(r.name || "").trim())
      .map((r) => {
        const hit = r.productId ? link?.linked.get(r.productId) : undefined;
        const fields: Record<string, any> = {
          "Card Name": String(r.name).trim(),
          "Set Name": r.setName || "",
          "Card Number": r.number || "",
          // The mirror's rarity when we linked, since the export writes
          // "None" on an unnumbered promo where the catalog knows better.
          "Rarity": hit?.rarity || r.rarity || "",
          "Condition": r.condition || "NM",
          "Qty": Math.max(1, r.qty || 1),
          "Status": "In Stock",
          "Notes": r.notes || "",
          "Added By": addedBy,
          "Date Added": r.dateAdded || today,
        };
        if (hit) {
          fields["Card ID"] = hit.cardId;
          // The printing qualifier, which is what tells two products with the
          // same number apart and what the sold-comp lookup keys on.
          if (hit.variant) fields["Variant"] = hit.variant;
          singlesLinked++;
        }
        // cl-v2. Only ever written when it is not English, matching how the
        // column is read everywhere else. Writing "English" on everything
        // would make a filter that means "say so if it is not" useless.
        if (r.language) fields["Language"] = r.language;
        if (r.printing) fields["Printing"] = r.printing;
        const img = hit?.image || r.imageUrl || "";
        if (img && /^https?:\/\//.test(img)) fields["Image URL"] = img;
        if (ownerRecId) fields["Owner Rec Id"] = ownerRecId;
        if (r.buy && r.buy > 0) fields["Buy Price"] = r.buy;
        if (r.comp && r.comp > 0) {
          fields["Comp"] = r.comp;
          fields["Entry Comp"] = r.comp;
          fields["Comp Source"] = r.compSource || "Collectr import (market)";
          fields["Comp Date"] = today;
        }
        return fields;
      });
    if (toCreate.length) {
      const made = await atCreateBatch(T.singles, toCreate);
      singlesCreated = made.length;
    }
  }

  return NextResponse.json({
    sealedCreated, sealedMerged, singlesCreated, sealedSkipped,
    // How many of the imported cards came out linked to a TCGplayer product,
    // and whether the lookup budget ran out before the rest could be tried.
    // Reported rather than assumed: an unlinked card is not broken, it just
    // will not reprice itself, and that is worth knowing at import time
    // instead of discovering it a month later on a stale sticker.
    singlesLinked, linkRanOutOfTime,
  });
}
