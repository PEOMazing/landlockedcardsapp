// lib/portal/eligibility.js - deterministic PEO eligibility / risk screening.
//
// Rules live in the EligibilityRules Airtable table (configurable without a
// deploy). Four rule types:
//   naics_prefix — Pattern is a NAICS prefix; matches when the submission's
//                  NAICS code starts with it. Definitive evidence.
//   keyword      — Pattern is a comma-separated keyword list matched against
//                  industry + business description. Keyword matches with
//                  RequiresCorroboration set are DOWNGRADED to manual_review
//                  unless a corroborating signal exists (a job-duty flag or
//                  NAICS match also fired). This implements the "never
//                  classify on a keyword alone" requirement.
//   job_duty     — Pattern is a field key in the risk section answered true.
//   class_code   — Pattern is a WC class code found in workersComp.classCodes.
//
// Output: { level, flags[] } where level is the worst flag level, or
// 'eligible' / 'potentially_eligible' when nothing (or only soft signals)
// fired. prohibited/high_risk always set manualReviewRequired — a human
// confirms every adverse determination before it becomes the outcome.

const LEVEL_RANK = { manual_review: 1, high_risk: 2, prohibited: 3 };

function textCorpus(sectionData) {
  const company = sectionData.company || {};
  const current = sectionData.currentArrangement || {};
  const risk = sectionData.risk || {};
  return [company.industry, company.description, company.legalName, company.dba,
    risk.highRiskDuties, current.reasonForReview]
    .filter(Boolean).join(' \n ').toLowerCase();
}

function matchKeyword(corpus, keywordCsv) {
  const hits = [];
  for (const raw of String(keywordCsv || '').split(',')) {
    const kw = raw.trim().toLowerCase();
    if (!kw) continue;
    if (corpus.includes(kw)) hits.push(kw);
  }
  return hits;
}

export function evaluateEligibility(sectionData, rules) {
  const corpus = textCorpus(sectionData);
  const naics = String(sectionData.company?.naics || '').replace(/[^0-9]/g, '');
  const risk = sectionData.risk || {};
  const classCodes = String(sectionData.workersComp?.classCodes || '')
    .split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean);

  const flags = [];
  let hasHardSignal = false; // NAICS or job-duty or class-code match

  for (const rule of rules) {
    const type = rule.RuleType;
    const pattern = String(rule.Pattern || '').trim();
    if (!type || !pattern) continue;

    if (type === 'naics_prefix' && naics && naics.startsWith(pattern.replace(/[^0-9]/g, ''))) {
      hasHardSignal = true;
      flags.push({
        level: rule.RiskLevel,
        reason: rule.Reason || rule.Name,
        evidence: `NAICS ${naics} matches prefix ${pattern}`,
        source: 'rule',
        ruleId: rule.id,
        confidence: 0.95,
        manualReviewRequired: true,
      });
    }

    if (type === 'job_duty' && risk[pattern] === true) {
      hasHardSignal = true;
      flags.push({
        level: rule.RiskLevel,
        reason: rule.Reason || rule.Name,
        evidence: `Job-duty question "${pattern}" answered yes`,
        source: 'rule',
        ruleId: rule.id,
        confidence: 0.9,
        manualReviewRequired: true,
      });
    }

    if (type === 'class_code' && classCodes.includes(pattern)) {
      hasHardSignal = true;
      flags.push({
        level: rule.RiskLevel,
        reason: rule.Reason || rule.Name,
        evidence: `WC class code ${pattern} listed by submitter`,
        source: 'rule',
        ruleId: rule.id,
        confidence: 0.9,
        manualReviewRequired: true,
      });
    }

    if (type === 'keyword') {
      const hits = matchKeyword(corpus, pattern);
      if (hits.length > 0) {
        flags.push({
          level: rule.RiskLevel,
          reason: rule.Reason || rule.Name,
          evidence: `Matched: ${hits.join(', ')}`,
          source: 'rule',
          ruleId: rule.id,
          confidence: 0.6,
          manualReviewRequired: true,
          _keywordOnly: rule.RequiresCorroboration === true,
        });
      }
    }
  }

  // Downgrade uncorroborated keyword hits to manual_review: a moving company
  // whose description says "no drilling work" must not be auto-prohibited.
  for (const f of flags) {
    if (f._keywordOnly && !hasHardSignal && LEVEL_RANK[f.level] > LEVEL_RANK.manual_review) {
      f.evidence += ' (keyword only, no corroborating NAICS / job-duty / class-code signal — downgraded pending review)';
      f.level = 'manual_review';
      f.confidence = 0.4;
    }
    delete f._keywordOnly;
  }

  let worst = 0;
  for (const f of flags) worst = Math.max(worst, LEVEL_RANK[f.level] || 0);

  let level = 'eligible';
  if (worst === 3) level = 'prohibited';
  else if (worst === 2) level = 'high_risk';
  else if (worst === 1) level = 'manual_review';
  else {
    // Nothing fired. If the description is thin, stay conservative.
    const desc = String(sectionData.company?.description || '');
    level = desc.trim().length >= 40 ? 'eligible' : 'potentially_eligible';
  }

  return { level, flags };
}
