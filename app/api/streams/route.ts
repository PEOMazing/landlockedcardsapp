import { NextResponse } from "next/server";
import { atList, atCreate, atGet, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params: Record<string, string> = { "sort[0][field]": "Stream Date", "sort[0][direction]": "desc" };
  if (!me.isAdmin) {
    if (!me.streamer) return NextResponse.json({ streams: [] });
    params.filterByFormula = `OR({Streamer Rec Id} = '${me.streamer.id}', {Manager Rec Id} = '${me.streamer.id}')`;
  }
  const rows = await atList(T.streams, params);
  return NextResponse.json({
    streams: rows.map((r) => ({
      id: r.id,
      title: r.fields["Title"],
      date: r.fields["Stream Date"],
      status: r.fields["Status"] || "Planned",
      managed: !!me.streamer && r.fields["Manager Rec Id"] === me.streamer.id,
    })),
  });
}

export async function POST(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json(); // { date, title?, streamerId? }

  let assignedId = me.streamer?.id || null;
  if (b.streamerId && b.streamerId !== me.streamer?.id) {
    if (!me.isManager) return NextResponse.json({ error: "only managers can assign streams" }, { status: 403 });
    assignedId = b.streamerId;
  }
  if (!assignedId) {
    return NextResponse.json({ error: "no streamer profile - ask admin to add you" }, { status: 400 });
  }

  const assigned = await atGet(T.streamers, assignedId);
  const assignedName = assigned.fields["Name"] || "Stream";

  const fields: Record<string, any> = {
    "Title": `${b.date} - ${b.title || assignedName}`,
    "Stream Date": b.date,
    "Status": "Planned",
    "Streamer": [assignedId],
    "Streamer Rec Id": assignedId,
  };
  // creating for someone else as a manager (not admin) records the override relationship
  if (me.streamer && assignedId !== me.streamer.id && !me.isAdmin) {
    fields["Manager"] = [me.streamer.id];
    fields["Manager Rec Id"] = me.streamer.id;
  }
  // admins can also explicitly assign a manager
  if (me.isAdmin && b.managerId) {
    fields["Manager"] = [b.managerId];
    fields["Manager Rec Id"] = b.managerId;
  }
  const rec = await atCreate(T.streams, fields);
  return NextResponse.json({ id: rec.id });
}
