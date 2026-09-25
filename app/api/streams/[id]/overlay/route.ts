import { NextResponse } from "next/server";
import { T, atGet, atUpdate, isRecId } from "@/lib/airtable";
import { getMe, ownsStream } from "@/lib/auth";
import { BOARD_SHINE_MAX, BOARD_SPEED_MAX, BOARD_SPEED_MIN, boardKinds, boardLayout, boardShine, boardSpeed, ensureOverlayKey, heatLevel, newOverlayKey, spinsSinceHit } from "@/lib/overlay";
import { getSettings } from "@/lib/settings";

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
  // Sent so the control panel counts the same cards the board draws, rather
  // than promising twelve on screen and showing four.
  const settings = await getSettings().catch(() => null);
  return NextResponse.json({
    key,
    url: urlFor(req, key),
    kinds: boardKinds(g.stream),
    layout: boardLayout(g.stream),
    speed: boardSpeed(g.stream),
    shine: boardShine(g.stream),
    spins: spinsSinceHit(g.stream),
    heat: heatLevel(spinsSinceHit(g.stream)),
    hitThreshold: Number(settings?.hit_threshold) || 0,
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await guard(params.id);
  if ("err" in g) return g.err;
  const b = await req.json().catch(() => ({} as any));

  if (b?.rotate) {
    const key = newOverlayKey();
    await atUpdate(T.streams, params.id, { "Overlay Key": key });
    return NextResponse.json({ key, url: urlFor(req, key), kinds: boardKinds(g.stream), layout: boardLayout(g.stream), speed: boardSpeed(g.stream), shine: boardShine(g.stream), rotated: true });
  }

  // Stored inverted - hide rather than show - so a stream nobody has touched
  // includes everything and no backfill was ever needed.
  const fields: Record<string, any> = {};
  if (b?.singles !== undefined) fields["Board Hide Singles"] = !b.singles;
  if (b?.sealed !== undefined) fields["Board Hide Sealed"] = !b.sealed;
  if (b?.layout !== undefined) fields["Board Banner"] = b.layout === "banner";
  if (b?.speed !== undefined) {
    const n = Number(b.speed);
    if (!Number.isFinite(n) || n < BOARD_SPEED_MIN || n > BOARD_SPEED_MAX) {
      return NextResponse.json(
        { error: `speed has to be between ${BOARD_SPEED_MIN} and ${BOARD_SPEED_MAX}` },
        { status: 400 },
      );
    }
    fields["Board Speed"] = Math.round(n * 100) / 100;
  }
  // Zero is a real setting here, not a missing one: it is how the shine gets
  // turned off, so it has to pass the range check rather than read as blank.
  if (b?.shine !== undefined) {
    const n = Number(b.shine);
    if (!Number.isFinite(n) || n < 0 || n > BOARD_SHINE_MAX) {
      return NextResponse.json(
        { error: `shine has to be between 0 and ${BOARD_SHINE_MAX}` },
        { status: 400 },
      );
    }
    fields["Board Shine"] = Math.round(n * 100) / 100;
  }
  // Two ways to move the dry streak. bumpSpins counts off the spin that just
  // happened and is relative, because the streamer may have the live page and
  // the stream page open at once and an absolute write from a stale tab would
  // quietly undo a tally. spins is the absolute set, which is how the reset
  // button gets back to zero.
  if (b?.bumpSpins !== undefined) {
    const by = Math.trunc(Number(b.bumpSpins));
    if (!Number.isFinite(by) || by === 0 || Math.abs(by) > 99) {
      return NextResponse.json({ error: "bumpSpins has to be a small non-zero whole number" }, { status: 400 });
    }
    fields["Spins Since Hit"] = Math.max(0, spinsSinceHit(g.stream) + by);
  } else if (b?.spins !== undefined) {
    const n = Math.trunc(Number(b.spins));
    if (!Number.isFinite(n) || n < 0 || n > 999) {
      return NextResponse.json({ error: "spins has to be between 0 and 999" }, { status: 400 });
    }
    fields["Spins Since Hit"] = n;
  }
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "nothing to do" }, { status: 400 });
  }
  const updated = await atUpdate(T.streams, params.id, fields);
  const key = await ensureOverlayKey(updated);
  return NextResponse.json({ key, url: urlFor(req, key), kinds: boardKinds(updated), layout: boardLayout(updated), speed: boardSpeed(updated), shine: boardShine(updated), spins: spinsSinceHit(updated), heat: heatLevel(spinsSinceHit(updated)) });
}
