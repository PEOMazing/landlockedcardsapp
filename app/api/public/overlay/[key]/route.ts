import { NextResponse } from "next/server";
import { T, atList } from "@/lib/airtable";
import { boardKinds, boardLayout, boardScale, boardShine, boardSpeed, heatLevel, isShiny, lineKind, onBoard, spinsSinceHit, streamForOverlayKey } from "@/lib/overlay";
import { getSettings } from "@/lib/settings";
import { bigCardImage } from "@/lib/cardImage";

export const dynamic = "force-dynamic";

// What the OBS board is showing right now.
//
// No session on purpose: OBS loads a Browser Source by URL and has nowhere to
// sign in. The key in the path is the credential. See lib/overlay.ts.
//
// Deliberately narrow. It answers with card art, a price and an id, and
// nothing else - no buy prices, no costs, no card ids, no stream financials.
// The page it feeds is pointed at a live audience, so the safest thing it can
// do is not know anything worth leaking.
export async function GET(_req: Request, { params }: { params: { key: string } }) {
  const stream = await streamForOverlayKey(params.key).catch(() => null);
  if (!stream) return NextResponse.json({ error: "not found" }, { status: 404 });

  const lineRows = await atList(T.lines, {
    filterByFormula: `{Stream Rec Id} = '${stream.id}'`,
  }).catch(() => []);

  const kinds = boardKinds(stream);
  const shine = boardShine(stream);
  const spins = spinsSinceHit(stream);
  // One definition of a hit for the whole app: the board shows exactly what the
  // hit stats count, so the two can never tell a viewer different things.
  const settings = await getSettings().catch(() => null);
  const hitThreshold = Number(settings?.hit_threshold) || 0;

  // Card art lives on the Singles record, not the line, so the images have to
  // be fetched. One query for the lot rather than one per card: a 40-card wheel
  // polling every few seconds would otherwise be 800 requests a minute.
  //
  // bd-v2: fetched BEFORE the filter rather than after, because the filter now
  // needs to know a slab from a raw single and the grade only exists on the
  // card. Slightly more rows come back - the ones about to be filtered out -
  // for the same single query, which is the cheap side of the trade.
  const singleIds = lineRows.map((l) => String(l.fields["Single Rec Id"] || "")).filter(Boolean);
  const imageBySingle: Record<string, string> = {};
  const conditionBySingle: Record<string, string> = {};
  const setBySingle: Record<string, string> = {};
  if (singleIds.length) {
    const or = singleIds.map((id) => `RECORD_ID() = '${id}'`).join(", ");
    const singles = await atList(T.singles, { filterByFormula: `OR(${or})` }).catch(() => []);
    for (const s of singles) {
      const url = String(s.fields["Image URL"] || "").trim();
      if (url) imageBySingle[s.id] = url;
      conditionBySingle[s.id] = String(s.fields["Condition"] || "");
      setBySingle[s.id] = String(s.fields["Set Name"] || "").trim();
    }
  }
  const conditionOf = (l: { fields: Record<string, any> }) =>
    conditionBySingle[String(l.fields["Single Rec Id"] || "")] || "";

  const live = lineRows.filter((l) => onBoard(l, kinds, hitThreshold, conditionOf(l)));

  // Sealed lines carry their art on the Inventory product instead.
  const productIds = Array.from(
    new Set(live.map((l) => String(l.fields["Product"]?.[0] || "")).filter(Boolean)),
  );
  const imageByProduct: Record<string, string> = {};
  if (productIds.length) {
    const or = productIds.map((id) => `RECORD_ID() = '${id}'`).join(", ");
    const prods = await atList(T.inventory, { filterByFormula: `OR(${or})` }).catch(() => []);
    for (const p of prods) {
      const url = String(p.fields["Image URL"] || "").trim();
      if (url) imageByProduct[p.id] = url;
    }
  }

  const cards = live
    .map((l) => {
      const singleId = String(l.fields["Single Rec Id"] || "");
      const productId = String(l.fields["Product"]?.[0] || "");
      const image = imageBySingle[singleId] || imageByProduct[productId] || "";
      // bd-v4: every card off the Singles table gets a caption, not just the
      // slabs. A raw card's condition is the same kind of disclosure a grade
      // is, and a viewer deciding whether a card is worth chasing wants it on
      // screen. Sealed lines have no condition to state and stay art only.
      const kind = lineKind(l, conditionOf(l));
      const fromSingles = kind !== "sealed";
      return {
        id: l.id,
        // The big version for the tile, the stored thumbnail as a fallback:
        // this is somebody else's CDN and a missing size must not leave a hole
        // on stream.
        image: bigCardImage(image),
        thumb: image,
        // A line holding three copies is three chances on the board, so it
        // draws three tiles rather than one with a quiet "x3" nobody reads.
        left: Math.max(0, (Number(l.fields["Qty"]) || 0) - (Number(l.fields["Qty Hit"]) || 0)),
        // Not shown on the board - the price tags came off - but it still
        // decides the order, so the best card leads.
        value: Number(l.fields["Market Price Snapshot"]) || 0,
        // Decided here rather than on the page so the threshold stays one
        // number in one place, and the board never has to reason about price.
        shiny: isShiny(Number(l.fields["Market Price Snapshot"]) || 0, shine),
        // bd-v3/v4. The caption: what the card is and where it came from,
        // for everything off the Singles table. Deliberately no price.
        //
        // Whatnot's Surprise Sets Policy: "Sellers also cannot provide or
        // describe the floor, ceiling, or average of the items in their Set."
        // A price on every tile of a scrolling banner does not merely imply
        // the floor, the ceiling and the average of a set - it displays all
        // three, for anyone watching to read off. So the value stays server
        // side, where it only ever decides the running order.
        //
        // The condition and set are the opposite case. The same policy
        // requires a checklist carrying each item's condition, and its own
        // worked example names items as "PSA 10 Charizard". This is
        // disclosure, which is asked for, rather than valuation, which is not.
        cond: fromSingles ? conditionOf(l) : "",
        set: fromSingles ? setBySingle[singleId] || "" : "",
        // Lets the board colour a grade differently from a raw condition
        // without having to parse the string and guess.
        graded: kind === "graded",
      };
    })
    // Art is the whole point; a tile with no picture is a grey hole on stream.
    .filter((c) => c.image)
    .sort((a, b) => b.value - a.value);

  return NextResponse.json(
    {
      title: String(stream.fields["Title"] || ""),
      kinds,
      layout: boardLayout(stream),
      speed: boardSpeed(stream),
      scale: boardScale(stream),
      shine,
      // The dry streak, and the one number the banner's whole escalation hangs
      // off. Sent together so the page never has to work out the rule itself.
      spins,
      heat: heatLevel(spins),
      hitThreshold,
      cards,
      count: cards.reduce((n, c) => n + c.left, 0),
    },
    // The board is polled every few seconds and must never be served from a
    // cache: a hit card that stays up for another minute is the one failure
    // mode viewers will actually notice.
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
