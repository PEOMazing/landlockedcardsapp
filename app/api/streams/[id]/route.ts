import { NextResponse } from "next/server";
import { atGet, atList, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream, canManageStream } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { toLine, isHitLine } from "@/lib/calc";
import { syncWheelSinglePrices } from "@/lib/streamSingles";


// The historical delivery rate is computed from every line and every completed
// stream in the base. That is two whole-table reads, and this route runs on
// every keystroke-ish action on the stream page - adding forty cards to a wheel
// was pulling the entire Stream Products table forty times for a number that
// moves once a week. Cached in the warm instance for a few minutes; a stale
// percentage on a background stat is not a number anybody acts on.
const HIST_TTL = 5 * 60 * 1000;
const histCache: { lines?: { at: number; rows: any[] }; streams?: { at: number; rows: any[] } } = {};

async function histLines(): Promise<any[]> {
  if (histCache.lines && Date.now() - histCache.lines.at < HIST_TTL) return histCache.lines.rows;
  const rows = await atList(T.lines);
  histCache.lines = { at: Date.now(), rows };
  return rows;
}

async function histStreams(): Promise<any[]> {
  if (histCache.streams && Date.now() - histCache.streams.at < HIST_TTL) return histCache.streams.rows;
  const rows = await atList(T.streams, { filterByFormula: "AND({Status} = 'Complete', {Deleted At} = BLANK())" });
  histCache.streams = { at: Date.now(), rows };
  return rows;
}


