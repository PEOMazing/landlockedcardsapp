import { NextResponse } from "next/server";
import { atCreate, atGet, atList, atUpdate, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";
import { recomputeStreamHours } from "@/lib/time";
import { stockAlert } from "@/lib/alerts";

export const dynamic = "force-dynamic";

// The live show state machine:
//   start   - streamer clocks in, stream goes Live
//   end     - clock-out books the streaming hours automatically, stream goes to Review
//   submit  - streamer confirms the hit list, stream goes to Submitted
//   approve - manager re-reviews, items return to inventory, stream goes Complete
//             (approved for payroll - only Complete streams pay)
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const stream = await atGet(T.streams, params.id).catch(() => null);
  if (!stream || !(await ownsStream(me, stream))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const status = stream.fields["Status"] || "Planned";

  if (b.action === "start") {
    if (status !== "Planned" && status !== "Live") return NextResponse.json({ error: `cannot start a ${status} stream` }, { status: 400 });
    if (!stream.fields["Live Started At"]) {
      await atUpdate(T.streams, params.id, { "Live Started At": new Date().toISOString(), "Status": "Live" });
    }
    return NextResponse.json({ ok: true, status: "Live" });
  }

  if (b.action === "end") {
    const startedAt = stream.fields["Live Started At"];
    if (status !== "Live" || !startedAt) return NextResponse.json({ error: "stream is not live" }, { status: 400 });
    const start = new Date(startedAt);
    const end = new Date();
    const hours = Math.max((end.getTime() - start.getTime()) / 3600000, 0.01);
    const streamerId = stream.fields["Streamer Rec Id"] || "";
    let personName = "Streamer";
    try { personName = (await atGet(T.streamers, streamerId)).fields["Name"] || "Streamer"; } catch {}
    const denver = (d: Date) => new Date(d.toLocaleString("en-US", { timeZone: "America/Denver" }));
    const ds = denver(start), de = denver(end);
    const pad = (n: number) => String(n).padStart(2, "0");
    const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const hmOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const day = dayOf(ds);
    await atCreate(T.time, {
      "Entry": `Streaming ${day} (live) - ${personName}`,
      "Stream": [params.id],
      "Stream Rec Id": params.id,
      "Person Rec Id": streamerId,
      "Person Name": personName,
      "Type": "Streaming",
      "Start": `${day}T${hmOf(ds)}:00`,
      "End": `${dayOf(de)}T${hmOf(de)}:00`,
      "Hours": Math.round(hours * 100) / 100,
    });
    await atUpdate(T.streams, params.id, { "Live Started At": null, "Status": "Review" });
    await recomputeStreamHours(params.id, stream.fields["Manager Rec Id"] || null);
    return NextResponse.json({ ok: true, status: "Review", hours: Math.round(hours * 100) / 100 });
  }

  if (b.action === "submit") {
    if (status !== "Review") return NextResponse.json({ error: "stream is not in review" }, { status: 400 });
    await atUpdate(T.streams, params.id, { "Status": "Submitted" });
    return NextResponse.json({ ok: true, status: "Submitted" });
  }

  if (b.action === "approve") {
    if (!me.isManager && !me.isAdmin) return NextResponse.json({ error: "only managers approve streams" }, { status: 403 });
    if (status !== "Submitted") return NextResponse.json({ error: "stream is not submitted" }, { status: 400 });
    const afterFees = stream.fields["After Fees"];
    const hours = stream.fields["Hours Streamed"] || 0;
    const missing: string[] = [];
    if (!(afterFees > 0)) missing.push("after fees");
    if (!(hours > 0)) missing.push("hours");
    if (missing.length) return NextResponse.json({ error: "cannot approve - still needed: " + missing.join(", ") }, { status: 400 });

    // return unhit items to inventory, then the stream is approved for payroll
    let itemsReturned = 0;
    const changes: { name: string; qtyNow: number; delta: number }[] = [];
    if (!stream.fields["Items Returned"]) {
      const lines = await atList(T.lines, { filterByFormula: `{Stream Rec Id} = '${params.id}'` });
      for (const l of lines) {
        const back = Math.max((l.fields["Qty"] || 0) - (l.fields["Qty Hit"] || 0), 0);
        const productId = l.fields["Product"]?.[0];
        if (back > 0 && productId) {
          const product = await atGet(T.inventory, productId);
          await atUpdate(T.inventory, productId, { "Qty On Hand": (product.fields["Qty On Hand"] ?? 0) + back });
          changes.push({ name: product.fields["Product Name"], qtyNow: (product.fields["Qty On Hand"] ?? 0) + back, delta: back });
          itemsReturned += back;
        }
      }
      await stockAlert(changes, "stream approved - relist returns on Whatnot").catch(() => {});
    }
    await atUpdate(T.streams, params.id, { "Status": "Complete", "Items Returned": true });
    return NextResponse.json({ ok: true, status: "Complete", itemsReturned });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
