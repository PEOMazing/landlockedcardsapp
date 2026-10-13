// lib/portal/db.js - Airtable layer for the submission portal tables.
//
// Tables (created 2026-07-29 in the PEOLens base):
//   Submissions, SubmissionDocuments, StatusHistory, EligibilityRules,
//   RiskFlags, SubmissionNotes, AuditEvents
//
// Conventions match the rest of the app: text UserId scoping, ISO timestamps
// in text columns, JSON blobs in multilineText. Every read that returns
// user-facing data filters by UserId server-side; admin reads gate on
// isPortalAdmin() in the route.

import Airtable from 'airtable';

let base;
function getBase() {
  if (base) return base;
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) throw new Error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set');
  base = new Airtable({ apiKey }).base(baseId);
  return base;
}

function esc(v) {
  return String(v || '').replace(/"/g, '\\"');
}

function rec(r) {
  return { id: r.id, ...r.fields };
}

// ---- Submissions ----

// Lean columns for list views; SectionData is only fetched for single reads.
const SUBMISSION_LIST_FIELDS = [
  'CompanyName', 'UserId', 'SubmitterEmail', 'Status', 'EmployeeCount', 'States',
  'Industry', 'NAICS', 'DesiredEffectiveDate', 'RiskLevel', 'EligibilityOutcome',
  'Owner', 'Priority', 'EstimatedValue', 'CreatedAt', 'UpdatedAt', 'SubmittedAt',
];

export async function listSubmissionsForUser(userId) {
  const records = await getBase()('Submissions').select({
    filterByFormula: `{UserId} = "${esc(userId)}"`,
    fields: SUBMISSION_LIST_FIELDS,
    sort: [{ field: 'UpdatedAt', direction: 'desc' }],
    maxRecords: 200,
  }).firstPage();
  return records.map(rec);
}

export async function listAllSubmissions() {
  const out = [];
  await getBase()('Submissions').select({
    fields: SUBMISSION_LIST_FIELDS,
    sort: [{ field: 'UpdatedAt', direction: 'desc' }],
    maxRecords: 1000,
  }).eachPage((records, next) => { out.push(...records.map(rec)); next(); });
  return out;
}

export async function getSubmission(id, { userId = null, admin = false } = {}) {
  try {
    const record = await getBase()('Submissions').find(id);
    const item = rec(record);
    if (!admin && item.UserId !== userId) return null; // org/user isolation
    return item;
  } catch {
    return null;
  }
}

export async function createSubmission({ userId, email }) {
  const now = new Date().toISOString();
  const r = await getBase()('Submissions').create([{
    fields: {
      CompanyName: 'Untitled submission',
      UserId: userId,
      SubmitterEmail: email || '',
      Status: 'Draft',
      SectionData: '{}',
      CreatedAt: now,
      UpdatedAt: now,
    },
  }]);
  return rec(r[0]);
}

export async function updateSubmission(id, fields) {
  const r = await getBase()('Submissions').update([{
    id,
    fields: { ...fields, UpdatedAt: new Date().toISOString() },
  }]);
  return rec(r[0]);
}

// ---- Documents ----

export async function listSubmissionDocuments(submissionId) {
  const records = await getBase()('SubmissionDocuments').select({
    filterByFormula: `{SubmissionId} = "${esc(submissionId)}"`,
    sort: [{ field: 'UploadedAt', direction: 'desc' }],
    maxRecords: 200,
  }).firstPage();
  return records.map(rec);
}

export async function createSubmissionDocument(fields) {
  const r = await getBase()('SubmissionDocuments').create([{
    fields: { ...fields, UploadedAt: new Date().toISOString() },
  }]);
  return rec(r[0]);
}

export async function deleteSubmissionDocument(id) {
  await getBase()('SubmissionDocuments').destroy([id]);
}

export async function getSubmissionDocument(id) {
  try {
    const r = await getBase()('SubmissionDocuments').find(id);
    return rec(r);
  } catch {
    return null;
  }
}

// ---- Status history ----

export async function recordStatusChange({ submissionId, prevStatus, newStatus, changedBy, note }) {
  await getBase()('StatusHistory').create([{
    fields: {
      SubmissionId: submissionId,
      PrevStatus: prevStatus || '',
      NewStatus: newStatus,
      ChangedBy: changedBy || '',
      ChangedAt: new Date().toISOString(),
      Note: note || '',
    },
  }]);
}

export async function listStatusHistory(submissionId) {
  const records = await getBase()('StatusHistory').select({
    filterByFormula: `{SubmissionId} = "${esc(submissionId)}"`,
    sort: [{ field: 'ChangedAt', direction: 'desc' }],
    maxRecords: 100,
  }).firstPage();
  return records.map(rec);
}

// ---- Eligibility rules + risk flags ----

export async function listActiveEligibilityRules() {
  const records = await getBase()('EligibilityRules').select({
    filterByFormula: '{Active} = TRUE()',
    maxRecords: 500,
  }).firstPage();
  return records.map(rec);
}

export async function replaceRiskFlags(submissionId, flags) {
  const table = getBase()('RiskFlags');
  // Delete previous engine-generated flags (keep manual ones) so re-screens
  // don't stack duplicates.
  const existing = await table.select({
    filterByFormula: `AND({SubmissionId} = "${esc(submissionId)}", {Source} != "manual")`,
    maxRecords: 200,
  }).firstPage();
  for (let i = 0; i < existing.length; i += 10) {
    await table.destroy(existing.slice(i, i + 10).map((r) => r.id));
  }
  const now = new Date().toISOString();
  for (let i = 0; i < flags.length; i += 10) {
    await table.create(flags.slice(i, i + 10).map((f) => ({
      fields: {
        SubmissionId: submissionId,
        Level: f.level,
        Reason: f.reason,
        Evidence: f.evidence || '',
        Source: f.source || 'rule',
        RuleId: f.ruleId || '',
        Confidence: typeof f.confidence === 'number' ? f.confidence : null,
        ManualReviewRequired: !!f.manualReviewRequired,
        CreatedAt: now,
      },
    })));
  }
}

export async function listRiskFlags(submissionId) {
  const records = await getBase()('RiskFlags').select({
    filterByFormula: `{SubmissionId} = "${esc(submissionId)}"`,
    sort: [{ field: 'CreatedAt', direction: 'desc' }],
    maxRecords: 100,
  }).firstPage();
  return records.map(rec);
}

// ---- Notes ----

export async function listNotes(submissionId, { includeInternal = false } = {}) {
  const formula = includeInternal
    ? `{SubmissionId} = "${esc(submissionId)}"`
    : `AND({SubmissionId} = "${esc(submissionId)}", {Internal} != TRUE())`;
  const records = await getBase()('SubmissionNotes').select({
    filterByFormula: formula,
    sort: [{ field: 'CreatedAt', direction: 'desc' }],
    maxRecords: 200,
  }).firstPage();
  return records.map(rec);
}

export async function createNote({ submissionId, authorEmail, body, internal }) {
  const r = await getBase()('SubmissionNotes').create([{
    fields: {
      SubmissionId: submissionId,
      AuthorEmail: authorEmail || '',
      Body: body,
      Internal: !!internal,
      CreatedAt: new Date().toISOString(),
    },
  }]);
  return rec(r[0]);
}

// ---- Audit ----

// Fire-and-forget: audit writes must never fail a user action.
export async function audit(action, { submissionId = '', actor = '', detail = '' } = {}) {
  try {
    await getBase()('AuditEvents').create([{
      fields: {
        Action: action,
        SubmissionId: submissionId,
        Actor: actor,
        Detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
        At: new Date().toISOString(),
      },
    }]);
  } catch (err) {
    console.error('[portal audit] failed:', err.message);
  }
}
