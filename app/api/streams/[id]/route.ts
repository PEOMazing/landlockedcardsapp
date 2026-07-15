import { NextResponse } from "next/server";
import { atGet, atList, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream, canManageStream } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { toLine, isHitLine } from "@/lib/calc";

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
    isComplete ? Promise.resolve([]) : atList(T.lines),
    isComplete ? Promise.resolve([]) : atList(T.streams, { filterByFormula: "AND({Status} = 'Complete', {Deleted At} = BLANK())" }),
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
  const managerId = stream.fields["Manager Rec Id"];
  const streamerRecId = stream.fields["Streamer Rec Id"] || null;
  let streamerRow: any = null;
  if (streamerRecId) {
    try { streamerRow = await atGet(T.streamers, streamerRecId); streamerName = streamerRow.fields["Name"] || ""; } catch {}
  }
  if (managerId) {
    try { managerName = (await atGet(T.streamers, managerId)).fields["Name"] || ""; } catch {}
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
      afterFees: stream.fields["After Fees"] ?? null,
      promotion: stream.fields["Promotion"] ?? null,
      tips: stream.fields["Tips"] ?? null,
      hours: stream.fields["Hours Streamed"] ?? null,
      packingHours: stream.fields["Packing Hours"] ?? null,
      spotsSold: stream.fields["Spots Sold"] ?? null,
      giveaways: stream.fields["Giveaways Run"] ?? null,
      itemsReturned: !!stream.fields["Items Returned"],
      managerPackingHours: stream.fields["Manager Packing Hours"] ?? null,
      managerName,
      streamerName,
      streamerRecId,
      managerRecId: managerId || null,
      notes: stream.fields["Notes"] || "",
      streamType: stream.fields["Stream Type"] || "Surprise Set",
      checklist: (() => {
        try { return stream.fields["Checklist"] ? JSON.parse(stream.fields["Checklist"]) : null; }
        catch { return null; }
      })(),
    },
    lines: lines.map((l, i) => ({
      id: l.id, name: l.name.replace(/^\d+x\s+/, ""), qty: l.qty, qtyHit: l.qtyHit,
      market: l.market, isGiveaway: l.isGiveaway, isHit: isHitLine(l, settings),
      isGraded: categoryByProduct[lineRows[i].fields["Product"]?.[0]] === "Graded Card",
      tcgUrl: tcgByProduct[lineRows[i].fields["Product"]?.[0]] || "",
      image: imageByProduct[lineRows[i].fields["Product"]?.[0]] || "",
      ...(me.isAdmin ? { buy: l.buy } : {}),
    })),
    config: {
      hitThreshold: settings.hit_threshold,
      breakevenMult: settings.breakeven_mult,
      giveawayCost: settings.giveaway_cost,
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
  if (b.afterFees !== undefined) fields["After Fees"] = b.afterFees;
  if (b.promotion !== undefined) fields["Promotion"] = b.promotion;
  if (b.tips !== undefined) fields["Tips"] = b.tips;
  if (b.spotsSold !== undefined) fields["Spots Sold"] = b.spotsSold;
  if (b.giveaways !== undefined) fields["Giveaways Run"] = Math.max(0, parseInt(b.giveaways) || 0);
  // hours come from the timeclock (/api/time), not direct edits
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
