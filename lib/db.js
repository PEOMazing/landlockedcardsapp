// lib/db.js - Airtable wrapper for Users, Analyses, Agreements
import Airtable from 'airtable';

let base;
function getBase() {
  if (base) return base;
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    throw new Error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set');
  }
  base = new Airtable({ apiKey }).base(baseId);
  return base;
}

// ============== USERS ==============
export async function findUserByEmail(email) {
  const records = await getBase()('Users').select({
    filterByFormula: `LOWER({Email}) = LOWER("${email.replace(/"/g, '\\"')}")`,
    maxRecords: 1,
  }).firstPage();
  if (records.length === 0) return null;
  return { id: records[0].id, ...records[0].fields };
}

export async function findUserById(userId) {
  try {
    const record = await getBase()('Users').find(userId);
    return { id: record.id, ...record.fields };
  } catch (err) {
    return null;
  }
}

export async function createUser({ email, name, brokerage, phone }) {
  const record = await getBase()('Users').create([{
    fields: {
      Email: email.toLowerCase(),
      Name: name || '',
      Brokerage: brokerage || '',
      Phone: phone || '',
      Status: 'trial',
    }
  }]);
  return { id: record[0].id, ...record[0].fields };
}

export async function updateUserLastLogin(userId) {
  try {
    await getBase()('Users').update([{ id: userId, fields: { LastLogin: new Date().toISOString() } }]);
  } catch (err) {
    console.error('Failed to update last login:', err);
  }
}

// ============== ANALYSES ==============
// v5 additions:
//   RenewalDate (date)               - explicit renewal date (overrides auto-calc from start+12mo)
//   HealthPlanRenewalDate (date)     - separate from contract renewal
//   RenewalNotes (long text)         - private prep notes
//   LastAlertSent (number)           - last threshold (in days) we emailed about

// List views never need the Data blob (the full analysis JSON, often tens or
// hundreds of KB per record). Fetching it for up to 500 records made the
// dashboard/renewals/commissions payloads enormous and slow. Project only the
// display columns; getAnalysis() still returns everything for /app.
const ANALYSIS_LIST_FIELDS = [
  'ClientName', 'Status', 'PEONames',
  'AnnualCost', 'BaselineCost', 'AnnualSavings', 'ThreeYearSavings', 'EmployeeCount',
  'WonPEO', 'WonProduct', 'WonLives', 'MonthlyCommission', 'ThreeYearCommission',
  'EffectiveStartDate', 'RenewalDate', 'HealthPlanRenewalDate', 'RenewalNotes',
  'LastAlertSent', 'Created', 'Updated',
];

export async function listAnalyses(userId, { full = false } = {}) {
  const select = {
    filterByFormula: `FIND("${userId}", ARRAYJOIN({User}))`,
    sort: [{ field: 'Updated', direction: 'desc' }],
    maxRecords: 500,
  };
  if (!full) select.fields = ANALYSIS_LIST_FIELDS;
  const records = await getBase()('Analyses').select(select).firstPage();
  return records.map(r => ({ id: r.id, ...r.fields }));
}

// List ALL Won analyses across all users — used by the cron job for renewal alerts
export async function listAllWonAnalyses() {
  const records = await getBase()('Analyses').select({
    filterByFormula: `{Status} = 'Won'`,
    maxRecords: 5000,
    fields: ANALYSIS_LIST_FIELDS, // renewal alerts never need the Data blob
  }).firstPage();
  return records.map(r => ({ id: r.id, ...r.fields }));
}

export async function getAnalysis(id, userId) {
  const record = await getBase()('Analyses').find(id);
  const linkedUsers = record.fields.User || [];
  if (!linkedUsers.includes(userId)) return null;
  return { id: record.id, ...record.fields };
}

