'use strict';

const fs = require('fs');
const path = require('path');

const REGISTRY_CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'config', 'qa-waves-registry.json');

function loadRegistryConfig() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`[journeyRegistry] Falha ao carregar config: ${REGISTRY_CONFIG_PATH} — ${err.message}`);
  }
}

const _cfg = loadRegistryConfig();

// Exportado para compatibilidade com consumidores externos
const STEP_CATALOG = _cfg.stepCatalog;

const JOURNEY_BLUEPRINTS    = _cfg.journeyBlueprints;
const STEP_KEYWORDS         = _cfg.stepKeywords;
const SUBJOURNEY_KEYWORDS   = _cfg.subjourneyKeywords;
const DOMAIN_ALIASES        = _cfg.domainAliases || {};
const DOMAIN_INFERENCE_RULES = _cfg.domainInferenceRules || [];
const JOURNEY_INFERENCE_RULES = _cfg.journeyInferenceRules || [];
const GENERIC_FALLBACK_PREFIXES = _cfg.genericFallbackPrefixes || [];
const GENERIC_FALLBACK_DOMAIN   = _cfg.genericFallbackDomainId || 'core';
const UNMAPPED_DOMAIN           = _cfg.unmappedDomainId || 'unmapped';
const UNMAPPED_JOURNEY          = _cfg.unmappedJourneyId || 'unmapped_journey';
const DEFAULT_STEP_ID           = _cfg.defaultStepId || 'step_03_engagement';

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildSteps() {
  return STEP_CATALOG.map((step) => ({
    id: step.id,
    name: step.name,
    subJourneys: [],
  }));
}

function buildBaseJourneyRegistry() {
  return {
    domains: JOURNEY_BLUEPRINTS.map((domain) => ({
      id: domain.id,
      name: domain.name,
      journeys: domain.journeys.map((journey) => ({
        id: journey.id,
        name: journey.name,
        steps: buildSteps(),
      })),
    })),
  };
}

const FALLBACK_LOG_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.QA_WAVES_LOG_UNMAPPED || '').trim(),
);
const loggedFallbackScenarios = new Set();

function normalizeScenarioId(scenarioId) {
  return String(scenarioId || '').trim();
}

function normalizeDomainId(domainId) {
  const normalized = String(domainId || '').trim().toLowerCase();
  if (!normalized) return null;
  return DOMAIN_ALIASES[normalized] || normalized;
}

function extractScenarioInfo(scenarioInput) {
  if (typeof scenarioInput === 'string') {
    return {
      id: normalizeScenarioId(scenarioInput),
      domain: null,
      flow: '',
      type: '',
    };
  }

  if (!scenarioInput || typeof scenarioInput !== 'object') {
    return {
      id: '',
      domain: null,
      flow: '',
      type: '',
    };
  }

  return {
    id: normalizeScenarioId(scenarioInput.id || scenarioInput.scenarioId),
    domain: normalizeDomainId(scenarioInput.domain),
    flow: String(scenarioInput.flow || scenarioInput.name || ''),
    type: String(scenarioInput.type || ''),
  };
}

function inferDomainMappingFromScenario(scenarioInput) {
  const scenario = extractScenarioInfo(scenarioInput);
  if (scenario.domain) {
    return { domainId: scenario.domain, reason: 'explicit-domain', usedFallback: false };
  }

  const normalized = scenario.id.toLowerCase();
  const flow = scenario.flow.toLowerCase();
  if (!normalized) {
    return { domainId: UNMAPPED_DOMAIN, reason: 'empty-scenario-id', usedFallback: true };
  }

  for (const rule of DOMAIN_INFERENCE_RULES) {
    const prefixMatch = (rule.idPrefixes || []).some((p) => normalized.startsWith(p));
    const idMatch    = (rule.idContains || []).some((k) => normalized.includes(k));
    const flowMatch  = (rule.flowContains || []).some((k) => flow.includes(k));
    if (prefixMatch || idMatch || flowMatch) {
      return { domainId: rule.domainId, reason: rule.reason, usedFallback: false };
    }
  }

  // Fallback genérico para prefixos conhecidos do ecossistema QA/RPA
  if (GENERIC_FALLBACK_PREFIXES.some((p) => normalized.startsWith(p))) {
    return { domainId: GENERIC_FALLBACK_DOMAIN, reason: 'prefix-fallback-core', usedFallback: true };
  }

  return { domainId: UNMAPPED_DOMAIN, reason: 'unmapped-fallback', usedFallback: true };
}

