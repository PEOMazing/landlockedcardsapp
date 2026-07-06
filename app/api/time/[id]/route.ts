import { NextResponse } from "next/server";
import { atDelete, atGet, T } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";
import { recomputeStreamHours } from "@/lib/time";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const entry = await atGet(T.time, params.id);
  const streamId = entry.fields["Stream Rec Id"];
  const stream = await atGet(T.streams, streamId);
  if (!ownsStream(me, stream)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await atDelete(T.time, params.id);
  await recomputeStreamHours(streamId, stream.fields["Manager Rec Id"] || null);
  return NextResponse.json({ ok: true });
}
