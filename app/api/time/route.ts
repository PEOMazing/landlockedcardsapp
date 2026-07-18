import { NextResponse } from "next/server";
import { atCreate, atGet, atUpdate, isRecId, T } from "@/lib/airtable";
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
  // managers and admins can log time for someone else - streamers forget to punch
  let personId = me.streamer?.id || "admin";
  let personName = me.streamer?.fields?.["Name"] || "Admin";
  if (b.personId && isRecId(String(b.personId)) && b.personId !== personId) {
    if (!me.isManager && !me.isAdmin) {
      return NextResponse.json({ error: "only managers can log time for someone else" }, { status: 403 });
    }
    try {
      const person = await atGet(T.streamers, b.personId);
      personId = person.id;
      personName = person.fields["Name"] || "Teammate";
    } catch {
      return NextResponse.json({ error: "unknown person" }, { status: 400 });
    }
  }

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
  // packing time for someone who is not the streamer makes them the packaging
  // person when the stream has none - hours then attribute to their pay bucket
  let managerRecId = stream.fields["Manager Rec Id"] || null;
  if (b.type === "Packing" && personId !== (stream.fields["Streamer Rec Id"] || "") && personId !== "admin" && !managerRecId) {
    managerRecId = personId;
    await atUpdate(T.streams, b.streamId, { "Manager Rec Id": personId });
  }
  await recomputeStreamHours(b.streamId, managerRecId);
  return NextResponse.json({ ok: true, hours });
}
