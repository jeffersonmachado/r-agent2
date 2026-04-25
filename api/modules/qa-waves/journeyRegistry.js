'use strict';

const STEP_CATALOG = [
  { id: 'step_01_discovery', name: 'Descoberta' },
  { id: 'step_02_attraction', name: 'Atracao' },
  { id: 'step_03_engagement', name: 'Engajamento' },
  { id: 'step_04_qualification', name: 'Qualificacao' },
  { id: 'step_05_lead_capture', name: 'Captura de Lead' },
  { id: 'step_06_conversion', name: 'Conversao' },
  { id: 'step_07_registration', name: 'Cadastro' },
  { id: 'step_08_scheduling', name: 'Agendamento' },
  { id: 'step_09_checkout', name: 'Checkout' },
  { id: 'step_10_payment', name: 'Pagamento' },
  { id: 'step_11_confirmation', name: 'Confirmacao' },
  { id: 'step_12_activation', name: 'Ativacao' },
  { id: 'step_13_delivery', name: 'Entrega' },
  { id: 'step_14_support', name: 'Suporte' },
  { id: 'step_15_retention', name: 'Retencao' },
];

const JOURNEY_BLUEPRINTS = [
  {
    id: 'fitness',
    name: 'Fitness',
    journeys: [
      { id: 'fitness_new_customer', name: 'Cliente Novo' },
      { id: 'fitness_active_customer', name: 'Cliente Ativo' },
    ],
  },
  {
    id: 'beauty',
    name: 'Beauty',
    journeys: [
      { id: 'beauty_new_customer', name: 'Cliente Novo' },
      { id: 'beauty_returning_customer', name: 'Cliente Recorrente' },
    ],
  },
  {
    id: 'pbx',
    name: 'PBX',
    journeys: [
      { id: 'pbx_voice_service', name: 'Servico de Voz' },
      { id: 'pbx_operations', name: 'Operacao PBX' },
    ],
  },
  {
    id: 'core',
    name: 'Core',
    journeys: [
      { id: 'core_customer_journey', name: 'Jornada Core' },
    ],
  },
  {
    id: 'unmapped',
    name: 'Unmapped',
    journeys: [
      { id: 'unmapped_journey', name: 'Nao Mapeado' },
    ],
  },
];

const STEP_KEYWORDS = [
  { stepId: 'step_10_payment', keywords: ['payment', 'pagamento', 'cobranca', 'charge', 'invoice'] },
  { stepId: 'step_08_scheduling', keywords: ['schedule', 'agendamento', 'agenda', 'appointment', 'slot'] },
  { stepId: 'step_05_lead_capture', keywords: ['lead', 'captura'] },
  { stepId: 'step_04_qualification', keywords: ['qualify', 'qualification', 'qualificacao'] },
  { stepId: 'step_02_attraction', keywords: ['campaign', 'campanha', 'ads', 'anuncio', 'acquisition'] },
  { stepId: 'step_06_conversion', keywords: ['conversion', 'convert', 'conversao'] },
  { stepId: 'step_07_registration', keywords: ['register', 'cadastro', 'signup', 'onboarding'] },
  { stepId: 'step_09_checkout', keywords: ['checkout', 'cart', 'carrinho'] },
  { stepId: 'step_11_confirmation', keywords: ['confirm', 'confirmacao'] },
  { stepId: 'step_12_activation', keywords: ['activate', 'ativacao', 'ativar', 'enable'] },
  { stepId: 'step_13_delivery', keywords: ['delivery', 'entrega', 'fulfillment'] },
  { stepId: 'step_14_support', keywords: ['support', 'suporte', 'ticket'] },
  { stepId: 'step_15_retention', keywords: ['renew', 'retention', 'reten', 'churn', 'fidel'] },
  { stepId: 'step_03_engagement', keywords: ['chat', 'engage', 'engajamento', 'interaction'] },
  { stepId: 'step_01_discovery', keywords: ['landing', 'discover', 'discovery', 'home'] },
];