export async function saveAnalysis({ id, userId, clientName, data, status, meta, deal, renewal }) {
  const fields = {
    User: [userId],
    ClientName: clientName || 'Untitled',
    Data: typeof data === 'string' ? data : JSON.stringify(data),
  };
  if (status) fields.Status = status;
  if (meta) {
    if (meta.peoNames !== undefined) fields.PEONames = meta.peoNames;
    if (meta.annualCost !== undefined && !isNaN(meta.annualCost)) fields.AnnualCost = meta.annualCost;
    if (meta.baselineCost !== undefined && !isNaN(meta.baselineCost)) fields.BaselineCost = meta.baselineCost;
    if (meta.annualSavings !== undefined && !isNaN(meta.annualSavings)) fields.AnnualSavings = meta.annualSavings;
    if (meta.threeYearSavings !== undefined && !isNaN(meta.threeYearSavings)) fields.ThreeYearSavings = meta.threeYearSavings;
    if (meta.employeeCount !== undefined && !isNaN(meta.employeeCount)) fields.EmployeeCount = meta.employeeCount;
  }
  if (deal) {
    if (deal.wonPEO !== undefined) fields.WonPEO = deal.wonPEO || '';
    if (deal.wonProduct !== undefined) fields.WonProduct = deal.wonProduct || '';
    if (deal.wonLives !== undefined && !isNaN(deal.wonLives)) fields.WonLives = deal.wonLives;
    if (deal.monthlyCommission !== undefined && !isNaN(deal.monthlyCommission)) fields.MonthlyCommission = deal.monthlyCommission;
    if (deal.threeYearCommission !== undefined && !isNaN(deal.threeYearCommission)) fields.ThreeYearCommission = deal.threeYearCommission;
    if (deal.effectiveStartDate) fields.EffectiveStartDate = deal.effectiveStartDate;
  }
  if (renewal) {
    if (renewal.renewalDate !== undefined) fields.RenewalDate = renewal.renewalDate || null;
    if (renewal.healthPlanRenewalDate !== undefined) fields.HealthPlanRenewalDate = renewal.healthPlanRenewalDate || null;
    if (renewal.renewalNotes !== undefined) fields.RenewalNotes = renewal.renewalNotes || '';
  }
  if (id) {
    const r = await getBase()('Analyses').update([{ id, fields }]);
    return { id: r[0].id, ...r[0].fields };
  } else {
    if (!fields.Status) fields.Status = 'Prospecting';
    const r = await getBase()('Analyses').create([{ fields }]);
    return { id: r[0].id, ...r[0].fields };
  }
}

export async function updateAnalysisStatus(id, userId, status) {
  const existing = await getAnalysis(id, userId);
  if (!existing) return null;
  const r = await getBase()('Analyses').update([{ id, fields: { Status: status } }]);
  return { id: r[0].id, ...r[0].fields };
}

export async function deleteAnalysis(id, userId) {
  const existing = await getAnalysis(id, userId);
  if (!existing) return false;
  await getBase()('Analyses').destroy([id]);
  return true;
}

// Record that we sent a renewal alert at threshold N for this deal
export async function recordAlertSent(id, thresholdDays) {
  try {
    await getBase()('Analyses').update([{ id, fields: { LastAlertSent: thresholdDays } }]);
  } catch (err) {
    console.error('Failed to record alert:', err);
  }
}

// "Shop this renewal" - clone a Won deal into a new Prospecting analysis with prefilled baseline
export async function cloneForRenewal(sourceId, userId) {
  const source = await getAnalysis(sourceId, userId);
  if (!source) return null;

  let sourceData = {};
  try {
    sourceData = typeof source.Data === 'string' ? JSON.parse(source.Data) : (source.Data || {});
  } catch (err) {
    sourceData = {};
  }

  // Pull the baseline (current) quote from the source to use as the new baseline
  const sourceQuotes = sourceData.quotes || [];
  const baseline = sourceQuotes.find(q => q.isCurrent) || sourceQuotes[0];

  // Build new quotes: a baseline (the incumbent — current PEO) + one empty quote slot
  const newQuotes = [];
  if (baseline) {
    const newBaseline = JSON.parse(JSON.stringify(baseline));
    newBaseline.isCurrent = true;
    // Use the incumbent PEO name if known
    if (source.WonPEO) {
      newBaseline.company = newBaseline.company || {};
      newBaseline.company.peoName = source.WonPEO;
    }
    newQuotes.push(newBaseline);
  }
  // Add one empty quote to compare against
  newQuotes.push({
    isCurrent: false,
    company: {}, administrative: {}, workersComp: {}, ancillary: {}, hidden: {},
    plans: [{}], confidence: {},
  });

  const newData = {
    quotes: newQuotes,
    industryPreset: sourceData.industryPreset || 'Standard',
    healthTrend: sourceData.healthTrend ?? 10,
    view: sourceData.view || 'employer',
    empSalary: sourceData.empSalary ?? 75000,
  };

  const fields = {
    User: [userId],
    ClientName: `${source.ClientName} (Renewal)`,
    Data: JSON.stringify(newData),
    Status: 'Prospecting',
    PEONames: source.WonPEO || '',
  };
  if (source.EmployeeCount) fields.EmployeeCount = source.EmployeeCount;

  const r = await getBase()('Analyses').create([{ fields }]);
  return { id: r[0].id, ...r[0].fields };
}

