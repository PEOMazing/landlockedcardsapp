const BASE = process.env.LLC_AIRTABLE_BASE_ID!;
const TOKEN = process.env.LLC_AIRTABLE_TOKEN!;
const API = `https://api.airtable.com/v0/${BASE}`;

export const T = {
  inventory: "Inventory",
  streamers: "Streamers",
  streams: "Streams",
  lines: "Stream Products",
  settings: "Settings",
  time: "Time Entries",
  singles: "Singles",
};

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

export type AtRecord = { id: string; fields: Record<string, any> };

export async function atList(table: string, params: Record<string, string> = {}): Promise<AtRecord[]> {
  const out: AtRecord[] = [];
  let offset: string | undefined;
  do {
    const q = new URLSearchParams({ ...params, ...(offset ? { offset } : {}) });
    const res = await fetch(`${API}/${encodeURIComponent(table)}?${q}`, { headers, cache: "no-store" });
    if (!res.ok) throw new Error(`Airtable list ${table}: ${res.status} ${await res.text()}`);
    const data = await res.json();
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

export async function atGet(table: string, id: string): Promise<AtRecord> {
  const res = await fetch(`${API}/${encodeURIComponent(table)}/${id}`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`Airtable get ${table}/${id}: ${res.status}`);
  return res.json();
}

export async function atCreate(table: string, fields: Record<string, any>): Promise<AtRecord> {
  const res = await fetch(`${API}/${encodeURIComponent(table)}`, {
    method: "POST", headers, body: JSON.stringify({ fields, typecast: true }),
  });
  if (!res.ok) throw new Error(`Airtable create ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

// create up to 10 records per request (Airtable's batch limit), chunked
export async function atCreateBatch(table: string, fieldsList: Record<string, any>[]): Promise<AtRecord[]> {
  const out: AtRecord[] = [];
  for (let i = 0; i < fieldsList.length; i += 10) {
    const chunk = fieldsList.slice(i, i + 10);
    const res = await fetch(`${API}/${encodeURIComponent(table)}`, {
      method: "POST", headers,
      body: JSON.stringify({ records: chunk.map((fields) => ({ fields })), typecast: true }),
    });
    if (!res.ok) throw new Error(`Airtable batch create ${table}: ${res.status} ${await res.text()}`);
    out.push(...(await res.json()).records);
  }
  return out;
}

export async function atUpdate(table: string, id: string, fields: Record<string, any>): Promise<AtRecord> {
  const res = await fetch(`${API}/${encodeURIComponent(table)}/${id}`, {
    method: "PATCH", headers, body: JSON.stringify({ fields, typecast: true }),
  });
  if (!res.ok) throw new Error(`Airtable update ${table}/${id}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function atDelete(table: string, id: string): Promise<void> {
  const res = await fetch(`${API}/${encodeURIComponent(table)}/${id}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Airtable delete ${table}/${id}: ${res.status}`);
}

// Airtable record ids are rec + 14 alphanumerics. Validate before embedding
// user-supplied ids into filterByFormula strings.
export function isRecId(id: string): boolean {
  return /^rec[A-Za-z0-9]{14,17}$/.test(id);
}
