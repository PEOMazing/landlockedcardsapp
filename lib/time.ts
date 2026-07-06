import { atList, atUpdate, T } from "./airtable";

// "20:00" + "01:30" -> 5.5 hrs (rolls past midnight when end <= start)
export function computeHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

export function entryDateTimes(date: string, start: string, end: string) {
  const startISO = `${date}T${start}:00`;
  let endDate = date;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (eh * 60 + em <= sh * 60 + sm) {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    endDate = d.toISOString().slice(0, 10);
  }
  return { startISO, endISO: `${endDate}T${end}:00` };
}

export function fmt12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")}${ampm}`;
}

// Recompute the stream hour fields from its time entries:
//   Streaming entries -> Hours Streamed
//   Packing entries by the stream manager -> Manager Packing Hours
//   Packing entries by anyone else -> Packing Hours (streamer)
export async function recomputeStreamHours(streamId: string, managerRecId: string | null) {
  const entries = await atList(T.time, {
    filterByFormula: `{Stream Rec Id} = '${streamId}'`,
  });
  let streaming = 0, streamerPacking = 0, managerPacking = 0;
  for (const e of entries) {
    const hrs = e.fields["Hours"] || 0;
    if (e.fields["Type"] === "Streaming") streaming += hrs;
    else if (managerRecId && e.fields["Person Rec Id"] === managerRecId) managerPacking += hrs;
    else streamerPacking += hrs;
  }
  await atUpdate(T.streams, streamId, {
    "Hours Streamed": Math.round(streaming * 100) / 100,
    "Packing Hours": Math.round(streamerPacking * 100) / 100,
    "Manager Packing Hours": Math.round(managerPacking * 100) / 100,
  });
}
