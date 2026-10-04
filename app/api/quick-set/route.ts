import { NextResponse } from "next/server";
import { atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { isRawCondition } from "@/lib/comp";
import { generateQuickSet, pullList, type Candidate } from "@/lib/quickSet";

export const dynamic = "force-dynamic";
// Four table reads and a fill. Comfortably inside this, but the default is not
// generous enough to bet a 1,100 unit shelf on.
export const maxDuration = 60;

// Propose a show set from what is actually on the shelf, and say what to pull.
//
// Read only on purpose. It takes nothing off the shelf and writes nothing: the
// answer is a list, and claiming the stock stays a separate, deliberate step.
// Generating a set should be something you can do ten times in a row while you
// decide, without leaving ten half-built shows behind you.
export async function GET(req: Request) {
  const me = await getMe();
  if (!me?.isManager && !me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const askedSpots = Number(url.searchParams.get("spots") || 0);
  const seed = Number(url.searchParams.get("seed") || Date.now() % 100000);
  const cooldownShows = Math.max(0, Number(url.searchParams.get("cooldown") || 3));

  const [singleRows, invRows, streamRows] = await Promise.all([
    atList(T.singles, {
      filterByFormula: "AND({Owner Rec Id} = '', {Status} = 'In Stock')",
      "fields[]": ["Card Name", "Set Name", "Card Number", "Condition", "Comp", "Qty", "Slot", "Status"],
    }),
    atList(T.inventory, {
      filterByFormula: "AND({Active} = TRUE(), {Qty On Hand} > 0)",
      "fields[]": ["Product Name", "Category", "Market Price", "Qty On Hand"],
    }),
    atList(T.streams, {
      filterByFormula: "{Deleted At} = BLANK()",
      "fields[]": ["Stream Date", "Spots Sold"],
      "sort[0][field]": "Stream Date",
      "sort[0][direction]": "desc",
    }),
  ]);

  // How many spots a normal show runs, taken from what has actually sold
  // rather than from a number somebody typed once. Median, so one 303 spot
  // monster does not drag the default up.
  const sold = streamRows
    .map((s) => Number(s.fields["Spots Sold"] || 0))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const medianSpots = sold.length ? sold[Math.floor(sold.length / 2)] : 110;
  const spots = askedSpots > 0 ? askedSpots : medianSpots;

  // What has been on a set lately, so the same cards do not go up every week
  // in front of the same regulars.
  const recent = streamRows.slice(0, cooldownShows).map((s) => s.id);
  const agoByStream = new Map(recent.map((id, i) => [id, i]));
  const recentLines = recent.length
    ? await atList(T.lines, {
        filterByFormula: `OR(${recent.map((id) => `{Stream Rec Id} = '${id}'`).join(", ")})`,
        "fields[]": ["Single Rec Id", "Product", "Stream Rec Id"],
      }).catch(() => [] as any[])
    : [];
  const usedAgo = new Map<string, number>();
  for (const l of recentLines) {
    const ago = agoByStream.get(String(l.fields["Stream Rec Id"] || "")) ?? 99;
    for (const key of [String(l.fields["Single Rec Id"] || ""), String(l.fields["Product"]?.[0] || "")]) {
      if (!key) continue;
      usedAgo.set(key, Math.min(usedAgo.get(key) ?? 99, ago));
    }
  }

  // Slabs are not wheel stock. Every graded card in this inventory is $50 or
  // more and the big ones average around $900, against a set that carries
  // roughly $700 in total, so one of them IS the show. They come back in the
  // response as a separate list to sell rather than spin.
  const slabs: { id: string; name: string; value: number }[] = [];
  const singles: Candidate[] = [];
  for (const r of singleRows) {
    const value = Number(r.fields["Comp"] || 0);
    const qty = Number(r.fields["Qty"] ?? 1);
    if (value <= 0 || qty <= 0) continue;
    const cond = String(r.fields["Condition"] || "NM");
    const slot = r.fields["Slot"] == null ? null : Number(r.fields["Slot"]);
    const label = `${slot ? `[${String(slot).padStart(4, "0")}] ` : ""}${cond} ${r.fields["Card Name"] || ""} ${r.fields["Card Number"] || ""}`.trim();
    if (!isRawCondition(cond)) { slabs.push({ id: r.id, name: label, value }); continue; }
    singles.push({
      id: r.id, kind: "single", name: label, value, available: qty, slot,
      lastUsedShowsAgo: usedAgo.get(r.id),
    });
  }

  const sealed: Candidate[] = invRows
    .filter((r) => String(r.fields["Category"] || "") !== "Graded Card" && Number(r.fields["Market Price"] || 0) > 0)
    .map((r) => ({
      id: r.id, kind: "sealed" as const,
      name: String(r.fields["Product Name"] || ""),
      value: Number(r.fields["Market Price"]),
      available: Number(r.fields["Qty On Hand"] || 0),
      category: String(r.fields["Category"] || ""),
      lastUsedShowsAgo: usedAgo.get(r.id),
    }));

  const set = generateQuickSet([...singles, ...sealed], { spots, seed, cooldownShows });

  return NextResponse.json({
    spots, seed, medianSpots,
    set,
    pull: pullList(set),
    shelf: {
      singles: singles.length,
      sealedProducts: sealed.length,
      sealedUnits: sealed.reduce((a, c) => a + c.available, 0),
    },
    // Worth seeing every time: this is capital sitting still, and it is not
    // sitting still because nobody wants it, it is sitting still because it
    // does not fit on a wheel.
    slabs: slabs.sort((a, b) => b.value - a.value),
    slabValue: Math.round(slabs.reduce((a, s) => a + s.value, 0)),
  });
}