// ============== AGREEMENTS ==============
export async function listAgreements(userId) {
  const records = await getBase()('Agreements').select({
    filterByFormula: `FIND("${userId}", ARRAYJOIN({User}))`,
    sort: [{ field: 'PEOName', direction: 'asc' }],
    maxRecords: 100,
  }).firstPage();
  return records.map(r => ({ id: r.id, ...r.fields }));
}

export async function getAgreement(id, userId) {
  const record = await getBase()('Agreements').find(id);
  const linkedUsers = record.fields.User || [];
  if (!linkedUsers.includes(userId)) return null;
  return { id: record.id, ...record.fields };
}

export async function saveAgreement({ id, userId, peoName, effectiveDate, agreementData, fileName, notes, status }) {
  const fields = {
    User: [userId],
    PEOName: peoName || 'Untitled Agreement',
    AgreementData: typeof agreementData === 'string' ? agreementData : JSON.stringify(agreementData),
  };
  if (effectiveDate) fields.EffectiveDate = effectiveDate;
  if (fileName) fields.FileName = fileName;
  if (notes !== undefined) fields.Notes = notes;
  if (status) fields.Status = status;
  
  if (id) {
    const r = await getBase()('Agreements').update([{ id, fields }]);
    return { id: r[0].id, ...r[0].fields };
  } else {
    if (!fields.Status) fields.Status = 'Active';
    const r = await getBase()('Agreements').create([{ fields }]);
    return { id: r[0].id, ...r[0].fields };
  }
}

export async function deleteAgreement(id, userId) {
  const existing = await getAgreement(id, userId);
  if (!existing) return false;
  await getBase()('Agreements').destroy([id]);
  return true;
}

// ============== DOCUMENTS ==============
// Fields:
//   FileName (single line text, primary)
//   User (link to Users)
//   Analysis (link to Analyses) - which deal this doc belongs to
//   CategoryId (single line text) - e.g. 'summary_of_benefits'
//   CategoryLabel (single line text) - e.g. 'Summary of Benefits (SBC)'
//   Bucket (single select: incumbent, peo_quote, other)
//   PEOName (single line text) - for peo_quote bucket docs, which PEO
//   BlobUrl (URL) - Vercel Blob storage URL
//   FileSize (number)
//   MimeType (single line text)
//   ParsedData (long text - JSON)
//   ParseStatus (single select: pending, ok, failed, stored_only)
//   ParseConfidence (single line text) - high, medium, low
//   ClassificationMethod (single line text) - filename, ai_content, manual
//   ClassificationConfidence (number)
//   Notes (long text)
//   Created (Created time)

export async function listDocuments(userId, analysisId = null) {
  let formula;
  if (analysisId) {
    formula = `AND(FIND("${userId}", ARRAYJOIN({User})), FIND("${analysisId}", ARRAYJOIN({Analysis})))`;
  } else {
    formula = `FIND("${userId}", ARRAYJOIN({User}))`;
  }
  const records = await getBase()('Documents').select({
    filterByFormula: formula,
    sort: [{ field: 'Created', direction: 'desc' }],
    maxRecords: 1000,
  }).firstPage();
  return records.map(r => ({ id: r.id, ...r.fields }));
}

