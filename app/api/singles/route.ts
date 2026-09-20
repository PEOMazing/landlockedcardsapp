import { NextResponse } from "next/server";
import { atCreate, atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { getCard } from "@/lib/pokemon";
import { conditionSoldComp, getTcgcsvCard, tcgProductIdFromCardId } from "@/lib/tcgcsvCards";
import { toSingle } from "@/lib/singles";
import { roundUpDollar } from "@/lib/salesWindow";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await getMe();
  if (!me?.isTeam && !me?.isCollector) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const params: Record<string, string> = { "sort[0][field]": "Date Added", "sort[0][direction]": "desc" };
  // team sees the company's cards; a collector sees only their own
  const ownerClause = me.isTeam ? `{Owner Rec Id} = ''` : `{Owner Rec Id} = '${me.streamer?.id}'`;
  params.filterByFormula = ownerClause;
  if (status && ["In Stock", "In Stream", "Sold"].includes(status)) {
    params.filterByFormula = `AND(${ownerClause}, {Status} = '${status}')`;
  }
  try {
    const rows = await atList(T.singles, params);
    return NextResponse.json({ singles: rows.map((r) => toSingle(r, me.isAdmin || me.isCollector)) });
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
  if (!me?.isTeam && !me?.isCollector) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();

  let fields: Record<string, any> = {
    "Condition": b.condition || "Raw",
    "Qty": Math.max(1, parseInt(b.qty) || 1),
    "Status": "In Stock",
    // collector cards live in their own walled collection
    ...(me.isCollector ? { "Owner Rec Id": me.streamer?.id || "" } : {}),
    "Notes": b.notes || "",
    "Added By": me.streamer?.fields?.["Name"] || me.email,
    "Date Added": new Date().toISOString().slice(0, 10),
  };
  if (b.printing) fields["Printing"] = String(b.printing);
  // buy price is admin territory, same as the sealed inventory
  if (me.isAdmin && b.buyPrice !== undefined) fields["Buy Price"] = Math.max(0, parseFloat(b.buyPrice) || 0);

  if (b.cardId) {
    const cid = String(b.cardId);
    let card: any = null;
    let outage = "";
    try {
      card = cid.startsWith("tcg:") ? await getTcgcsvCard(cid) : await getCard(cid);
    } catch (e: any) {
      outage = String(e?.message || "lookup failed");
    }
    // The browser already has everything the search box showed - name, set,
    // number, rarity, art, price - so when the catalog is down we use that
    // instead of refusing the card. Re-fetching data we were already holding
    // is what turned an upstream hiccup into "you cannot add this card", and
    // the person on the other end is usually holding it in their hand.
    let fromClient = false;
    if (!card && b.card && String(b.card.name || "").trim()) {
      const c = b.card;
      const mk = parseFloat(c.market);
      card = {
        id: cid,
        name: String(c.name).trim(),
        setName: String(c.setName || ""),
        number: String(c.number || ""),
        rarity: String(c.rarity || ""),
        image: String(c.image || ""),
        imageLarge: String(c.image || ""),
        market: Number.isFinite(mk) && mk > 0 ? mk : null,
        variant: String(c.variant || ""),
      };
      fromClient = true;
    }
    if (!card) {
      // An outage and a missing card get different words and different codes,
      // so the screen can tell someone whether retrying is worth their time.
      return outage
        ? NextResponse.json(
            { error: "the card price source is not responding - try again in a moment, or use Add manually", detail: outage, retryable: true },
            { status: 502 },
          )
        : NextResponse.json({ error: "card not found" }, { status: 404 });
    }
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
    // ungraded cards get an automatic TCGplayer market comp, discounted by
    // condition (market prices are NM basis); graded comps are manual
    const CONDITION_MULT: Record<string, number> = { NM: 1, Raw: 1, LP: 0.9, MP: 0.8, HP: 0.65, DM: 0.5 };
    const cond = String(fields["Condition"]);
    const mult = CONDITION_MULT[cond];
    if (mult !== undefined) {
      // best comp: median of recent TCGplayer sales in this exact condition
      const pid = tcgProductIdFromCardId(String(b.cardId));
      const sold = pid ? await conditionSoldComp(pid, cond) : null;
      if (sold) {
        // whole dollars on every comp the tool works out, same as the rolling
        // reprice - a card entered at $94.24 and stickered before the next
        // pass would otherwise carry cents the rest of the collection lost
        fields["Comp"] = roundUpDollar(sold.price);
        fields["Comp Source"] = `TCGplayer solds (${cond}, median of ${sold.sales})`;
        fields["Comp Date"] = new Date().toISOString().slice(0, 10);
        fields["Comp Detail"] = JSON.stringify(sold.detail);
      } else if (card.market !== null) {
        fields["Comp"] = roundUpDollar(card.market * mult);
        // fromClient means the catalog was down and this price is the one the
        // search box was showing a moment earlier. Say so, so the number is not
        // mistaken later for a fresh reading.
        fields["Comp Source"] =
          `TCGplayer market (${card.variant})` +
          (mult < 1 ? ` x ${cond} ${Math.round(mult * 100)}% est.` : "") +
          (fromClient ? ", from search at entry" : "");
        fields["Comp Date"] = new Date().toISOString().slice(0, 10);
      }
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

  // entry benchmark: whatever the comp is at the moment of entry
  if (typeof fields["Comp"] === "number" && fields["Comp"] > 0) fields["Entry Comp"] = fields["Comp"];
  const rec = await atCreate(T.singles, fields);
  return NextResponse.json({ single: toSingle(rec, me.isAdmin) });
}
