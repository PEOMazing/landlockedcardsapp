import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";

// One-time setup for the breaks/singles features. Idempotent: safe to run
// again, it only creates what is missing. Requires the LLC_AIRTABLE_TOKEN to
// have the schema.bases:write scope (add it at airtable.com/create/tokens).
const BASE = process.env.LLC_AIRTABLE_BASE_ID!;
const TOKEN = process.env.LLC_AIRTABLE_TOKEN!;
const META = `https://api.airtable.com/v0/meta/bases/${BASE}/tables`;
const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const text = (name: string) => ({ name, type: "singleLineText" });
const money = (name: string) => ({ name, type: "number", options: { precision: 2 } });
const isoDate = (name: string) => ({ name, type: "date", options: { dateFormat: { name: "iso" } } });
const select = (name: string, choices: string[]) => ({
  name, type: "singleSelect", options: { choices: choices.map((c) => ({ name: c })) },
});

const SINGLES_FIELDS = [
  text("Card Name"), // primary
  text("Set Name"),
  text("Card Number"),
  text("Card ID"),
  text("Rarity"),
  text("Variant"),
  select("Condition", ["Raw", "PSA 10", "PSA 9", "PSA 8", "BGS 9.5", "CGC 9.5", "Other Graded"]),
  money("Comp"),
  text("Comp Source"),
  isoDate("Comp Date"),
  { name: "Image URL", type: "url" },
  { name: "Qty", type: "number", options: { precision: 0 } },
  select("Status", ["In Stock", "In Stream", "Sold"]),
  text("Stream Rec Id"),
  money("Sale Price"),
  { name: "Notes", type: "multilineText" },
  money("Buy Price"),
  text("Added By"),
  isoDate("Date Added"),
];

const STREAMS_NEW_FIELDS = [
  select("Stream Type", ["Surprise Set", "Character Break", "Single Stream"]),
  { name: "Checklist", type: "multilineText" },
];

export async function POST() {
  const me = await getMe();
  if (!me?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const done: string[] = [];

  const listRes = await fetch(META, { headers, cache: "no-store" });
  if (!listRes.ok) {
    return NextResponse.json(
      { error: `could not read base schema (${listRes.status}) - the Airtable token likely needs the schema.bases:write scope` },
      { status: 500 }
    );
  }
  const { tables } = await listRes.json();

  // 1. Singles table
  const singles = tables.find((t: any) => t.name === "Singles");
  if (!singles) {
    const res = await fetch(META, {
      method: "POST", headers,
      body: JSON.stringify({ name: "Singles", fields: SINGLES_FIELDS }),
    });
    if (!res.ok) return NextResponse.json({ error: `creating Singles table failed: ${await res.text()}` }, { status: 500 });
    done.push("created Singles table");
  } else {
    // add any missing fields to an existing table
    const have = new Set(singles.fields.map((f: any) => f.name));
    for (const f of SINGLES_FIELDS) {
      if (have.has(f.name)) continue;
      const res = await fetch(`${META}/${singles.id}/fields`, { method: "POST", headers, body: JSON.stringify(f) });
      if (res.ok) done.push(`added Singles field ${f.name}`);
    }
    if (done.length === 0) done.push("Singles table already set up");
  }

  // 2. Streams table: Stream Type + Checklist
  const streams = tables.find((t: any) => t.name === "Streams");
  if (streams) {
    const have = new Set(streams.fields.map((f: any) => f.name));
    for (const f of STREAMS_NEW_FIELDS) {
      if (have.has(f.name)) continue;
      const res = await fetch(`${META}/${streams.id}/fields`, { method: "POST", headers, body: JSON.stringify(f) });
      if (res.ok) done.push(`added Streams field ${f.name}`);
      else return NextResponse.json({ error: `adding Streams field ${f.name} failed: ${await res.text()}` }, { status: 500 });
    }
  }

  return NextResponse.json({ done });
}
