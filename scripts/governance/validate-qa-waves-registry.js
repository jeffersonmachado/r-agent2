'use strict';

const { failIfNeeded, readJson, writeReport, statusFromIssues } = require('./common');

const issues = [];
const warnings = [];
const registry = readJson('config/qa-waves-registry.json', null);

if (!registry || typeof registry !== 'object') {
  issues.push({ code: 'registry_missing', message: 'config/qa-waves-registry.json is missing or invalid JSON.' });
  const report = { name: 'validate-qa-waves-registry', status: 'FAIL', issues, warnings };
  writeReport('qa-waves-registry-validation-report.json', report);
  failIfNeeded(report);
  return;
}

// ─── Top-level required fields ─────────────────────────────────────────────
const REQUIRED_TOP_FIELDS = [
  'stepCatalog', 'baseJourneyTemplates', 'verticalJourneys', 'defaultStepId',
  'journeyBlueprints', 'domainAliases', 'domainInferenceRules',
  'genericFallbackPrefixes', 'genericFallbackDomainId', 'unmappedDomainId',
  'unmappedJourneyId', 'journeyInferenceRules', 'stepKeywords',
];

for (const field of REQUIRED_TOP_FIELDS) {
  if (registry[field] === undefined || registry[field] === null) {
    issues.push({ code: 'registry_missing_field', field, message: `Missing required field: ${field}` });
  }
}

// ─── stepCatalog ────────────────────────────────────────────────────────────
const stepCatalog = Array.isArray(registry.stepCatalog) ? registry.stepCatalog : [];
const stepIds = new Set();
for (const step of stepCatalog) {
  if (!step.id || !step.name) {
    issues.push({ code: 'step_catalog_invalid_entry', entry: step, message: 'stepCatalog entry missing id or name.' });
  } else if (stepIds.has(step.id)) {
    issues.push({ code: 'step_catalog_duplicate_id', stepId: step.id, message: `Duplicate stepCatalog id: ${step.id}` });
  } else {
    stepIds.add(step.id);
  }
}
if (stepCatalog.length === 0) {
  issues.push({ code: 'step_catalog_empty', message: 'stepCatalog is empty.' });
}

// ─── baseJourneyTemplates ───────────────────────────────────────────────────
const templates = Array.isArray(registry.baseJourneyTemplates) ? registry.baseJourneyTemplates : [];
const templateIds = new Set();
for (const tpl of templates) {
  if (!tpl.id || !tpl.name) {
    issues.push({ code: 'base_template_invalid', entry: tpl, message: 'baseJourneyTemplates entry missing id or name.' });
  } else {
    templateIds.add(tpl.id);
  }
  if (!Array.isArray(tpl.steps) || tpl.steps.length === 0) {
    issues.push({ code: 'base_template_no_steps', templateId: tpl.id, message: `baseJourneyTemplate ${tpl.id} has no steps.` });
  }
}

// ─── verticalJourneys ───────────────────────────────────────────────────────
const verticalJourneys = registry.verticalJourneys || {};
const verticalKeys = Object.keys(verticalJourneys);
if (verticalKeys.length === 0) {
  issues.push({ code: 'vertical_journeys_empty', message: 'verticalJourneys is empty.' });
}
const allJourneyIds = new Set();
for (const [vertical, journeys] of Object.entries(verticalJourneys)) {
  if (typeof journeys !== 'object' || journeys === null) {
    issues.push({ code: 'vertical_journeys_invalid', vertical, message: `verticalJourneys.${vertical} is not an object.` });
    continue;
  }
  for (const [journeyId, journey] of Object.entries(journeys)) {
    if (!journey.name) {
      issues.push({ code: 'vertical_journey_missing_name', vertical, journeyId, message: `verticalJourneys.${vertical}.${journeyId} missing name.` });
    }
    if (!Array.isArray(journey.steps) || journey.steps.length === 0) {
      issues.push({ code: 'vertical_journey_no_steps', vertical, journeyId, message: `verticalJourneys.${vertical}.${journeyId} has no steps.` });
    }
    allJourneyIds.add(journeyId);
  }
}

// ─── journeyBlueprints ──────────────────────────────────────────────────────
const blueprints = Array.isArray(registry.journeyBlueprints) ? registry.journeyBlueprints : [];
const blueprintDomainIds = new Set();
for (const bp of blueprints) {
  if (!bp.id || !bp.name) {
    issues.push({ code: 'blueprint_invalid', entry: bp, message: 'journeyBlueprints entry missing id or name.' });
  } else {
    blueprintDomainIds.add(bp.id);
  }
  const bpJourneys = Array.isArray(bp.journeys) ? bp.journeys : [];
  for (const j of bpJourneys) {
    if (!j.id) {
      issues.push({ code: 'blueprint_journey_missing_id', domainId: bp.id, message: `Blueprint ${bp.id} journey missing id.` });
    }
  }
}

