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
  const fields: Record<string, any> = {};
  // Store sale quantities are tied to what came off the shelf; they are
  // entered and finished from the Store sales section, not edited here.
  if (g.line.fields["Is Store Purchase"] && (b.qty !== undefined || b.qtyHit !== undefined)) {
    return NextResponse.json({ error: "store sales are changed from the Store sales section - undo it and enter it again" }, { status: 400 });
  }
  if (b.qtyHit !== undefined) {
    if (returned) return NextResponse.json({ error: "items already returned - hits are locked" }, { status: 400 });
    fields["Qty Hit"] = Math.max(0, parseInt(b.qtyHit) || 0);
  }
  // Pull a card off the OBS board, or put it back. Purely cosmetic: it changes
  // nothing about quantities, hits, stock or pay, which is the point - the
  // streamer needs a way to take a card off screen mid-show without claiming
  // it was won.
  if (b.offBoard !== undefined) {
    fields["Off Board"] = !!b.offBoard;
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
  //
  // Recorded as a trace rather than an alert. Removing a line is what editing
  // a show set IS, so as an alert this put a banner on top of every page for
  // every team member on every edit, with a separate "done" to click on each.
  // The forensics are still worth having and still land in the Alerts table;
  // they just do not interrupt the person doing the work being traced.
  try {
    const { recordTrace } = await import("@/lib/alerts");
    await recordTrace(`TRIPWIRE: line deleted - ${g.line.fields["Line"] || params.id}`, {
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
  // What comes back is what is physically still here, which is never the hit
  // units: those were ripped on stream and mailed to whoever won them.
  //
  //   before the return   the unhit remainder is still in the box   qty - hit
  //   after the return    the remainder already went back           hit
  //   store line          only the hit units ever left the shelf    hit
  //
  // The first case used to restore the full qty, on the reasoning that nothing
  // had left the building yet. That holds right up until the first spin lands.
  // Delete a 40-pack line mid-show with 12 already hit and the shelf gained 12
  // packs that were in the post. It now matches what the return route does
  // with the same line, which is the behaviour that was always correct.
  //
  // Post-return removal is a history correction, so it is manager-gated.
  if (returned && !g.me.isManager && !g.me.isAdmin) {
    return NextResponse.json({ error: "items were returned - only managers can remove lines from a closed stream" }, { status: 403 });
  }
  const qty = g.line.fields["Qty"] || 0;
  const hit = g.line.fields["Qty Hit"] || 0;
  const restore = g.line.fields["Is Store Purchase"] || returned ? hit : Math.max(qty - hit, 0);
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
