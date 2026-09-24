import { NextResponse } from "next/server";
import { atList, T } from "@/lib/airtable";
import { getMe } from "@/lib/auth";
import { MoverCard, daysAgo, pointsSince, rankMovers } from "@/lib/priceLog";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Windows the page offers. 0 means since the card was added, which needs no log
// at all - Entry Comp has been sitting on every card since the day it arrived,
// so this one works in full from the first minute the feature exists.
const WINDOWS = [7, 30, 90, 0];

export async function GET(req: Request) {
  const me = await getMe();
  if (!me?.isTeam) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const asked = parseInt(new URL(req.url).searchParams.get("days") || "30");
  const days = WINDOWS.includes(asked) ? asked : 30;

  const rows = await atList(T.singles, {
    filterByFormula: "AND(NOT({Status} = 'Sold'), {Owner Rec Id} = BLANK())",
    "fields[]": [
      "Card Name", "Set Name", "Condition", "Comp", "Entry Comp",
      "Date Added", "Image URL", "Card No", "Slot",
    ],
  });
  const cards: MoverCard[] = rows.map((r) => ({
    id: r.id,
    cardNo: Number(r.fields["Card No"]) || 0,
    name: String(r.fields["Card Name"] || ""),
    setName: String(r.fields["Set Name"] || ""),
    condition: String(r.fields["Condition"] || ""),
    image: String(r.fields["Image URL"] || ""),
    slot: Number(r.fields["Slot"]) > 0 ? Number(r.fields["Slot"]) : null,
    comp: Number(r.fields["Comp"]) || 0,
    entryComp: Number(r.fields["Entry Comp"]) || 0,
    dateAdded: String(r.fields["Date Added"] || ""),
  }));

  // days 0 leans entirely on Entry Comp, so the log is not read at all. Its
  // cutoff is today rather than the beginning of time: the "did the card even
  // exist yet" guard compares the card's added date against the cutoff, and a
  // cutoff in the distant past says every card is too new to rank, which is the
  // exact opposite of what since-added means.
  const cutoff = days > 0 ? daysAgo(days) : daysAgo(0);
  const points = days > 0 ? await pointsSince(daysAgo(days + 1)) : new Map();
  const movers = rankMovers(cards, points, cutoff);

  const up = movers.filter((m) => m.delta > 0);
  const down = movers.filter((m) => m.delta < 0);
  const net = Math.round(movers.reduce((a, m) => a + m.delta, 0) * 100) / 100;
  return NextResponse.json({
    days,
    // how much of the collection this window can actually speak to
    ranked: movers.length,
    of: cards.length,
    up: up.length,
    down: down.length,
    net,
    movers,
  });
}