export async function getDocument(id, userId) {
  const record = await getBase()('Documents').find(id);
  const linkedUsers = record.fields.User || [];
  if (!linkedUsers.includes(userId)) return null;
  return { id: record.id, ...record.fields };
}

export async function saveDocument({
  id, userId, analysisId, fileName, categoryId, categoryLabel, bucket, peoName,
  blobUrl, fileSize, mimeType, parsedData, parseStatus, parseConfidence,
  classificationMethod, classificationConfidence, notes
}) {
  // Field names map to the Airtable Documents table schema:
  //   primary  : Title         (we mirror FileName so list views aren't blank)
  //   text     : FileName, MimeType, CategoryId, CategoryLabel, ClassificationMethod
  //   number   : FileSize, Confidence  (Confidence holds the *classification* score)
  //   single   : Category, Bucket, ParseStatus, ParseConfidence
  //   long     : ParsedData, Classification, Notes
  //   url      : BlobUrl
  //   link     : User, Analysis
  // Note: PEOName, BlobPathname, Title-derived fields are intentionally not
  // written here because they're either absent from the schema or auto-managed.
  const fields = {
    Title: fileName || 'Untitled',
    User: [userId],
    FileName: fileName || 'Untitled',
  };
  if (analysisId) fields.Analysis = [analysisId];
  if (categoryId) fields.CategoryId = categoryId;
  if (categoryLabel) fields.CategoryLabel = categoryLabel;
  if (bucket) fields.Bucket = bucket;
  // peoName intentionally omitted — no PEOName column on the Documents table
  // (it lives on QuoteBundles). The PEO is recoverable from the bundle link.
  if (blobUrl) fields.BlobUrl = blobUrl;
  if (fileSize !== undefined && fileSize !== null) fields.FileSize = fileSize;
  if (mimeType) fields.MimeType = mimeType;
  if (parsedData !== undefined && parsedData !== null) {
    fields.ParsedData = typeof parsedData === 'string' ? parsedData : JSON.stringify(parsedData);
  }
  if (parseStatus) fields.ParseStatus = parseStatus;
  if (parseConfidence) fields.ParseConfidence = parseConfidence;
  if (classificationMethod) fields.ClassificationMethod = classificationMethod;
  // Schema uses a single `Confidence` (number) column for the classification
  // score; the parse-side confidence has its own column above.
  if (classificationConfidence !== undefined && classificationConfidence !== null) {
    fields.Confidence = classificationConfidence;
  }
  if (notes) fields.Notes = notes;

  return writeRecordTolerant('Documents', id, fields, ['User', 'FileName']);
}

// Airtable rejects the whole create/update if any single field has either:
//   (a) an unknown name             → UNKNOWN_FIELD_NAME: "X"
//   (b) a single-select value that  → INVALID_MULTIPLE_CHOICE_OPTIONS
//       isn't in the field's predefined option set, when the API token
//       lacks schema-modification permission to add new options
//
// Several tables in this base are partially populated relative to the code's
// expectations, so we retry while peeling off the offending field in each
// case. The `required` list names fields we refuse to drop — if those are
// themselves the problem the error surfaces so the schema gap is loud.
async function writeRecordTolerant(table, id, fields, required = [], attempt = 0) {
  try {
    if (id) {
      const r = await getBase()(table).update([{ id, fields }]);
      return { id: r[0].id, ...r[0].fields };
    } else {
      const r = await getBase()(table).create([{ fields }]);
      return { id: r[0].id, ...r[0].fields };
    }
  } catch (err) {
    if (attempt > 24) throw err;
    const offending = identifyOffendingField(err, fields);
    if (!offending) throw err;
    if (required.includes(offending.name)) throw err;
    const { [offending.name]: _dropped, ...rest } = fields;
    console.warn(`[${table}] dropping "${offending.name}" (${offending.reason}) and retrying.`);
    return writeRecordTolerant(table, id, rest, required, attempt + 1);
  }
}

