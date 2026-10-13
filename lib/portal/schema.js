// lib/portal/schema.js
// Single source of truth for the PEOLens submission portal: wizard sections,
// field definitions, statuses, and document slots. The wizard UI, the API
// validation, and the admin dashboard all render from this file so a field
// added here shows up everywhere.
//
// Answer storage: Submissions.SectionData is a JSON object keyed by section
// id, each value an object keyed by field key. Sections are PATCHed one at a
// time so autosave payloads stay small.

export const RISK_LEVELS = ['eligible', 'potentially_eligible', 'manual_review', 'high_risk', 'prohibited'];

export const RISK_LABELS = {
  eligible: 'Eligible',
  potentially_eligible: 'Potentially eligible',
  manual_review: 'Requires manual review',
  high_risk: 'High risk',
  prohibited: 'Prohibited / not eligible',
};

// Seeded set. Admin-configurable statuses are a phase-two upgrade; every
// status change already writes StatusHistory so the migration is additive.
export const STATUSES = [
  'Draft', 'Submitted', 'Initial Review', 'Missing Information',
  'Research In Progress', 'PEO Market Review', 'Quoting', 'Proposal Received',
  'Proposal Presented', 'Client Reviewing', 'Approved', 'Declined',
  'Not Eligible', 'Placed', 'Lost', 'Archived',
];

export const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

// Field types the wizard knows how to render:
//   text | textarea | number | select | boolean | date | email | phone | states
const YES_NO = ['Yes', 'No', 'Not sure'];

