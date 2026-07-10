import { NextResponse } from "next/server";
import { atGet, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { getCard } from "@/lib/pokemon";
import { conditionSoldComp, getTcgcsvCard, tcgProductIdFromCardId } from "@/lib/tcgcsvCards";
import { toSingle } from "@/lib/singles";

// Refresh a raw card's comp from its linked pokemontcg.io card record.
// Graded cards are manual on purpose: no free API covers graded pricing.
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const rec = await atGet(T.singles, params.id);
  const cardId = rec.fields["Card ID"];
  if (!cardId) {
    return NextResponse.json({ error: "no linked card - this single was added manually, so enter the comp by hand" }, { status: 400 });
  }
  const CONDITION_MULT: Record<string, number> = { NM: 1, Raw: 1, LP: 0.9, MP: 0.8, HP: 0.65, DM: 0.5 };
  const mult = CONDITION_MULT[String(rec.fields["Condition"] || "Raw")];
  if (mult === undefined) {
    return NextResponse.json({ error: "graded comps are manual - use the eBay sold link and type it in" }, { status: 400 });
  }
  const cid = String(cardId);
  const card = cid.startsWith("tcg:") ? await getTcgcsvCard(cid) : await getCard(cid);
  if (!card || card.market === null) {
    return NextResponse.json({ error: "no market price available for this card right now" }, { status: 404 });
  }
  const updated = await atUpdate(T.singles, params.id, {
    "Comp": card.market,
    "Comp Source": cid.startsWith("tcg:") ? "TCGplayer market" : `TCGplayer market (${card.variant})`,
    "Comp Date": new Date().toISOString().slice(0, 10),
  });
  return NextResponse.json({ single: toSingle(updated, me.isAdmin) });
}