// Inspect an Airtable error and return the field we should drop from the
// next attempt. Two failure shapes are recognized:
//   - UNKNOWN_FIELD_NAME            → name comes from the error message itself
//   - INVALID_MULTIPLE_CHOICE_OPTIONS → name found by matching the rejected
//                                       value back to a field in the payload
function identifyOffendingField(err, fields) {
  const msg = err?.message || '';
  const code = err?.error || '';

  const unknownMatch = msg.match(/Unknown field name:\s*"([^"]+)"/i);
  if (code === 'UNKNOWN_FIELD_NAME' || unknownMatch) {
    const name = unknownMatch?.[1];
    if (name) return { name, reason: 'field not in schema' };
  }

  // Sample: `Insufficient permissions to create new select option ""ok""`
  // Airtable double-quotes the value, so we strip both single and double
  // surrounding quotes.
  const optionMatch = msg.match(/select option\s+"+([^"]+?)"+/i);
  if (code === 'INVALID_MULTIPLE_CHOICE_OPTIONS' || optionMatch) {
    const value = optionMatch?.[1];
    if (value) {
      // Find which field in our payload has this rejected value.
      const name = Object.keys(fields).find(k => {
        const v = fields[k];
        return v === value || (Array.isArray(v) && v.includes(value));
      });
      if (name) return { name, reason: `select option "${value}" not in field's option set` };
    }
  }

  return null;
}

export async function deleteDocument(id, userId) {
  const existing = await getDocument(id, userId);
  if (!existing) return false;
  await getBase()('Documents').destroy([id]);
  return true;
}

// ============== NORMALIZED QUOTES ==============
// One row per PEO quote after normalization. The Data field stores the full
// NormalizedQuote JSON; the column fields are denormalized for Airtable views.
// Fields:
//   Title (single line text, primary)              - e.g., "Justworks v1 - Acme Corp"
//   User (link to Users)
//   Analysis (link to Analyses)                    - which deal this normalized quote belongs to
//   SourceDocument (link to Documents)             - the parsed quote doc
//   PEOName (single line text)
//   QuoteVersion (single line text)                - e.g., "v1", "v8", "v10"
//   EffectiveDate (date)
//   OntologyVersion (single line text)             - e.g., "1.0.0"
//   ParserVersion (single line text)               - e.g., "justworks-v1.0"
//   BaseAdminAnnualUSD (number, decimal)           - denormalized for sorting/filtering
//   WorkersCompAnnualUSD (number, decimal)
//   WorkersCompMarkupUSD (number, decimal)         - broker-relevant
//   SUTAAnnualUSD (number, decimal)
//   BenefitsAnnualQuotedUSD (number, decimal)
//   BenefitsAnnualHistoricalUSD (number, decimal)
//   TotalAnnualQuotedUSD (number, decimal)         - sum of all annual costs
//   NormalizedData (long text)                     - full JSON blob
//   ValidationStatus (single select: valid, warnings, invalid)
//   ValidationFlags (long text)                    - JSON of warnings/errors
//   Created (Created time), Updated (Last modified)

export async function listNormalizedQuotes(userId, analysisId = null) {
  let formula;
  if (analysisId) {
    formula = `AND(FIND("${userId}", ARRAYJOIN({User})), FIND("${analysisId}", ARRAYJOIN({Analysis})))`;
  } else {
    formula = `FIND("${userId}", ARRAYJOIN({User}))`;
  }
  const records = await getBase()('NormalizedQuotes').select({
    filterByFormula: formula,
    sort: [{ field: 'Updated', direction: 'desc' }],
    maxRecords: 500,
  }).firstPage();
  return records.map(r => ({ id: r.id, ...r.fields }));
}

export async function getNormalizedQuote(id, userId) {
  const record = await getBase()('NormalizedQuotes').find(id);
  const linkedUsers = record.fields.User || [];
  if (!linkedUsers.includes(userId)) return null;
  return { id: record.id, ...record.fields };
}

/**
 * Save a NormalizedQuote. Pass the full normalized JSON in `quote`; this
 * function denormalizes key fields into Airtable columns for sorting/filtering.
 */
