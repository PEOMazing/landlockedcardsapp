import { NextResponse } from "next/server";
import { T, atGet, atUpdate, isRecId } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { resolveTcgUrl } from "@/lib/tcgMap";

export const maxDuration = 60;

// Lock an inventory product to one exact TCGplayer product. Stores the link
// plus the set it lives in, so every future refresh reads that set's price file
// directly instead of trying to recognise the product by name.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const { url } = await req.json().catch(() => ({ url: "" }));
  if (!url) return NextResponse.json({ error: "Paste a TCGplayer product link first." }, { status: 400 });

  const result = await resolveTcgUrl(url);
  if (!result.ok || !result.match) return NextResponse.json({ error: result.reason || "Could not resolve that link." }, { status: 422 });
  const m = result.match;

  const existing = await atGet(T.inventory, params.id).catch(() => null);
  const today = new Date().toISOString().slice(0, 10);

  const fields: Record<string, any> = {
    "TCGplayer URL": m.cleanUrl,
    "TCG Group Id": m.groupId,
    "TCG Category Id": m.categoryId,
  };
  // A mapped product id cannot be the wrong product, so take the price as given
  // rather than running it past the name-match sanity band.
  if (m.market !== null) {
    fields["Market Price"] = m.market;
    fields["Price Checked"] = today;
    if (!(Number(existing?.fields["Entry Market"]) > 0)) fields["Entry Market"] = m.market;
    if (!existing?.fields["Date Added"]) fields["Date Added"] = today;
  }
  if (m.imageUrl && !existing?.fields["Image URL"]) fields["Image URL"] = m.imageUrl;

  await atUpdate(T.inventory, params.id, fields);
  return NextResponse.json({ ok: true, match: m, pricedNow: m.market !== null });
}

// Unmap: drop the link and the set pointer. The last known market price stays
// put so the product does not silently fall to zero on live boards.
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.isManager) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await atUpdate(T.inventory, params.id, {
    "TCGplayer URL": "",
    "TCG Group Id": null,
    "TCG Category Id": null,
  });
  return NextResponse.json({ ok: true });
}
