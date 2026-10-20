import { NextResponse } from "next/server";
import { atList, atCreate, atGet, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { defaultManagerId } from "@/lib/defaultManager";
import { streamTitleError } from "@/lib/streamTitle";

export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params: Record<string, string> = {
    "sort[0][field]": "Stream Date",
    "sort[0][direction]": "desc",
    filterByFormula: "{Deleted At} = BLANK()",
  };
  if (!me.isAdmin && !me.isManager) {
    if (!me.streamer) return NextResponse.json({ streams: [] });
    params.filterByFormula = `AND(OR({Streamer Rec Id} = '${me.streamer.id}', {Manager Rec Id} = '${me.streamer.id}', {Packer Rec Id} = '${me.streamer.id}'), {Deleted At} = BLANK())`;
  }
  const rows = await atList(T.streams, params);
  return NextResponse.json({
    streams: rows.map((r) => ({
      id: r.id,
      title: r.fields["Title"],
      date: r.fields["Stream Date"],
      status: r.fields["Status"] || "Planned",
      streamType: r.fields["Stream Type"] || "Surprise Set",
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

  // st-v2. No date stamp. The date lives in Stream Date, which is what every
  // sort, filter and lookup in the app actually reads.
  const fullTitle = String(b.title || assignedName).trim();
  const titleErr = streamTitleError(fullTitle);
  if (titleErr) return NextResponse.json({ error: titleErr }, { status: 400 });

  const fields: Record<string, any> = {
    "Title": fullTitle,
    "Stream Date": b.date,
    "Status": "Planned",
    "Stream Type": ["Surprise Set", "Character Break", "Single Stream"].includes(b.streamType)
      ? b.streamType
      : "Surprise Set",
    "Streamer": [assignedId],
    "Streamer Rec Id": assignedId,
  };
  // creating for someone else as a manager (not admin) records the override relationship
  if (me.streamer && assignedId !== me.streamer.id && !me.isAdmin) {
    fields["Manager"] = [me.streamer.id];
    fields["Manager Rec Id"] = me.streamer.id;
    fields["Override Rec Id"] = me.streamer.id;
  }
  // admins can also explicitly assign a manager
  if (me.isAdmin && b.managerId) {
    fields["Manager"] = [b.managerId];
    fields["Manager Rec Id"] = b.managerId;
    fields["Override Rec Id"] = b.managerId;
  }
  if (me.isAdmin && b.overrideRecId !== undefined) {
    fields["Override Rec Id"] = b.overrideRecId || "";
  }
  // dm-v1: nobody named a manager, so fall back to whoever is ticked Default
  // Manager on the Streamers table. Shows were being created with no manager
  // of record at all, which left packing hours with nowhere to land and no
  // one holding the show in the admin lists.
  //
  // Deliberately does not set Override Rec Id. The default is the owner, and
  // an owner taking an override on his own profit is a number moving from one
  // of his pockets to the other, which would only add a phantom manager row
  // to payroll. An explicit manager assignment above still sets it.
  if (!fields["Manager Rec Id"]) {
    const fallback = await defaultManagerId();
    if (fallback) {
      fields["Manager"] = [fallback];
      fields["Manager Rec Id"] = fallback;
    }
  }
  // pk-v5: no fee at creation any more, and this time for the right reason.
  //
  // pk-v4 stamped here because the Default Manager landed on every new show and
  // manager meant packer, so a show really did arrive already packed-by. Now
  // that the packer has its own field, a new show has a manager of record and
  // NO packer, which is the truth: nobody has packed it yet. The fee is stamped
  // when somebody is actually tagged, in the PATCH.
  const rec = await atCreate(T.streams, fields);
  return NextResponse.json({ id: rec.id });
}