export async function saveNormalizedQuote({
  id, userId, analysisId, sourceDocumentId, title, quote,
  validationStatus, validationFlags,
}) {
  const fields = {
    User: [userId],
    Title: title || `${quote?.meta?.peoName || 'Unknown'} - ${quote?.meta?.clientName || 'Untitled'}`,
    NormalizedData: typeof quote === 'string' ? quote : JSON.stringify(quote),
  };
  if (analysisId) fields.Analysis = [analysisId];
  if (sourceDocumentId) fields.SourceDocument = [sourceDocumentId];

  if (quote && typeof quote === 'object') {
    if (quote.meta?.peoName) fields.PEOName = quote.meta.peoName;
    if (quote.meta?.version) fields.QuoteVersion = quote.meta.version;
    if (quote.meta?.effectiveDate) fields.EffectiveDate = quote.meta.effectiveDate;
    if (quote.meta?.ontologyVersion) fields.OntologyVersion = quote.meta.ontologyVersion;
    if (quote.meta?.parserVersion) fields.ParserVersion = quote.meta.parserVersion;

    // Denormalized financial fields (in dollars, not cents)
    const baseAdmin = quote.service?.baseAdmin?.totalAnnual?.cents;
    if (baseAdmin != null) fields.BaseAdminAnnualUSD = baseAdmin / 100;

    const wc = quote.passthroughs?.workersComp?.totalAnnualCost?.cents;
    if (wc != null) fields.WorkersCompAnnualUSD = wc / 100;

    const wcMarkup = quote.passthroughs?.workersComp?.components?.peoMarkup?.cents;
    if (wcMarkup != null) fields.WorkersCompMarkupUSD = wcMarkup / 100;

    const suta = quote.passthroughs?.suta?.totalAnnualCost?.cents;
    if (suta != null) fields.SUTAAnnualUSD = suta / 100;

    const benefitsQuoted = quote.passthroughs?.benefits?.quoted?.annualCost?.cents;
    if (benefitsQuoted != null) fields.BenefitsAnnualQuotedUSD = benefitsQuoted / 100;

    const benefitsHistorical = quote.passthroughs?.benefits?.historical?.annualCost?.cents;
    if (benefitsHistorical != null) fields.BenefitsAnnualHistoricalUSD = benefitsHistorical / 100;

    // Total = sum of all canonical annual costs at quoted scenarios
    const totalAnnual =
      (baseAdmin || 0) +
      (quote.service?.technology?.totalAnnual?.cents || 0) +
      (quote.service?.implementation?.amortizedMonthly?.cents || 0) * 12 +
      (quote.service?.retirement?.totalAnnual?.cents || 0) +
      (wc || 0) +
      (suta || 0) +
      (quote.passthroughs?.futa?.totalAnnualCost?.cents || 0) +
      (quote.passthroughs?.fica?.totalAnnualCost?.cents || 0) +
      (benefitsQuoted || 0);
    fields.TotalAnnualQuotedUSD = totalAnnual / 100;
  }

  if (validationStatus) fields.ValidationStatus = validationStatus;
  if (validationFlags) fields.ValidationFlags = typeof validationFlags === 'string' ? validationFlags : JSON.stringify(validationFlags);

  if (id) {
    const r = await getBase()('NormalizedQuotes').update([{ id, fields }]);
    return { id: r[0].id, ...r[0].fields };
  } else {
    const r = await getBase()('NormalizedQuotes').create([{ fields }]);
    return { id: r[0].id, ...r[0].fields };
  }
}

export async function deleteNormalizedQuote(id, userId) {
  const existing = await getNormalizedQuote(id, userId);
  if (!existing) return false;
  await getBase()('NormalizedQuotes').destroy([id]);
  return true;
}
// ============== QUOTE BUNDLES ==============
// One row per (PEO × client × version) proposal package. Groups multiple
// documents that belong to the same proposal. One bundle → one NormalizedQuote.
// Fields:
//   BundleId (single line text, primary)
//   User (link to Users)
//   Analysis (link to Analyses)
//   PEOName (single line text)
//   ClientName (single line text)
//   Version (single line text)
//   Documents (link to Documents - multiple records)
//   PrimaryDocument (link to Documents - single record)
//   IsCurrentVersion (checkbox)
//   IsBaseline (checkbox)
//   Series (link to QuoteSeries - single record)
//   Status (single select: pending, parsed, failed)
//   NormalizedQuote (link to NormalizedQuotes - single record)
//   BaselineQuote (link to BaselineQuotes - single record)
//   Created (Created time), Updated (Last modified)

