import { NextResponse } from "next/server";
import { atDelete, atGet, isRecId, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isRecId(params.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const rec = await atGet(T.customSets, params.id).catch(() => null);
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (rec.fields["Owner Rec Id"] !== me.streamer?.id && !me.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  await atDelete(T.customSets, params.id);
  return NextResponse.json({ ok: true });
}
