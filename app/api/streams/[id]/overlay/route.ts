import { NextResponse } from "next/server";
import { T, atGet, atUpdate, isRecId } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";
import { ensureOverlayKey, newOverlayKey } from "@/lib/overlay";

export const dynamic = "force-dynamic";

// The OBS board's URL for this stream.
//
// GET makes the key on first ask and returns the same one after that, so the
// streamer can paste the link into OBS once and leave it. POST with
// {rotate:true} burns the old key, which is the fix if a link gets shared
// somewhere it should not have been.
async function guard(id: string) {
  const me = await getMe();
  if (!me?.isTeam) return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  if (!isRecId(id)) return { err: NextResponse.json({ error: "bad id" }, { status: 400 }) };
  const stream = await atGet(T.streams, id).catch(() => null);
  if (!stream || !ownsStream(me, stream)) {
    return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { stream };
}

const urlFor = (req: Request, key: string) => new URL(`/overlay/${key}`, req.url).toString();

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if ("err" in g) return g.err;
  const key = await ensureOverlayKey(g.stream);
  return NextResponse.json({ key, url: urlFor(req, key) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if ("err" in g) return g.err;
  const b = await req.json().catch(() => ({} as any));
  if (!b?.rotate) return NextResponse.json({ error: "nothing to do" }, { status: 400 });
  const key = newOverlayKey();
  await atUpdate(T.streams, params.id, { "Overlay Key": key });
  return NextResponse.json({ key, url: urlFor(req, key), rotated: true });
}
