import { atCreate, atList, atUpdate, T } from "./airtable";

// One row per event. Price alerts come from the refresh pipeline when a
// sealed item jumps more than 3%; stock alerts fire whenever on-hand
// quantities change so someone adjusts the Whatnot listing to match.
// Acknowledging clears the alert for everyone - it is a shared to-do.

export async function recordAlert(type: "price" | "stock", title: string, payload: unknown) {
  await atCreate(T.alerts, {
    "Title": title.slice(0, 120),
    "Type": type,
    "Payload": JSON.stringify(payload).slice(0, 90000),
    "Created": new Date().toISOString().slice(0, 10),
  });
}

export async function stockAlert(items: { name: string; qtyNow: number; delta: number }[], source: string) {
  if (items.length === 0) return;
  const title =
    items.length === 1
      ? `Whatnot sync: ${items[0].name} now ${items[0].qtyNow} on hand (${source})`
      : `Whatnot sync: ${items.length} listings changed (${source})`;
  await recordAlert("stock", title, { source, items });
}

export async function openAlerts(days = 3) {
  const rows = await atList(T.alerts, { filterByFormula: "{Acknowledged} != TRUE()" });
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return rows
    .filter((r) => String(r.fields["Created"] || "") >= cutoff)
    .sort((a, b) => String(b.fields["Created"]).localeCompare(String(a.fields["Created"])))
    .map((r) => {
      let payload: any = null;
      try { payload = JSON.parse(r.fields["Payload"] || "null"); } catch {}
      return { id: r.id, type: r.fields["Type"], title: r.fields["Title"], created: r.fields["Created"], payload };
    });
}

export async function acknowledgeAlert(id: string) {
  await atUpdate(T.alerts, id, { "Acknowledged": true });
}