function maybeLogFallbackScenario(scenario, domainResult) {
  if (!FALLBACK_LOG_ENABLED || !domainResult?.usedFallback) return;

  const key = scenario.id || '<empty-scenario-id>';
  if (loggedFallbackScenarios.has(key)) return;
  loggedFallbackScenarios.add(key);

  const payload = {
    scenarioId: scenario.id || null,
    domain: scenario.domain || null,
    flow: scenario.flow || null,
    type: scenario.type || null,
    mappedDomainId: domainResult.domainId,
    fallbackReason: domainResult.reason,
  };

  console.warn('[qa-waves] fallback mapping detected', payload);
}

function inferJourneyId(domainId, scenarioId) {
  const normalized = normalizeScenarioId(scenarioId).toLowerCase();
  const rule = JOURNEY_INFERENCE_RULES.find((r) => r.domainId === domainId);
  if (!rule) return UNMAPPED_JOURNEY;

  for (const sub of (rule.rules || [])) {
    if ((sub.keywords || []).some((k) => normalized.includes(k))) {
      return sub.journeyId;
    }
  }
  return rule.defaultJourneyId || UNMAPPED_JOURNEY;
}

function inferStepId(scenarioId) {
  const normalized = normalizeScenarioId(scenarioId).toLowerCase();
  for (const entry of STEP_KEYWORDS) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword))) {
      return entry.stepId;
    }
  }
  return DEFAULT_STEP_ID;
}

function inferSubJourneyId(scenarioId, stepId) {
  const normalized = normalizeScenarioId(scenarioId).toLowerCase();
  for (const candidate of SUBJOURNEY_KEYWORDS) {
    if (candidate.keywords.some((keyword) => normalized.includes(keyword))) {
      return candidate.id;
    }
  }
  if (stepId === 'step_10_payment') return 'payment_success';
  return `${stepId}_default`;
}

function toNameFromId(id) {
  return String(id || '')
    .split(/[_:\-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function mapScenarioToJourney(scenarioId) {
  const scenario = extractScenarioInfo(scenarioId);
  const normalizedId = scenario.id;
  const domainResult = inferDomainMappingFromScenario(scenarioId);
  const domainId = domainResult.domainId;
  const journeyId = inferJourneyId(domainId, normalizedId);
  const stepId = inferStepId(normalizedId);
  const subJourneyId = inferSubJourneyId(normalizedId, stepId);

  maybeLogFallbackScenario(scenario, domainResult);

  return {
    scenarioId: normalizedId,
    domainId,
    journeyId,
    stepId,
    subJourneyId,
    mapped: domainId !== 'unmapped',
  };
}

function ensureDomain(registry, domainId) {
  let domain = registry.domains.find((item) => item.id === domainId);
  if (domain) return domain;

  domain = { id: domainId, name: toNameFromId(domainId), journeys: [] };
  registry.domains.push(domain);
  return domain;
}

function ensureJourney(domain, journeyId) {
  let journey = domain.journeys.find((item) => item.id === journeyId);
  if (journey) return journey;

  journey = {
    id: journeyId,
    name: toNameFromId(journeyId),
    steps: buildSteps(),
  };
  domain.journeys.push(journey);
  return journey;
}

function ensureStep(journey, stepId) {
  let step = journey.steps.find((item) => item.id === stepId);
  if (step) return step;

  step = {
    id: stepId,
    name: toNameFromId(stepId),
    subJourneys: [],
  };
  journey.steps.push(step);
  return step;
}

function ensureSubJourney(step, subJourneyId) {
  let subJourney = step.subJourneys.find((item) => item.id === subJourneyId);
  if (subJourney) return subJourney;

  subJourney = {
    id: subJourneyId,
    name: toNameFromId(subJourneyId),
    scenarios: [],
  };
  step.subJourneys.push(subJourney);
  return subJourney;
}

function applyScenarioMapping(registry, scenarioId) {
  const mapping = mapScenarioToJourney(scenarioId);
  if (!mapping.scenarioId) return;

  const domain = ensureDomain(registry, mapping.domainId);
  const journey = ensureJourney(domain, mapping.journeyId);
  const step = ensureStep(journey, mapping.stepId);
  const subJourney = ensureSubJourney(step, mapping.subJourneyId);

  if (!subJourney.scenarios.includes(mapping.scenarioId)) {
    subJourney.scenarios.push(mapping.scenarioId);
  }
}

function buildJourneyRegistry({ meshRegistry = [] } = {}) {
  const registry = deepClone(buildBaseJourneyRegistry());

  for (const scenario of meshRegistry) {
    const scenarioId = scenario?.id || scenario?.scenarioId;
    if (!scenarioId) continue;
    applyScenarioMapping(registry, scenario);
  }

  return registry;
}

module.exports = {
  STEP_CATALOG,
  buildJourneyRegistry,
  mapScenarioToJourney,
  loadRegistryConfig,
};
