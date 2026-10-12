import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { parseIdentity, readDataUrl } from "@/lib/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Read a card off a photograph.
//
// Only ever answers WHICH CARD. It does not say what printing it is and it
// does not grade it, because neither can be read from a picture reliably and
// both decide money. A Reverse Holofoil and a Normal are the same artwork:
// the foil sits on the card body, not the art window, which is the first
// thing a phone flash washes out. Guessing there is what put a $3 comp on a
// card listing at $19. The scan page asks instead, one tap.
//
// Nothing here writes. Identification is a read, and the pile being scanned
// usually is not ours yet.

// Haiku by default, not Sonnet. Reading three short fields off a photo is
// the easiest thing a vision model does, and the tier costs about 15 cents a
// thousand cards against roughly $4 for Sonnet. It is also cheaper than plain
// OCR: Google Cloud Vision text detection is $1.50 a thousand once the free
// 1,000 a month is gone, and that only returns characters, not a card.
//
// Override with VISION_MODEL if the id moves or a bigger model reads your
// lighting better. A wrong id surfaces as an upstream error on the page
// rather than looking like an unreadable card.
const MODEL = process.env.VISION_MODEL || "claude-haiku-4-5";
const KEY = process.env.ANTHROPIC_API_KEY || "";

const PROMPT = `You are reading one Pokemon trading card from a photograph.

Reply with ONLY this JSON object and nothing else:
{"name":"","setName":"","number":""}

- name: the Pokemon or card name exactly as printed, without the collector
  number. Include a suffix the card prints as part of its name, like "LV.X",
  "ex", "V", "VMAX", "GX".
- setName: the set, if you can tell. Use the set symbol and the copyright
  line. Empty string if you are not sure.
- number: the collector number exactly as printed, usually bottom right, like
  "46/123" or "SVP 170". Empty string if you cannot read it.

Do not guess at the foil, the printing, or the condition. Leave anything you
cannot actually read as an empty string. A blank field is useful; an invented
one is not.`;

export async function POST(req: Request) {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (!KEY) {
    // Not an error. The page stays useful without it - every row can be typed
    // - so this says so plainly instead of failing the request.
    return NextResponse.json({ configured: false, identity: null });
  }

  const b = await req.json().catch(() => ({} as any));
  const img = readDataUrl(b?.image);
  if (!img) return NextResponse.json({ error: "send a jpeg, png or webp data url" }, { status: 400 });
  // ~1.3x for base64. The client downscales to about 1000px, which lands
  // near 100KB; anything much bigger is an un-resized phone original.
  if (img.data.length > 8_000_000) return NextResponse.json({ error: "image too large" }, { status: 413 });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: img.media, data: img.data } },
            { type: "text", text: PROMPT },
          ],
        }],
      }),
    });
    if (!res.ok) {
      // Say what upstream said. A bad model id, an unfunded key and a rate
      // limit all look identical as "could not read it", and the first two
      // are settings problems somebody can fix in a minute if they are told.
      const detail = await res.text().catch(() => "");
      const why = /model/i.test(detail) ? "check VISION_MODEL - that model id was rejected"
        : res.status === 401 ? "the API key was rejected"
        : res.status === 429 ? "rate limited, try again in a moment"
        : `vision ${res.status}`;
      return NextResponse.json({ configured: true, identity: null, error: why });
    }
    const d = await res.json();
    const text = (d?.content || []).map((c: any) => c?.text || "").join("\n");
    // A reply that will not parse is not worth an error page: the row drops
    // to being typed by hand, which was always available anyway.
    return NextResponse.json({ configured: true, identity: parseIdentity(text) });
  } catch {
    return NextResponse.json({ configured: true, identity: null, error: "vision unreachable" });
  }
}
