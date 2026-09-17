import { atCreate, atList, atUpdate, T } from "./airtable";

// One row per event. Price alerts come from the refresh pipeline when a
// sealed item jumps more than 3%; stock alerts fire whenever on-hand
// quantities change so someone adjusts the Whatnot listing to match.
// Acknowledging clears the alert for everyone - it is a shared to-do.

export async function recordAlert(type: "price" | "stock" | "rename", title: string, payload: unknown) {
  await atCreate(T.alerts, {
    "Title": title.slice(0, 120),
    "Type": type,
    "Payload": JSON.stringify(payload).slice(0, 90000),
    "Created": new Date().toISOString().slice(0, 10),
  });
}

// Raise an alert at most once a day for a given key.
//
// Anything checked on a short loop needs this. The rolling reprice runs 96
// times a day, so a condition-pricing outage without deduping is 96 identical
// alerts, and an alert stream that noisy gets tuned out - taking the next real
// failure with it.
//
// The check has to live in the table, not in a module variable: serverless
// instances are ephemeral and run concurrently, so in-process state dedupes
// nothing. Worst case here is a small race producing two alerts on the same
// day, which is survivable in a way that 96 is not.
export async function recordAlertOnceADay(
  type: "price" | "stock" | "rename",
  key: string,
  title: string,
  payload: unknown
): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const tag = `[${key}]`;
  try {
    const rows = await atList(T.alerts, { filterByFormula: `{Created} = '${today}'` });
    if (rows.some((r) => String(r.fields["Title"] || "").startsWith(tag))) return false;
  } catch {
    // If the lookup fails, alerting is more important than deduping.
  }
  await recordAlert(type, `${tag} ${title}`, payload);
  return true;
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
