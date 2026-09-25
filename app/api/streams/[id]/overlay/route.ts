import { NextResponse } from "next/server";
import { T, atGet, atUpdate, isRecId } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";
import { boardKinds, ensureOverlayKey, newOverlayKey } from "@/lib/overlay";

export const dynamic = "force-dynamic";

// The OBS board's URL for this stream.
//
// GET makes the key on first ask and returns the same one after that, so the
// streamer can paste the link into OBS once and leave it, and reports which
// kinds of product the board is showing. POST sets those kinds, or with
// {rotate:true} burns the old key - the fix if a link gets shared somewhere it
// should not have been.
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
  return NextResponse.json({ key, url: urlFor(req, key), kinds: boardKinds(g.stream) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if ("err" in g) return g.err;
  const b = await req.json().catch(() => ({} as any));

  if (b?.rotate) {
    const key = newOverlayKey();
    await atUpdate(T.streams, params.id, { "Overlay Key": key });
    return NextResponse.json({ key, url: urlFor(req, key), kinds: boardKinds(g.stream), rotated: true });
  }

  // Stored inverted - hide rather than show - so a stream nobody has touched
  // includes everything and no backfill was ever needed.
  const fields: Record<string, any> = {};
  if (b?.singles !== undefined) fields["Board Hide Singles"] = !b.singles;
  if (b?.sealed !== undefined) fields["Board Hide Sealed"] = !b.sealed;
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "nothing to do" }, { status: 400 });
  }
  const updated = await atUpdate(T.streams, params.id, fields);
  const key = await ensureOverlayKey(updated);
  return NextResponse.json({ key, url: urlFor(req, key), kinds: boardKinds(updated) });
}