// Put the card's current binder slot at the front of a show-set line, replacing
// whatever number is already there. Blank slot leaves the line untouched: a
// sealed product has no pocket, and a card waiting to be filed is better shown
// with its old number than with none.
function slotLabel(name: string, slot?: number): string {
  if (!slot) return name;
  const tag = `[${String(slot).padStart(4, "0")}]`;
  return /^\[\d+\]/.test(name) ? name.replace(/^\[\d+\]/, tag) : `${tag} ${name}`;
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const stream = await atGet(T.streams, params.id);
  if (!ownsStream(me, stream)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const isComplete = (stream.fields["Status"] || "Planned") === "Complete";
  const [lineRows, timeRows, settings, allLines, completedStreams, inventoryRows] = await Promise.all([
    atList(T.lines, { filterByFormula: `{Stream Rec Id} = '${params.id}'` }),
    atList(T.time, { filterByFormula: `{Stream Rec Id} = '${params.id}'`, "sort[0][field]": "Start" }),
    getSettings(),
    isComplete ? Promise.resolve([]) : histLines(),
    isComplete ? Promise.resolve([]) : histStreams(),
    atList(T.inventory),
  ]);
  const categoryByProduct: Record<string, string> = {};
  const tcgByProduct: Record<string, string> = {};
  const imageByProduct: Record<string, string> = {};
  for (const inv of inventoryRows) {
    categoryByProduct[inv.id] = inv.fields["Category"]?.name || inv.fields["Category"] || "";
    if (inv.fields["TCGplayer URL"]) tcgByProduct[inv.id] = inv.fields["TCGplayer URL"];
    if (inv.fields["Image URL"]) imageByProduct[inv.id] = inv.fields["Image URL"];
  }
  // Card art for single-card lines, which keep it on the Singles record rather
  // than on an Inventory product. Without this every card on a wheel came back
  // imageless, which is fine for a text list and useless for the OBS board.
  const imageBySingle: Record<string, string> = {};
  const slotBySingle: Record<string, number> = {};
  const singleIds = Array.from(
    new Set(lineRows.map((l) => String(l.fields["Single Rec Id"] || "")).filter(Boolean)),
  );
  if (singleIds.length) {
    const or = singleIds.map((sid) => `RECORD_ID() = '${sid}'`).join(", ");
    const singleRows = await atList(T.singles, { filterByFormula: `OR(${or})` }).catch(() => []);
    for (const s of singleRows) {
      const url = String(s.fields["Image URL"] || "").trim();
      if (url) imageBySingle[s.id] = url;
      const slot = Number(s.fields["Slot"]);
      if (Number.isFinite(slot) && slot > 0) slotBySingle[s.id] = slot;
    }
  }

  // An open wheel shows its singles at today's comp, not the price they had
  // when the set was built. A closed show keeps the prices it closed at.
  if (!isComplete && !stream.fields["Items Returned"]) {
    await syncWheelSinglePrices(lineRows, String(stream.fields["Stream Type"] || "Surprise Set")).catch(() => 0);
  }
  const lines = lineRows.map(toLine);

  // historical pool-delivery rate: across completed streams (excluding this one),
  // what % of the hit pool actually went out
  const completedIds = new Set(completedStreams.map((r) => r.id).filter((cid) => cid !== params.id));
  let histPool = 0, histDelivered = 0;
  for (const l of allLines) {
    const sid = l.fields["Stream Rec Id"];
    if (!sid || !completedIds.has(sid)) continue;
    const line = toLine(l);
    if (isHitLine(line, settings)) {
      histPool += line.qty;
      histDelivered += line.qtyHit;
    }
  }
  const histDeliveryRate = histPool > 0 ? histDelivered / histPool : null;

  let managerName = "";
  let streamerName = "";
  let overrideName = "";
  const managerId = stream.fields["Manager Rec Id"];
  const overrideId = stream.fields["Override Rec Id"] || null;
  const streamerRecId = stream.fields["Streamer Rec Id"] || null;
  let streamerRow: any = null;
  if (streamerRecId) {
    try { streamerRow = await atGet(T.streamers, streamerRecId); streamerName = streamerRow.fields["Name"] || ""; } catch {}
  }
  if (managerId) {
    try { managerName = (await atGet(T.streamers, managerId)).fields["Name"] || ""; } catch {}
  }
  if (overrideId) {
    if (overrideId === managerId) overrideName = managerName;
    else { try { overrideName = (await atGet(T.streamers, overrideId)).fields["Name"] || ""; } catch {} }
  }

  const timeEntries = timeRows.map((t) => ({
    id: t.id,
    type: t.fields["Type"],
    person: t.fields["Person Name"] || "",
    start: t.fields["Start"] || "",
    end: t.fields["End"] || "",
    hours: t.fields["Hours"] || 0,
    label: t.fields["Entry"] || "",
  }));

  return NextResponse.json({
    canManage: canManageStream(me, stream),
    timeEntries,
    stream: {
      id: stream.id,
      title: stream.fields["Title"],
      date: stream.fields["Stream Date"],
      status: stream.fields["Status"] || "Planned",
      liveStartedAt: stream.fields["Live Started At"] || null,
      afterFees: stream.fields["After Fees"] ?? null,
      promotion: stream.fields["Promotion"] ?? null,
      shippingAdjustments: stream.fields["Shipping Adjustments"] ?? null,
      tips: stream.fields["Tips"] ?? null,
      hours: stream.fields["Hours Streamed"] ?? null,
      packingHours: stream.fields["Packing Hours"] ?? null,
      spotsSold: stream.fields["Spots Sold"] ?? null,
      giveaways: stream.fields["Giveaways Run"] ?? null,
      singlesGiveaways: stream.fields["Singles Giveaways Run"] ?? null,
      itemsReturned: !!stream.fields["Items Returned"],
      managerPackingHours: stream.fields["Manager Packing Hours"] ?? null,
      managerName,
      streamerName,
      streamerRecId,
      managerRecId: managerId || null,
      overrideRecId: overrideId,
      overrideName,
      overrideExcluded: !!stream.fields["Override Excluded"],
      notes: stream.fields["Notes"] || "",
      streamType: stream.fields["Stream Type"] || "Surprise Set",
      checklist: (() => {
        try { return stream.fields["Checklist"] ? JSON.parse(stream.fields["Checklist"]) : null; }
        catch { return null; }
      })(),
    },
    lines: lines.map((l, i) => ({
      id: l.id,
      // The bracketed number is rewritten from the card's live slot rather than
      // read from the stored line text. Lines written before the number became
      // the slot still carry a Card No, and a card that gets refiled moves
      // pocket - both would otherwise send the packer to the wrong sleeve
      // forever, since the text is only written once at add time.
      name: slotLabel(
        l.name.replace(/^\d+x\s+/, ""),
        slotBySingle[String(lineRows[i].fields["Single Rec Id"] || "")],
      ),
      qty: l.qty, qtyHit: l.qtyHit,
      market: l.market, isGiveaway: l.isGiveaway, isHit: isHitLine(l, settings),
      isStore: !!lineRows[i].fields["Is Store Purchase"],
      soldPrice: lineRows[i].fields["Sold Price"] || 0,
      orderId: lineRows[i].fields["Whatnot Order Id"] || "",
      productId: lineRows[i].fields["Product"]?.[0] || "",
      isGraded: categoryByProduct[lineRows[i].fields["Product"]?.[0]] === "Graded Card",
      tcgUrl: tcgByProduct[lineRows[i].fields["Product"]?.[0]] || "",
      image:
        imageBySingle[String(lineRows[i].fields["Single Rec Id"] || "")] ||
        imageByProduct[lineRows[i].fields["Product"]?.[0]] ||
        "",
      // whether the streamer has pulled this card off the OBS board by hand
      offBoard: !!lineRows[i].fields["Off Board"],
      // Set on a single-card line, blank on sealed. The client has been asking
      // for this to decide singles-only behaviour and never receiving it, so
      // every such check has quietly been reading false.
      singleRecId: String(lineRows[i].fields["Single Rec Id"] || ""),
      // Binder pocket, which is the number on the sticker and the number the
      // show set is ordered by. Null on sealed product and on a card not
      // currently filed in a binder.
      slot: slotBySingle[String(lineRows[i].fields["Single Rec Id"] || "")] ?? null,
      ...(me.isAdmin ? { buy: l.buy } : {}),
    })),
    config: {
      hitThreshold: settings.hit_threshold,
      breakevenMult: settings.breakeven_mult,
      giveawayCost: settings.giveaway_cost,
      singlesGiveawayCost: settings.singles_giveaway_cost,
      histDeliveryRate,
      // average spin cost = total product cost / total items in the set,
      // then x the multiplier = the break-even spin price. Computed here so
      // the finished number ships without any per-item buy prices.
      ...(() => {
        const sellable = lines.filter((l) => !l.isGiveaway);
        const spots = sellable.reduce((a, l) => a + l.qty, 0);
        const missing = sellable.filter((l) => !(l.buy > 0)).reduce((a, l) => a + l.qty, 0);
        const totalCost = lines.reduce((a, l) => a + l.qty * (l.buy || 0), 0);
        // the true 1.5x-on-cost number only exists when every sellable item
        // carries a real buy cost - a partial cost base understates it badly
        return {
          costBreakEvenPerSpot:
            spots > 0 && missing === 0 && totalCost > 0
              ? Math.round(((totalCost / spots) * settings.breakeven_mult) * 100) / 100
              : null,
          costMissingQty: missing,
        };
      })(),
    },
    pay: {
      packingRate: settings.packing_rate,
      hourlyRate: (() => {
        const sid = stream.fields["Streamer Rec Id"];
        if (!sid) return settings.default_hourly_rate;
        try {
          const rate = streamerRow?.fields?.["Hourly Rate"];
          return typeof rate === "number" && rate > 0 ? rate : settings.default_hourly_rate;
        } catch { return settings.default_hourly_rate; }
      })(),
    },
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const stream = await atGet(T.streams, params.id);
  if (!ownsStream(me, stream)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json();
  const fields: Record<string, any> = {};
  // rename or move a show - managers only
  if (b.title !== undefined || b.date !== undefined) {
    if (!me.isManager && !me.isAdmin) return NextResponse.json({ error: "only managers can rename or move a stream" }, { status: 403 });
    const oldDate = stream.fields["Stream Date"] || "";
    if (b.date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
      fields["Stream Date"] = b.date;
    }
    if (b.title !== undefined) {
      const t = String(b.title).trim();
      if (!t) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
      fields["Title"] = t.slice(0, 120);
    } else if (b.date !== undefined && String(stream.fields["Title"] || "").startsWith(oldDate)) {
      // the show moved and the title still leads with the old date - keep them in step
      fields["Title"] = String(stream.fields["Title"]).replace(oldDate, b.date);
    }
  }
  if (b.paidOut !== undefined) {
    if (!me.isAdmin) return NextResponse.json({ error: "only admin can mark pay" }, { status: 403 });
    fields["Paid Out"] = !!b.paidOut;
    fields["Paid At"] = b.paidOut ? new Date().toISOString().slice(0, 10) : null;
  }
  if (b.afterFees !== undefined) fields["After Fees"] = b.afterFees;
  if (b.promotion !== undefined) fields["Promotion"] = b.promotion;
  if (b.shippingAdjustments !== undefined) fields["Shipping Adjustments"] = Math.max(0, parseFloat(b.shippingAdjustments) || 0);
  if (b.tips !== undefined) fields["Tips"] = b.tips;
  if (b.spotsSold !== undefined) fields["Spots Sold"] = b.spotsSold;
  if (b.giveaways !== undefined) fields["Giveaways Run"] = Math.max(0, parseInt(b.giveaways) || 0);
  if (b.singlesGiveaways !== undefined) fields["Singles Giveaways Run"] = Math.max(0, parseInt(b.singlesGiveaways) || 0);
  // reassign the show to a different streamer - managers only
  if (b.streamerId !== undefined) {
    if (!me.isManager && !me.isAdmin) return NextResponse.json({ error: "only managers can reassign a stream" }, { status: 403 });
    if (!isRecId(String(b.streamerId))) return NextResponse.json({ error: "bad streamer id" }, { status: 400 });
    try { await atGet(T.streamers, b.streamerId); } catch { return NextResponse.json({ error: "unknown streamer" }, { status: 400 }); }
    fields["Streamer Rec Id"] = b.streamerId;
  }
  // assign the packaging person - managers only
  if (b.managerId !== undefined) {
    if (!me.isManager && !me.isAdmin) return NextResponse.json({ error: "only managers can assign packaging" }, { status: 403 });
    if (b.managerId === null || b.managerId === "") {
      fields["Manager Rec Id"] = "";
    } else {
      if (!isRecId(String(b.managerId))) return NextResponse.json({ error: "bad person id" }, { status: 400 });
      try { await atGet(T.streamers, b.managerId); } catch { return NextResponse.json({ error: "unknown person" }, { status: 400 }); }
      fields["Manager Rec Id"] = b.managerId;
    }
  }
  // who earns the override on this show - ADMIN ONLY, separate from packaging above
  if (b.overrideRecId !== undefined) {
    if (!me.isAdmin) return NextResponse.json({ error: "only the admin can assign the override" }, { status: 403 });
    if (b.overrideRecId === null || b.overrideRecId === "") {
      fields["Override Rec Id"] = "";
    } else {
      if (!isRecId(String(b.overrideRecId))) return NextResponse.json({ error: "bad person id" }, { status: 400 });
      try { await atGet(T.streamers, b.overrideRecId); } catch { return NextResponse.json({ error: "unknown person" }, { status: 400 }); }
      fields["Override Rec Id"] = b.overrideRecId;
    }
  }
  // commission override eligibility - admin only, stored inverted so old streams stay eligible
  if (b.overrideEligible !== undefined) {
    if (!me.isAdmin) return NextResponse.json({ error: "only the admin can change override eligibility" }, { status: 403 });
    fields["Override Excluded"] = !b.overrideEligible;
  }
  // hours come from the timeclock (/api/time), not direct edits
  if (b.status === "Complete") {
    if (!me.isManager && !me.isAdmin) return NextResponse.json({ error: "only managers can mark a stream complete" }, { status: 403 });
    const afterFees = b.afterFees !== undefined ? b.afterFees : stream.fields["After Fees"];
    const spots = b.spotsSold !== undefined ? b.spotsSold : stream.fields["Spots Sold"];
    const hours = stream.fields["Hours Streamed"] || 0;
    let returned = !!stream.fields["Items Returned"];
    // A fully-hit board has nothing to send back, so the return step is a
    // formality - run it automatically instead of blocking completion on it.
    if (!returned) {
      const lines = await atList(T.lines, {
        filterByFormula: `{Stream Rec Id} = '${params.id}'`,
      });
      const unhit = lines.reduce(
        // store sales never go back to the shelf, so they do not count as unhit
        (n, l: any) => (l.fields["Is Store Purchase"] ? n : n + Math.max(0, (Number(l.fields["Qty"]) || 0) - (Number(l.fields["Qty Hit"]) || 0))),
        0
      );
      if (unhit === 0) {
        fields["Items Returned"] = true;
        returned = true;
      }
    }
    const missing: string[] = [];
    if (!(afterFees > 0)) missing.push("after fees");
    if (!(spots >= 0) || spots === null || spots === undefined) missing.push("spots sold");
    if (!(hours > 0)) missing.push("hours on the timeclock");
    if (!returned) missing.push("unsold items returned");
    if (missing.length) {
      return NextResponse.json({ error: "cannot mark complete - still needed: " + missing.join(", ") }, { status: 400 });
    }
  }
  if (b.status !== undefined) fields["Status"] = b.status;
  if (b.notes !== undefined) fields["Notes"] = b.notes;
  if (b.checklist !== undefined) fields["Checklist"] = b.checklist === null ? "" : JSON.stringify(b.checklist);
  // reinstate a soft-deleted stream within the grace window (admin only)
  if (b.restoreDeleted === true) {
    if (!me.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    fields["Deleted At"] = null;
  }
  await atUpdate(T.streams, params.id, fields);
  return NextResponse.json({ ok: true });
}

// Soft delete: the stream disappears from every list and pay calculation
// immediately, but sits in a 72 hour grace period where an admin can
// reinstate it from the All Streams page before it is purged for good.
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await atUpdate(T.streams, params.id, { "Deleted At": new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
