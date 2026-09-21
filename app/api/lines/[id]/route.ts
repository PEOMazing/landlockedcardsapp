import { NextResponse } from "next/server";
import { stockAlert } from "@/lib/alerts";
import { atDelete, atGet, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream, canManageStream } from "@/lib/auth";
import { releaseSingleFromLine } from "@/lib/streamSingles";
import { clampStock, shortMessage } from "@/lib/stock";

async function guard(lineId: string) {
  const me = await getMe();
  if (!me) return { err: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (!isRecId(lineId)) return { err: NextResponse.json({ error: "bad id" }, { status: 400 }) };
  const line = await atGet(T.lines, lineId);
  const streamId = line.fields["Stream Rec Id"];
  const stream = await atGet(T.streams, streamId);
  if (!ownsStream(me, stream)) return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { me, line, stream };
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if ("err" in g) return g.err;
  const b = await req.json();
  const returned = !!g.stream.fields["Items Returned"];
  // TEMPORARY inventory-rebuild window (expires 2026-07-20 23:00 Denver time):
  // Gabe is redoing inventory by hand, so admin line removals on closed streams
  // skip stock restoration and alerts entirely - pure bookkeeping deletes.
  // After expiry this block is inert and the hit-portion-restore rule resumes.
  const rebuildWindow = g.me.isAdmin && Date.now() < Date.parse("2026-07-21T05:00:00Z");
  if (returned && rebuildWindow) {
    await atDelete(T.lines, params.id);
    return NextResponse.json({ ok: true, restored: 0, rebuildWindow: true });
  }
  const fields: Record<string, any> = {};
  if (b.qtyHit !== undefined) {
    if (returned) return NextResponse.json({ error: "items already returned - hits are locked" }, { status: 400 });
    fields["Qty Hit"] = Math.max(0, parseInt(b.qtyHit) || 0);
  }
  if (b.market !== undefined) {
    // pricing is admin/manager territory
    if (!canManageStream(g.me, g.stream)) {
      return NextResponse.json({ error: "only admin or the stream manager can set prices" }, { status: 403 });
    }
    const mkt = Math.max(0, parseFloat(b.market) || 0);
    fields["Market Price Snapshot"] = mkt;
    // keep the inventory master in sync and stamp the price check
    const productId = g.line.fields["Product"]?.[0];
    if (productId) {
      await atUpdate(T.inventory, productId, {
        "Market Price": mkt,
        "Price Checked": new Date().toISOString().slice(0, 10),
      });
    }
  }
  if (b.qty !== undefined) {
    if (returned) return NextResponse.json({ error: "items already returned - show set is locked" }, { status: 400 });
    // one line is one physical card - more copies means adding the card again
    if (g.line.fields["Single Rec Id"]) return NextResponse.json({ error: "a single card line is always qty 1 - add another copy from the singles picker instead" }, { status: 400 });
    const newQty = Math.max(1, parseInt(b.qty) || 1);
    const oldQty = g.line.fields["Qty"] || 0;
    const hits = g.line.fields["Qty Hit"] || 0;
    if (newQty < hits) return NextResponse.json({ error: `quantity cannot go below the ${hits} already hit` }, { status: 400 });
    const productId = g.line.fields["Product"]?.[0];
    const product = productId ? await atGet(T.inventory, productId) : null;
    // raising a line pulls more from the shelf, and the shelf cannot go below zero
    if (product && newQty > oldQty && (product.fields["Qty On Hand"] ?? 0) < newQty - oldQty) {
      return NextResponse.json({ error: shortMessage(product.fields["Product Name"], product.fields["Qty On Hand"], newQty - oldQty) }, { status: 400 });
    }
    fields["Qty"] = newQty;
    fields["Line"] = `${newQty}x ${(g.line.fields["Line"] || "").replace(/^\d+x\s+/, "")}`;
    if (productId && product) {
      await atUpdate(T.inventory, productId, {
        "Qty On Hand": clampStock((product.fields["Qty On Hand"] ?? 0) + oldQty - newQty),
      });
    }
  }
  await atUpdate(T.lines, params.id, fields);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if ("err" in g) return g.err;
  // TRIPWIRE (temporary): record every line deletion with its caller so the
  // phantom mass-delete can be traced. Remove once the culprit is found.
  try {
    const { recordAlert } = await import("@/lib/alerts");
    await recordAlert("stock", `TRIPWIRE: line deleted - ${g.line.fields["Line"] || params.id}`, {
      lineId: params.id,
      line: g.line.fields["Line"] || "",
      streamId: g.line.fields["Stream Rec Id"] || "",
      user: g.me?.streamer?.fields?.["Name"] || g.me?.streamer?.id || "unknown",
      referer: req.headers.get("referer") || "",
      userAgent: (req.headers.get("user-agent") || "").slice(0, 120),
      at: new Date().toISOString(),
    });
  } catch {}
  const returned = !!g.stream.fields["Items Returned"];
  // Before a return: removing a line restores its full quantity (nothing left
  // the building yet). After a return: the unhit portion already went back, so
  // removing the line restores only the hit portion - inventory nets out as if
  // the line never existed. Post-return removal is a history correction, so it
  // is manager-gated.
  if (returned && !g.me.isManager && !g.me.isAdmin) {
    return NextResponse.json({ error: "items were returned - only managers can remove lines from a closed stream" }, { status: 403 });
  }
  const qty = g.line.fields["Qty"] || 0;
  const hit = g.line.fields["Qty Hit"] || 0;
  const restore = returned ? hit : qty;
  const productId = g.line.fields["Product"]?.[0];
  if (productId && restore > 0) {
    const product = await atGet(T.inventory, productId);
    await atUpdate(T.inventory, productId, {
      "Qty On Hand": (product.fields["Qty On Hand"] ?? 0) + restore,
    });
    if (returned) {
      await stockAlert(
        [{ name: product.fields["Product Name"], qtyNow: (product.fields["Qty On Hand"] ?? 0) + restore, delta: restore }],
        "line removed from a closed stream"
      ).catch(() => {});
    }
  }
  // A single card's line has no Product, so the restore above skips it. Put
  // the card itself back instead - otherwise taking a card off a wheel while
  // building the set leaves it stuck In Stream and invisible to every picker.
  const singleReleased = await releaseSingleFromLine(
    g.line,
    String(g.line.fields["Stream Rec Id"] || ""),
    String(g.stream.fields["Stream Type"] || "Surprise Set"),
    returned,
  );
  await atDelete(T.lines, params.id);
  return NextResponse.json({ ok: true, restored: restore, singleReleased });
}