// Cross-check: blueprints should reference verticalJourneys or be special
const SPECIAL_DOMAINS = new Set(['pbx', 'core', 'unmapped', 'omnichannel', 'bpmn']);
for (const bp of blueprints) {
  if (!bp.id) continue;
  if (SPECIAL_DOMAINS.has(bp.id)) continue;
  if (!verticalJourneys[bp.id]) {
    warnings.push({ code: 'blueprint_no_vertical_journeys', domainId: bp.id, message: `Blueprint ${bp.id} has no corresponding verticalJourneys entry.` });
  }
  // Check that blueprint journeys reference real journeys
  const domainJourneys = verticalJourneys[bp.id] || {};
  for (const j of (Array.isArray(bp.journeys) ? bp.journeys : [])) {
    if (j.id && !domainJourneys[j.id]) {
      warnings.push({ code: 'blueprint_journey_not_in_vertical', domainId: bp.id, journeyId: j.id, message: `Blueprint ${bp.id} journey ${j.id} has no verticalJourneys definition.` });
    }
  }
}

// ─── domainInferenceRules ───────────────────────────────────────────────────
const domainRules = Array.isArray(registry.domainInferenceRules) ? registry.domainInferenceRules : [];
for (const rule of domainRules) {
  if (!rule.domainId) {
    issues.push({ code: 'inference_rule_missing_domain_id', rule, message: 'domainInferenceRules entry missing domainId.' });
  }
  if (!Array.isArray(rule.idPrefixes)) {
    issues.push({ code: 'inference_rule_missing_prefixes', domainId: rule.domainId, message: `domainInferenceRules.${rule.domainId} missing idPrefixes array.` });
  }
  if (!Array.isArray(rule.idContains)) {
    issues.push({ code: 'inference_rule_missing_id_contains', domainId: rule.domainId, message: `domainInferenceRules.${rule.domainId} missing idContains array.` });
  }
}

// ─── journeyInferenceRules ──────────────────────────────────────────────────
const journeyRules = Array.isArray(registry.journeyInferenceRules) ? registry.journeyInferenceRules : [];
for (const rule of journeyRules) {
  if (!rule.domainId) {
    issues.push({ code: 'journey_inference_missing_domain', rule, message: 'journeyInferenceRules entry missing domainId.' });
  }
  if (!rule.defaultJourneyId) {
    issues.push({ code: 'journey_inference_missing_default', domainId: rule.domainId, message: `journeyInferenceRules.${rule.domainId} missing defaultJourneyId.` });
  }
  if (rule.defaultJourneyId && !allJourneyIds.has(rule.defaultJourneyId)) {
    warnings.push({ code: 'journey_inference_default_not_defined', domainId: rule.domainId, defaultJourneyId: rule.defaultJourneyId, message: `journeyInferenceRules.${rule.domainId} defaultJourneyId ${rule.defaultJourneyId} not found in verticalJourneys.` });
  }
}

// ─── defaultStepId ──────────────────────────────────────────────────────────
if (registry.defaultStepId && !stepIds.has(registry.defaultStepId)) {
  warnings.push({ code: 'default_step_not_in_catalog', defaultStepId: registry.defaultStepId, message: `defaultStepId ${registry.defaultStepId} not found in stepCatalog.` });
}

// ─── domainAliases ──────────────────────────────────────────────────────────
const aliases = registry.domainAliases || {};
for (const [alias, target] of Object.entries(aliases)) {
  if (typeof target !== 'string' || target.length === 0) {
    issues.push({ code: 'alias_invalid_target', alias, target, message: `domainAliases.${alias} has invalid target.` });
  }
}

// ─── stepKeywords ───────────────────────────────────────────────────────────
const stepKeywords = Array.isArray(registry.stepKeywords) ? registry.stepKeywords : [];
for (const kw of stepKeywords) {
  if (!kw.stepId) {
    issues.push({ code: 'step_keywords_missing_step_id', entry: kw, message: 'stepKeywords entry missing stepId.' });
  } else if (!stepIds.has(kw.stepId)) {
    warnings.push({ code: 'step_keywords_unknown_step', stepId: kw.stepId, message: `stepKeywords references unknown stepId: ${kw.stepId}` });
  }
  if (!Array.isArray(kw.keywords) || kw.keywords.length === 0) {
    issues.push({ code: 'step_keywords_empty', stepId: kw.stepId, message: `stepKeywords.${kw.stepId} has empty keywords array.` });
  }
}

// ─── generic fields ─────────────────────────────────────────────────────────
for (const field of ['genericFallbackPrefixes']) {
  if (!Array.isArray(registry[field])) {
    issues.push({ code: 'field_not_array', field, message: `${field} must be an array.` });
  }
}

const report = {
  name: 'validate-qa-waves-registry',
  status: statusFromIssues(issues),
  issues,
  warnings,
  summary: {
    stepCatalogCount: stepCatalog.length,
    templateCount: templates.length,
    verticalCount: verticalKeys.length,
    blueprintCount: blueprints.length,
    journeyCount: allJourneyIds.size,
    domainRuleCount: domainRules.length,
    journeyRuleCount: journeyRules.length,
    aliasCount: Object.keys(aliases).length,
  },
  suggestions: issues.concat(warnings).map((entry) => entry.message),
};

writeReport('qa-waves-registry-validation-report.json', report);
failIfNeeded(report);