export const SECTIONS = [
  {
    id: 'submitter',
    label: 'Submitter',
    description: 'Who is submitting this company.',
    fields: [
      { key: 'name', label: 'Your name', type: 'text', required: true },
      { key: 'company', label: 'Your company', type: 'text' },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'phone', label: 'Phone', type: 'phone' },
      { key: 'relationship', label: 'Relationship to the prospect', type: 'select', options: ['Broker', 'Advisor / consultant', 'Referral partner', 'I work at this company', 'Internal (PEOLens team)', 'Other'], required: true },
      { key: 'referralPartner', label: 'Broker or referral partner (if any)', type: 'text' },
    ],
  },
  {
    id: 'company',
    label: 'Company',
    description: 'Basics about the company being submitted.',
    fields: [
      { key: 'legalName', label: 'Legal company name', type: 'text', required: true },
      { key: 'dba', label: 'DBA', type: 'text' },
      { key: 'website', label: 'Website', type: 'text' },
      { key: 'linkedin', label: 'LinkedIn company page', type: 'text' },
      { key: 'hqAddress', label: 'Headquarters address', type: 'textarea' },
      { key: 'contactName', label: 'Primary contact', type: 'text', required: true },
      { key: 'contactTitle', label: 'Contact title', type: 'text' },
      { key: 'contactEmail', label: 'Contact email', type: 'email', required: true },
      { key: 'contactPhone', label: 'Contact phone', type: 'phone' },
      { key: 'yearFounded', label: 'Year founded', type: 'number' },
      { key: 'entityType', label: 'Entity type', type: 'select', options: ['LLC', 'S-Corp', 'C-Corp', 'Partnership', 'Sole proprietorship', 'Nonprofit', 'Other'] },
      { key: 'industry', label: 'Industry', type: 'text', required: true },
      { key: 'naics', label: 'NAICS code (if known)', type: 'text' },
      { key: 'description', label: 'What does the company do?', type: 'textarea', required: true,
        hint: 'Plain description of operations. This drives eligibility screening, so specifics help.' },
    ],
  },
  {
    id: 'workforce',
    label: 'Workforce',
    description: 'Employees, locations, and growth.',
    fields: [
      { key: 'totalEmployees', label: 'Total employees', type: 'number', required: true },
      { key: 'fullTime', label: 'Full-time', type: 'number' },
      { key: 'partTime', label: 'Part-time', type: 'number' },
      { key: 'seasonal', label: 'Seasonal', type: 'number' },
      { key: 'contractors', label: 'Independent contractors (1099)', type: 'number' },
      { key: 'states', label: 'States with employees', type: 'states', required: true },
      { key: 'stateBreakdown', label: 'Employee count by state', type: 'textarea', hint: 'e.g. TX 40, CO 12, remote 5' },
      { key: 'remoteEmployees', label: 'Remote employees', type: 'number' },
      { key: 'worksites', label: 'Number of worksite locations', type: 'number' },
      { key: 'unionEmployees', label: 'Union employees?', type: 'select', options: YES_NO },
      { key: 'international', label: 'International employees?', type: 'select', options: YES_NO },
      { key: 'hiringGrowth', label: 'Expected hiring in the next 12 months', type: 'text' },
      { key: 'turnover', label: 'Employee turnover (rough %)', type: 'text' },
      { key: 'avgTenure', label: 'Average employee tenure', type: 'text' },
    ],
  },
  {
    id: 'risk',
    label: 'Operations & risk',
    description: 'Job duties that affect PEO eligibility. Honest answers here save weeks later.',
    fields: [
      { key: 'safetyProgram', label: 'Formal safety program in place?', type: 'select', options: YES_NO },
      { key: 'workAtHeights', label: 'Do any employees regularly work at heights (ladders, roofs, scaffolds)?', type: 'boolean' },
      { key: 'drivingExposure', label: 'Do employees drive as a core part of the job?', type: 'boolean' },
      { key: 'heavyEquipment', label: 'Heavy equipment or machinery operation?', type: 'boolean' },
      { key: 'constructionWork', label: 'Construction or field installation work?', type: 'boolean' },
      { key: 'oilGasWork', label: 'Any oil and gas field operations (drilling, digging, servicing)?', type: 'boolean' },
      { key: 'marineWork', label: 'Barge, marine, or offshore operations?', type: 'boolean' },
      { key: 'underwaterWork', label: 'Underwater or commercial diving work?', type: 'boolean' },
      { key: 'explosivesWork', label: 'Work with explosives?', type: 'boolean' },
      { key: 'hazmatExposure', label: 'Hazardous material exposure?', type: 'boolean' },
      { key: 'licensedProfessionals', label: 'Roles requiring professional licenses?', type: 'select', options: YES_NO },
      { key: 'highRiskDuties', label: 'Any other high-risk job duties worth flagging?', type: 'textarea' },
    ],
  },
  {
    id: 'payroll',
    label: 'Payroll',
    description: 'Current payroll picture.',
    fields: [
      { key: 'annualPayroll', label: 'Estimated annual payroll ($)', type: 'number', required: true },
      { key: 'frequency', label: 'Payroll frequency', type: 'select', options: ['Weekly', 'Bi-weekly', 'Semi-monthly', 'Monthly', 'Mixed'] },
      { key: 'provider', label: 'Current payroll provider', type: 'text' },
      { key: 'entities', label: 'Number of payroll entities (EINs)', type: 'number' },
      { key: 'tipsCommissions', label: 'Tips or commissions?', type: 'select', options: YES_NO },
      { key: 'overtime', label: 'Regular overtime exposure?', type: 'select', options: YES_NO },
      { key: 'seasonalSwings', label: 'Seasonal payroll fluctuations?', type: 'select', options: YES_NO },
      { key: 'multiState', label: 'Multi-state payroll?', type: 'select', options: YES_NO },
      { key: 'challenges', label: 'Current payroll challenges', type: 'textarea' },
    ],
  },
  {
    id: 'workersComp',
    label: 'Workers comp',
    description: 'Current workers compensation program.',
    fields: [
      { key: 'carrier', label: 'Current WC carrier', type: 'text' },
      { key: 'expiration', label: 'Policy expiration date', type: 'date' },
      { key: 'classCodes', label: 'Class codes (comma-separated if known)', type: 'text',
        hint: 'e.g. 8810, 8742, 5551' },
      { key: 'payrollByClass', label: 'Payroll by class code', type: 'textarea' },
      { key: 'emr', label: 'Experience modification rate (EMR)', type: 'text' },
      { key: 'claims', label: 'Claims in the last 3 years', type: 'textarea', hint: 'Count and severity. Loss runs can be uploaded in the Documents step.' },
    ],
  },
  {
    id: 'benefits',
    label: 'Benefits',
    description: 'Current benefits program and enrollment.',
    fields: [
      { key: 'medicalCarrier', label: 'Current medical carrier', type: 'text' },
      { key: 'renewalDate', label: 'Medical renewal date', type: 'date' },
      { key: 'planDesigns', label: 'Current plan designs', type: 'textarea' },
      { key: 'erContribution', label: 'Employer contribution', type: 'text' },
      { key: 'enrolledTotal', label: 'Total enrolled employees', type: 'number' },
      { key: 'enrollmentByTier', label: 'Enrollment by tier', type: 'textarea', hint: 'EE only / EE+Spouse / EE+Children / Family counts' },
      { key: 'ancillary', label: 'Ancillary coverage in place', type: 'textarea', hint: 'Dental, vision, life, disability, HSA, FSA, 401(k), etc.' },
      { key: 'challenges', label: 'Current benefits challenges', type: 'textarea' },
    ],
  },
  {
    id: 'currentArrangement',
    label: 'Current setup',
    description: 'Existing PEO or HR arrangement, if any.',
    fields: [
      { key: 'currentPeo', label: 'Current PEO (if any)', type: 'text' },
      { key: 'currentHr', label: 'Current HR provider or setup', type: 'text' },
      { key: 'currentBroker', label: 'Current benefits broker', type: 'text' },
      { key: 'contractExpiration', label: 'Current contract expiration', type: 'date' },
      { key: 'adminFees', label: 'Current admin fees (if known)', type: 'text' },
      { key: 'reasonForReview', label: 'Why are they reviewing alternatives?', type: 'textarea', required: true },
      { key: 'concerns', label: 'Biggest concerns (service, tech, pricing, benefits, comp)', type: 'textarea' },
      { key: 'desiredArrangement', label: 'Desired future arrangement', type: 'select', options: ['PEO', 'ASO', 'Payroll + broker', 'Not sure, open to recommendation'] },
    ],
  },
  {
    id: 'opportunity',
    label: 'Opportunity',
    description: 'Timeline, goals, and deal context.',
    fields: [
      { key: 'effectiveDate', label: 'Desired effective date', type: 'date', required: true },
      { key: 'timeline', label: 'Decision timeline', type: 'select', options: ['ASAP', '30 days', '60 days', '90 days', 'This year', 'Exploring'] },
      { key: 'otherPeos', label: 'Other PEOs being considered', type: 'text' },
      { key: 'estimatedValue', label: 'Estimated annual contract value ($)', type: 'number' },
      { key: 'probability', label: 'Probability of transition', type: 'select', options: ['High', 'Medium', 'Low', 'Unknown'] },
      { key: 'decisionMakers', label: 'Key decision makers', type: 'text' },
      { key: 'criteria', label: 'Primary decision criteria', type: 'textarea' },
      { key: 'objections', label: 'Known objections', type: 'textarea' },
      { key: 'priority', label: 'Internal priority', type: 'select', options: ['Urgent', 'High', 'Normal', 'Low'] },
      { key: 'notes', label: 'Anything else we should know', type: 'textarea' },
    ],
  },
];

