import { NextResponse } from "next/server";
import { atCreate, atGet, isRecId, T } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";
import { computeHours, entryDateTimes, fmt12, recomputeStreamHours } from "@/lib/time";

// Punch a timeclock entry: { streamId, type: "Streaming"|"Packing", date, start: "HH:MM", end: "HH:MM" }
export async function POST(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json();
  if (!isRecId(String(b.streamId || ""))) return NextResponse.json({ error: "bad stream id" }, { status: 400 });
  const stream = await atGet(T.streams, b.streamId);
  if (!ownsStream(me, stream)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!b.start || !b.end || !b.date || !["Streaming", "Packing"].includes(b.type)) {
    return NextResponse.json({ error: "type, date, start, and end are required" }, { status: 400 });
  }

  const hours = computeHours(b.start, b.end);
  if (hours > 20) return NextResponse.json({ error: "entry is over 20 hours - check the times" }, { status: 400 });
  const { startISO, endISO } = entryDateTimes(b.date, b.start, b.end);
  const personId = me.streamer?.id || "admin";
  const personName = me.streamer?.fields?.["Name"] || "Admin";

  await atCreate(T.time, {
    "Entry": `${b.type} ${b.date} ${fmt12(b.start)}-${fmt12(b.end)} - ${personName}`,
    "Stream": [b.streamId],
    "Stream Rec Id": b.streamId,
    "Person Rec Id": personId,
    "Person Name": personName,
    "Type": b.type,
    "Start": startISO,
    "End": endISO,
    "Hours": hours,
  });
  await recomputeStreamHours(b.streamId, stream.fields["Manager Rec Id"] || null);
  return NextResponse.json({ ok: true, hours });
}