export async function listQuoteBundles(userId, analysisId = null) {
  let formula;
  if (analysisId) {
    formula = `AND(FIND("${userId}", ARRAYJOIN({User})), FIND("${analysisId}", ARRAYJOIN({Analysis})))`;
  } else {
    formula = `FIND("${userId}", ARRAYJOIN({User}))`;
  }
  const records = await getBase()('QuoteBundles').select({
    filterByFormula: formula,
    sort: [{ field: 'Updated', direction: 'desc' }],
    maxRecords: 500,
  }).firstPage();
  return records.map(r => ({ id: r.id, ...r.fields }));
}

export async function getQuoteBundle(id, userId) {
  const record = await getBase()('QuoteBundles').find(id);
  const linkedUsers = record.fields.User || [];
  if (!linkedUsers.includes(userId)) return null;
  return { id: record.id, ...record.fields };
}

export async function saveQuoteBundle({
  id, userId, analysisId, bundleId, peoName, clientName, version,
  documentIds, primaryDocumentId, isCurrentVersion, isBaseline, seriesId,
  status, normalizedQuoteId, baselineQuoteId,
}) {
  const fields = {
    User: [userId],
    BundleId: bundleId || `bundle_${Date.now()}`,
  };
  if (analysisId) fields.Analysis = [analysisId];
  if (peoName !== undefined) fields.PEOName = peoName || '';
  if (clientName !== undefined) fields.ClientName = clientName || '';
  if (version !== undefined) fields.Version = version || '';
  if (Array.isArray(documentIds)) fields.Documents = documentIds;
  if (primaryDocumentId) fields.PrimaryDocument = [primaryDocumentId];
  if (isCurrentVersion !== undefined) fields.IsCurrentVersion = !!isCurrentVersion;
  if (isBaseline !== undefined) fields.IsBaseline = !!isBaseline;
  if (seriesId) fields.Series = [seriesId];
  if (status) fields.Status = status;
  if (normalizedQuoteId) fields.NormalizedQuote = [normalizedQuoteId];
  if (baselineQuoteId) fields.BaselineQuote = [baselineQuoteId];

  return writeRecordTolerant('QuoteBundles', id, fields, ['User']);
}

export async function deleteQuoteBundle(id, userId) {
  const existing = await getQuoteBundle(id, userId);
  if (!existing) return false;
  await getBase()('QuoteBundles').destroy([id]);
  return true;
}

// ============== QUOTE SERIES ==============
// One row per (PEO × client) chain of bundles across versions.
// Enables version-to-version diff analysis.
// Fields:
//   SeriesId (single line text, primary)
//   User (link to Users)
//   Analysis (link to Analyses)
//   PEOName (single line text)
//   ClientName (single line text)
//   Bundles (link to QuoteBundles - multiple records, ordered)
//   Created (Created time)

export async function listQuoteSeries(userId, analysisId = null) {
  let formula;
  if (analysisId) {
    formula = `AND(FIND("${userId}", ARRAYJOIN({User})), FIND("${analysisId}", ARRAYJOIN({Analysis})))`;
  } else {
    formula = `FIND("${userId}", ARRAYJOIN({User}))`;
  }
  const records = await getBase()('QuoteSeries').select({
    filterByFormula: formula,
    sort: [{ field: 'Created', direction: 'desc' }],
    maxRecords: 200,
  }).firstPage();
  return records.map(r => ({ id: r.id, ...r.fields }));
}

export async function saveQuoteSeries({
  id, userId, analysisId, seriesId, peoName, clientName, bundleIds,
}) {
  const fields = {
    User: [userId],
    SeriesId: seriesId || `series_${Date.now()}`,
  };
  if (analysisId) fields.Analysis = [analysisId];
  if (peoName !== undefined) fields.PEOName = peoName || '';
  if (clientName !== undefined) fields.ClientName = clientName || '';
  if (Array.isArray(bundleIds)) fields.Bundles = bundleIds;

  if (id) {
    const r = await getBase()('QuoteSeries').update([{ id, fields }]);
    return { id: r[0].id, ...r[0].fields };
  } else {
    const r = await getBase()('QuoteSeries').create([{ fields }]);
    return { id: r[0].id, ...r[0].fields };
  }
}