// Documents step (rendered after the sections, before review).
export const DOC_SLOTS = [
  { key: 'census', label: 'Employee census', hint: 'Roster with ages, salaries, dependents. Excel or CSV preferred.' },
  { key: 'benefits_renewal', label: 'Benefits renewal', hint: 'Most recent renewal packet.' },
  { key: 'current_invoice', label: 'Current invoice', hint: 'Latest bill from the current PEO, carrier, or payroll provider.' },
  { key: 'payroll_register', label: 'Payroll register', hint: 'A recent payroll register or summary.' },
  { key: 'wc_policy', label: 'Workers comp policy', hint: 'Current policy or dec page.' },
  { key: 'wc_loss_runs', label: 'Workers comp loss runs', hint: '3 to 5 years if available.' },
  { key: 'emr_worksheet', label: 'Experience mod worksheet', hint: 'If available.' },
  { key: 'peo_agreement', label: 'Current PEO agreement', hint: 'If currently with a PEO.' },
  { key: 'plan_summaries', label: 'Benefits plan summaries', hint: 'SBCs or plan design summaries.' },
  { key: 'handbook', label: 'Employee handbook', hint: 'Optional.' },
  { key: 'other', label: 'Other supporting documents', hint: 'Anything else useful.' },
];

export function getSection(id) {
  return SECTIONS.find((s) => s.id === id) || null;
}

// Completion for one section: { done, total, complete }
export function sectionCompletion(section, answers = {}) {
  const required = section.fields.filter((f) => f.required);
  const done = required.filter((f) => {
    const v = answers[f.key];
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }).length;
  return { done, total: required.length, complete: done >= required.length };
}

export function overallCompletion(sectionData = {}) {
  let done = 0;
  let total = 0;
  for (const s of SECTIONS) {
    const c = sectionCompletion(s, sectionData[s.id] || {});
    done += c.done;
    total += c.total;
  }
  return { done, total, complete: done >= total };
}

// Denormalized columns copied onto the Submission row for fast admin listing.
export function denormalizeForListing(sectionData = {}) {
  const company = sectionData.company || {};
  const workforce = sectionData.workforce || {};
  const opportunity = sectionData.opportunity || {};
  return {
    CompanyName: company.legalName || '',
    EmployeeCount: Number(workforce.totalEmployees) || null,
    States: Array.isArray(workforce.states) ? workforce.states.join(', ') : (workforce.states || ''),
    Industry: company.industry || '',
    NAICS: company.naics || '',
    DesiredEffectiveDate: opportunity.effectiveDate || '',
    Priority: opportunity.priority || '',
    EstimatedValue: Number(opportunity.estimatedValue) || null,
  };
}
