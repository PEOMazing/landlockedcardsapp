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
  alerts: "Alerts",
  snapshots: "Price History",
  priceLog: "Single Price Log",
  purchases: "Purchase Log",
  customSets: "Custom Sets",
  payrollPaid: "Payroll Payments",
};

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

export type AtRecord = { id: string; fields: Record<string, any> };

// ---------------- rate limits ----------------
//
// rl-v1. Airtable allows 5 requests per second per base and answers the sixth
// with 429. Nothing here used to notice: every helper threw on any non-ok
// response, so one busy second turned into a thrown error somewhere up the
// stack and whatever the user was doing half-finished.
//
// Deleting lines off a show set is where this bit hardest. One line removal is
// about six calls - read the line, read the stream, read the product, write
// the product, write a log row, delete the line - so three deletions in a
// second is already over the limit. Some of the deletes failed, the page's own
// reload got a 429 too, and the editor reported that as "Stream not found",
// which looks exactly like a crash and tells you nothing true.
//
// So retry here, where the status code still exists, rather than guessing at
// it in a dozen callers. 429 and 5xx get backed off and tried again; a 404 or
// a 422 is a real answer and comes straight back.
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_TRIES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Airtable sends Retry-After on a 429. Honour it when it is there and sane,
// and otherwise back off 0.5s, 1s, 2s, 4s with jitter, so two requests that
// collide do not keep colliding.
export function retryDelayMs(attempt: number, retryAfter?: string | null): number {
  const header = parseFloat(String(retryAfter || ""));
  if (header > 0 && header <= 30) return header * 1000;
  return Math.round(500 * 2 ** attempt * (0.75 + Math.random() * 0.5));
}

async function atFetch(url: string, init: RequestInit, what: string): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const res = await fetch(url, init);
    if (res.ok || !RETRY_STATUS.has(res.status)) return res;
    last = res;
    if (attempt === MAX_TRIES - 1) break;
    await sleep(retryDelayMs(attempt, res.headers.get("retry-after")));
  }
  // Out of tries. Say which limit was hit, because "Airtable 429" read as a
  // missing record for long enough to cost a day.
  const body = await last!.text().catch(() => "");
  throw new Error(
    last!.status === 429
      ? `Airtable ${what}: rate limited after ${MAX_TRIES} tries - too many requests in one go`
      : `Airtable ${what}: ${last!.status} ${body}`,
  );
}

// A param given as an array is sent once per value, which is how Airtable takes
// fields[]: asking for only the columns a page needs keeps the response small.
export async function atList(table: string, params: Record<string, string | string[]> = {}): Promise<AtRecord[]> {
  const out: AtRecord[] = [];
  let offset: string | undefined;
  do {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
      else q.append(k, v);
    }
    if (offset) q.append("offset", offset);
    const res = await atFetch(`${API}/${encodeURIComponent(table)}?${q}`, { headers, cache: "no-store" }, `list ${table}`);
    if (!res.ok) throw new Error(`Airtable list ${table}: ${res.status} ${await res.text()}`);
    const data = await res.json();
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

export async function atGet(table: string, id: string): Promise<AtRecord> {
  const res = await atFetch(`${API}/${encodeURIComponent(table)}/${id}`, { headers, cache: "no-store" }, `get ${table}/${id}`);
  if (!res.ok) throw new Error(`Airtable get ${table}/${id}: ${res.status}`);
  return res.json();
}

// rl-v1. "Is this record gone?" and "did that request fail?" are different
// questions and used to come back as the same thrown error, so a rate-limited
// read of a stream was reported to the user as a stream that does not exist.
// Null means Airtable answered and the record is not there. A throw means we
// never got an answer worth trusting.
export async function atGetOrNull(table: string, id: string): Promise<AtRecord | null> {
  const res = await atFetch(`${API}/${encodeURIComponent(table)}/${id}`, { headers, cache: "no-store" }, `get ${table}/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Airtable get ${table}/${id}: ${res.status}`);
  return res.json();
}

export async function atCreate(table: string, fields: Record<string, any>): Promise<AtRecord> {
  const res = await atFetch(`${API}/${encodeURIComponent(table)}`, {
    method: "POST", headers, body: JSON.stringify({ fields, typecast: true }),
  }, `create ${table}`);
  if (!res.ok) throw new Error(`Airtable create ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

// create up to 10 records per request (Airtable's batch limit), chunked
export async function atCreateBatch(table: string, fieldsList: Record<string, any>[]): Promise<AtRecord[]> {
  const out: AtRecord[] = [];
  for (let i = 0; i < fieldsList.length; i += 10) {
    const chunk = fieldsList.slice(i, i + 10);
    const res = await atFetch(`${API}/${encodeURIComponent(table)}`, {
      method: "POST", headers,
      body: JSON.stringify({ records: chunk.map((fields) => ({ fields })), typecast: true }),
    }, `batch create ${table}`);
    if (!res.ok) throw new Error(`Airtable batch create ${table}: ${res.status} ${await res.text()}`);
    out.push(...(await res.json()).records);
  }
  return out;
}

export async function atUpdate(table: string, id: string, fields: Record<string, any>): Promise<AtRecord> {
  const res = await atFetch(`${API}/${encodeURIComponent(table)}/${id}`, {
    method: "PATCH", headers, body: JSON.stringify({ fields, typecast: true }),
  }, `update ${table}/${id}`);
  if (!res.ok) throw new Error(`Airtable update ${table}/${id}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function atDelete(table: string, id: string): Promise<void> {
  const res = await atFetch(`${API}/${encodeURIComponent(table)}/${id}`, { method: "DELETE", headers }, `delete ${table}/${id}`);
  if (!res.ok) throw new Error(`Airtable delete ${table}/${id}: ${res.status}`);
}

// delete up to 10 records per request (Airtable's batch limit), chunked.
// Returns the ids Airtable confirmed as deleted.
export async function atDeleteBatch(table: string, ids: string[]): Promise<string[]> {
  const done: string[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const q = new URLSearchParams();
    for (const id of chunk) q.append("records[]", id);
    const res = await atFetch(`${API}/${encodeURIComponent(table)}?${q}`, { method: "DELETE", headers }, `batch delete ${table}`);
    if (!res.ok) throw new Error(`Airtable batch delete ${table}: ${res.status} ${await res.text()}`);
    const data = await res.json();
    for (const r of data.records || []) if (r.deleted) done.push(r.id);
  }
  return done;
}

// Airtable record ids are rec + 14 alphanumerics. Validate before embedding
// user-supplied ids into filterByFormula strings.
export function isRecId(id: string): boolean {
  return /^rec[A-Za-z0-9]{14,17}$/.test(id);
}