// ============== BASELINE QUOTES ==============
// One row per client current-state baseline. Drives the "before vs after"
// comparison in proposals.
// Fields:
//   Title (single line text, primary)
//   User (link to Users)
//   Analysis (link to Analyses)
//   SourceDocument (link to Documents)  - the worksheet the baseline came from
//   ClientName (single line text)
//   EstimateDate (date)
//   EstimateSource (single select: peo_worksheet, broker_input, client_provided)
//   TotalDirectCostUSD (number, decimal)
//   MedicalGrossUSD (number, decimal)
//   MedicalNetClientUSD (number, decimal)
//   WorkersCompUSD (number, decimal)
//   PayrollTaxesUSD (number, decimal)
//   EstimatedHRBurdenUSD (number, decimal)
//   BaselineData (long text - JSON blob)
//   ValidationStatus (single select: valid, warnings, invalid)
//   Created (Created time), Updated (Last modified)

export async function listBaselineQuotes(userId, analysisId = null) {
  let formula;
  if (analysisId) {
    formula = `AND(FIND("${userId}", ARRAYJOIN({User})), FIND("${analysisId}", ARRAYJOIN({Analysis})))`;
  } else {
    formula = `FIND("${userId}", ARRAYJOIN({User}))`;
  }
  const records = await getBase()('BaselineQuotes').select({
    filterByFormula: formula,
    sort: [{ field: 'Updated', direction: 'desc' }],
    maxRecords: 200,
  }).firstPage();
  return records.map(r => ({ id: r.id, ...r.fields }));
}

export async function saveBaselineQuote({
  id, userId, analysisId, sourceDocumentId, title, baseline, validationStatus,
}) {
  const fields = {
    User: [userId],
    Title: title || `Baseline - ${baseline?.meta?.clientName || 'Untitled'}`,
    BaselineData: typeof baseline === 'string' ? baseline : JSON.stringify(baseline),
  };
  if (analysisId) fields.Analysis = [analysisId];
  if (sourceDocumentId) fields.SourceDocument = [sourceDocumentId];

  if (baseline && typeof baseline === 'object') {
    if (baseline.meta?.clientName) fields.ClientName = baseline.meta.clientName;
    if (baseline.meta?.estimateDate) fields.EstimateDate = baseline.meta.estimateDate;
    if (baseline.meta?.estimateSource) fields.EstimateSource = baseline.meta.estimateSource;

    const dc = baseline.directCosts;
    if (dc) {
      if (dc.totalDirect?.cents != null) fields.TotalDirectCostUSD = dc.totalDirect.cents / 100;
      if (dc.medical?.grossCost?.cents != null) fields.MedicalGrossUSD = dc.medical.grossCost.cents / 100;
      if (dc.medical?.netClientCost?.cents != null) fields.MedicalNetClientUSD = dc.medical.netClientCost.cents / 100;
      if (dc.workersCompPremium?.cents != null) fields.WorkersCompUSD = dc.workersCompPremium.cents / 100;
      if (dc.employerPayrollTaxes?.cents != null) fields.PayrollTaxesUSD = dc.employerPayrollTaxes.cents / 100;
    }
    if (baseline.estimatedHRBurden?.totalEstimatedBurden?.cents != null) {
      fields.EstimatedHRBurdenUSD = baseline.estimatedHRBurden.totalEstimatedBurden.cents / 100;
    }
  }

  if (validationStatus) fields.ValidationStatus = validationStatus;

  if (id) {
    const r = await getBase()('BaselineQuotes').update([{ id, fields }]);
    return { id: r[0].id, ...r[0].fields };
  } else {
    const r = await getBase()('BaselineQuotes').create([{ fields }]);
    return { id: r[0].id, ...r[0].fields };
  }
}