const SUBJOURNEY_KEYWORDS = [
  { id: 'payment_success', keywords: ['payment_success', 'success', 'aprovado'] },
  { id: 'payment_failed', keywords: ['payment_failed', 'failed', 'failure', 'erro'] },
  { id: 'lead_generation', keywords: ['lead', 'capture'] },
  { id: 'schedule_success', keywords: ['schedule', 'agendamento', 'appointment'] },
  { id: 'support_resolution', keywords: ['support', 'suporte', 'ticket'] },
];

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

  const aliases = {
    ecommerce: 'market',
    e_commerce: 'market',
    e_comércio: 'market',
    varejo: 'market',
    servicos: 'services',
    servicos_gerais: 'services',
    serviço: 'services',
    serviços: 'services',
    clinica: 'clinic',
    saude: 'clinic',
  };

  return aliases[normalized] || normalized;
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
    return { domainId: 'unmapped', reason: 'empty-scenario-id', usedFallback: true };
  }

  if (normalized.startsWith('business-fit-') || normalized.includes('fitness') || flow.includes('fitness')) return { domainId: 'fitness', reason: 'fitness-keyword', usedFallback: false };
  if (normalized.startsWith('business-clinic-') || normalized.includes('clinic') || flow.includes('clinic')) return { domainId: 'clinic', reason: 'clinic-keyword', usedFallback: false };
  if (normalized.startsWith('business-food-') || normalized.includes('food') || flow.includes('food')) return { domainId: 'food', reason: 'food-keyword', usedFallback: false };
  if (normalized.startsWith('business-market-') || normalized.includes('market') || flow.includes('market')) return { domainId: 'market', reason: 'market-keyword', usedFallback: false };
  if (normalized.startsWith('business-serv-') || normalized.includes('service') || flow.includes('service')) return { domainId: 'services', reason: 'services-keyword', usedFallback: false };
  if (normalized.includes('chatpro') || normalized.includes('omnichannel') || flow.includes('omnichannel')) return { domainId: 'omnichannel', reason: 'omnichannel-keyword', usedFallback: false };
  if (normalized.includes('bpmn') || flow.includes('bpmn')) return { domainId: 'bpmn', reason: 'bpmn-keyword', usedFallback: false };

  if (normalized.startsWith('fitness::') || normalized.includes('fitness')) return { domainId: 'fitness', reason: 'legacy-fitness', usedFallback: false };
  if (normalized.startsWith('beauty::') || normalized.includes('beauty')) return { domainId: 'beauty', reason: 'legacy-beauty', usedFallback: false };
  if (normalized.startsWith('pbx::') || normalized.includes('pbx') || normalized.includes('voice')) return { domainId: 'pbx', reason: 'legacy-pbx', usedFallback: false };
  if (normalized.startsWith('core::') || normalized.includes('core')) return { domainId: 'core', reason: 'legacy-core', usedFallback: false };

  // Fallback agressivo para cenários do ecossistema QA/RPA sem marcador explícito.
  if (normalized.startsWith('business-') || normalized.startsWith('qa-') || normalized.startsWith('rpa-')) {
    return { domainId: 'core', reason: 'prefix-fallback-core', usedFallback: true };
  }

  return { domainId: 'unmapped', reason: 'unmapped-fallback', usedFallback: true };
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

  if (domainId === 'fitness') {
    if (normalized.includes('renew') || normalized.includes('attendance') || normalized.includes('membership')) {
      return 'fitness_active_customer';
    }
    return 'fitness_new_customer';
  }

  if (domainId === 'beauty') {
    if (normalized.includes('return') || normalized.includes('reactivation') || normalized.includes('retention')) {
      return 'beauty_returning_customer';
    }
    return 'beauty_new_customer';
  }

  if (domainId === 'pbx') {
    if (normalized.includes('route') || normalized.includes('trunk') || normalized.includes('extension')) {
      return 'pbx_operations';
    }
    return 'pbx_voice_service';
  }

  if (domainId === 'clinic') return 'clinic_customer_journey';
  if (domainId === 'food') return 'food_customer_journey';
  if (domainId === 'market') return 'market_customer_journey';
  if (domainId === 'services') return 'services_customer_journey';
  if (domainId === 'omnichannel') return 'omnichannel_operations';
  if (domainId === 'bpmn') return 'bpmn_editor_journey';

  if (domainId === 'core') return 'core_customer_journey';
  return 'unmapped_journey';
}

function inferStepId(scenarioId) {
  const normalized = normalizeScenarioId(scenarioId).toLowerCase();
  for (const entry of STEP_KEYWORDS) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword))) {
      return entry.stepId;
    }
  }
  return 'step_03_engagement';
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
};
