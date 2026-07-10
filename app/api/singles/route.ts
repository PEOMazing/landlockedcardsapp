import { NextResponse } from "next/server";
import { atCreate, atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { getCard } from "@/lib/pokemon";
import { getTcgcsvCard, isTcgcsvCardId } from "@/lib/tcgcsv";
import { toSingle } from "@/lib/singles";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const params: Record<string, string> = { "sort[0][field]": "Date Added", "sort[0][direction]": "desc" };
  if (status && ["In Stock", "In Stream", "Sold"].includes(status)) {
    params.filterByFormula = `{Status} = '${status}'`;
  }
  try {
    const rows = await atList(T.singles, params);
    return NextResponse.json({ singles: rows.map((r) => toSingle(r, me.isAdmin)) });
  } catch (e: any) {
    // table missing means setup has not been run yet
    if (String(e.message).includes("404") || String(e.message).includes("TABLE_NOT_FOUND")) {
      return NextResponse.json({ singles: [], needsSetup: true });
    }
    throw e;
  }
}

// Add a card to the singles inventory. Two paths:
// - cardId set: pulls name/set/number/rarity/image/comp from pokemontcg.io
// - manual: caller supplies name (and whatever else they know)
export async function POST(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();

  let fields: Record<string, any> = {
    "Condition": b.condition || "Raw",
    "Qty": Math.max(1, parseInt(b.qty) || 1),
    "Status": "In Stock",
    "Notes": b.notes || "",
    "Added By": me.streamer?.fields?.["Name"] || me.email,
    "Date Added": new Date().toISOString().slice(0, 10),
  };
  // buy price is admin territory, same as the sealed inventory
  if (me.isAdmin && b.buyPrice !== undefined) fields["Buy Price"] = Math.max(0, parseFloat(b.buyPrice) || 0);

  if (b.cardId) {
    const cid = String(b.cardId);
    const card = cid.startsWith("tcg:") ? await getTcgcsvCard(cid) : await getCard(cid);
    if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });
    fields = {
      ...fields,
      "Card Name": card.name,
      "Set Name": card.setName,
      "Card Number": card.number,
      "Card ID": card.id,
      "Rarity": card.rarity,
      "Variant": card.variant || "",
      "Image URL": card.imageLarge || card.image || "",
    };
    // raw cards get an automatic TCGplayer market comp; graded comps are manual
    if ((fields["Condition"] === "Raw" || !b.condition) && card.market !== null) {
      fields["Comp"] = card.market;
      fields["Comp Source"] = `TCGplayer market (${card.variant})`;
      fields["Comp Date"] = new Date().toISOString().slice(0, 10);
    }
  } else {
    const name = String(b.name || "").trim();
    if (!name) return NextResponse.json({ error: "name or cardId required" }, { status: 400 });
    fields["Card Name"] = name;
    if (b.setName) fields["Set Name"] = b.setName;
    if (b.number) fields["Card Number"] = b.number;
    if (b.rarity) fields["Rarity"] = b.rarity;
    if (b.imageUrl) fields["Image URL"] = b.imageUrl;
  }
  if (b.comp !== undefined && parseFloat(b.comp) > 0) {
    fields["Comp"] = parseFloat(b.comp);
    fields["Comp Source"] = b.compSource || "manual";
    fields["Comp Date"] = new Date().toISOString().slice(0, 10);
  }

  const rec = await atCreate(T.singles, fields);
  return NextResponse.json({ single: toSingle(rec, me.isAdmin) });
}
