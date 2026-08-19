'use strict';

/**
 * Coverage Gate — motor puro de decisão GO/NO_GO de cobertura.
 *
 * Sem I/O: todas as entradas chegam como dados (itens de inventário,
 * cenários do mesh, resultados de execução, violações, thresholds).
 *
 * Modelo de itens avaliados (todos com { id, dimension, criticality, state }):
 * - `journey:<id>`  — jornadas de negócio (dimensão 'journey'); criticidade =
 *   maior criticidade dos cenários do(s) domínio(s) ligados à jornada.
 * - `outcome:<scenarioId>` — um outcome por cenário do mesh (dimensão
 *   'outcome'); criticidade mapeada do cenário.
 * - itens do inventário (api/page/model/table/field/relation), dimensão =
 *   kind (table→model); criticidade = maior criticidade dos cenários dos
 *   domínios ligados (linkedDomains/linkedJourneys); itens de onda técnica
 *   sem cenário ficam NORMAL.
 *
 * Mapeamento de status de execução → estado:
 *   passed                → VALIDATED
 *   passed_unverified     → VISITED (executou, mas sem assertions registradas)
 *   inferred_passed       → VISITED (inferência por afinidade de domínio —
 *                           nunca VALIDATED: só execução real valida)
 *   passed_via_fallback   → VISITED (não conta como validado)
 *   failed | flaky        → FAILED
 *   skipped | environment_missing | infra_error → BLOCKED
 *   cenário nunca executado → UNCOVERED
 *   item do inventário linkStatus ORPHANED → ORPHANED
 *   item com fingerprint alterado (staleItemIds) → REVALIDATION_REQUIRED
 *
 * Agregação de status de um grupo (jornada/domínio): FAILED > BLOCKED >
 * UNCOVERED (rebaixa o grupo para VISITED quando há execuções parciais, ou
 * UNCOVERED quando nada executou) > VALIDATED. Grupo sem cenários → UNCOVERED.
 *
 * Ligação jornada ↔ execução (parâmetros opcionais `aliases` e
 * `journeyScenarioLinks`, ver qa/coverage/journeyLinks.js):
 *   (i) jornada com cenários ligados e pelo menos um com execução conhecida
 *       → estado agregado dos cenários ligados (ligado sem execução conta
 *       como UNCOVERED na agregação);
 *   (ii) senão, fallback ao matching por domínio (id da jornada contém o
 *       domínio ou seu canônico via aliases);
 *   (iii) senão, UNCOVERED.
 * Invariante: uma jornada NUNCA fica VALIDATED sem pelo menos um cenário
 * executado e passando (nem por link nem por domínio).
 *
 * successRate: execuções concluídas (passed/failed/fallback/flaky); apenas
 * 'passed' conta como sucesso — fallback NÃO é sucesso pleno.
 */

const { COVERAGE_STATES } = require('./coverageStates');
const {
  visitedCoverage,
  validatedCoverage,
  successRate,
  weightedCoverage,
  dimensionCoverage,
  waveScore,
} = require('./coverageCalculator');
const { CRITICALITY_WEIGHTS } = require('./traceabilityGraph');
const { DEFAULT_THRESHOLDS } = require('./gateThresholds');
const { journeyMatchesDomain } = require('./journeyLinks');

/** Criticidade do mesh → criticidade formal. */
const MESH_CRITICALITY_MAP = Object.freeze({
  blocking: 'CRITICAL',
  high: 'HIGH',
  medium: 'NORMAL',
  standard: 'NORMAL',
});

/** Kind do inventário → dimensão de cobertura. */
const KIND_TO_DIMENSION = Object.freeze({
  api: 'api',
  page: 'page',
  model: 'model',
  table: 'model',
  field: 'field',
  relation: 'relation',
});

/** Status de execução → estado de cobertura. */
const EXECUTION_STATUS_TO_STATE = Object.freeze({
  passed: COVERAGE_STATES.VALIDATED,
  passed_unverified: COVERAGE_STATES.VISITED,
  inferred_passed: COVERAGE_STATES.VISITED,
  passed_via_fallback: COVERAGE_STATES.VISITED,
  failed: COVERAGE_STATES.FAILED,
  flaky: COVERAGE_STATES.FAILED,
  skipped: COVERAGE_STATES.BLOCKED,
  environment_missing: COVERAGE_STATES.BLOCKED,
  infra_error: COVERAGE_STATES.BLOCKED,
});

const REASON_ITEMS_LIMIT = 20;

function mapScenarioCriticality(criticality) {
  return MESH_CRITICALITY_MAP[criticality] || 'NORMAL';
}

function maxCriticality(a, b) {
  return (CRITICALITY_WEIGHTS[a] || 1) >= (CRITICALITY_WEIGHTS[b] || 1) ? a : b;
}

function normalizeExecutions(executions) {
  const byScenario = new Map();
  for (const execution of executions || []) {
    if (!execution || !execution.scenarioId) continue;
    byScenario.set(execution.scenarioId, execution.status);
  }
  return byScenario;
}

function stateForStatus(status) {
  if (!status) return COVERAGE_STATES.UNCOVERED;
  return EXECUTION_STATUS_TO_STATE[status] || COVERAGE_STATES.UNCOVERED;
}

/**
 * Agrega os estados de um grupo (jornada/domínio). Cenários nunca executados
 * entram como UNCOVERED e rebaixam o grupo: um grupo parcialmente executado
 * sem falhas fica VISITED (visitado, não validado por completo).
 * Precedência: FAILED > BLOCKED > (UNCOVERED presente → VISITED/UNCOVERED)
 * > VALIDATED.
 */
function aggregateGroupState(states) {
  if (states.length === 0) return COVERAGE_STATES.UNCOVERED;
  if (states.includes(COVERAGE_STATES.FAILED)) return COVERAGE_STATES.FAILED;
  if (states.includes(COVERAGE_STATES.BLOCKED)) return COVERAGE_STATES.BLOCKED;
  if (states.includes(COVERAGE_STATES.UNCOVERED)) {
    return states.includes(COVERAGE_STATES.VALIDATED) || states.includes(COVERAGE_STATES.VISITED)
      ? COVERAGE_STATES.VISITED
      : COVERAGE_STATES.UNCOVERED;
  }
  if (states.every((state) => state === COVERAGE_STATES.VALIDATED)) return COVERAGE_STATES.VALIDATED;
  return COVERAGE_STATES.VISITED;
}

/**
 * Monta a lista de itens avaliáveis do gate a partir das entradas brutas.
 * Exportada para inspeção/testes.
 *
 * `aliases` (alias → canônico) e `journeyScenarioLinks` (jornada → cenários
 * do mesh, ver qa/coverage/journeyLinks.js) são opcionais: sem eles o
 * comportamento é o original (matching por domínio via `includes`).
 */
function buildGateItems({ inventoryItems = [], scenarios = [], executions = [], journeys, staleItemIds = [], technicalExecutions = [], aliases, journeyScenarioLinks } = {}) {
  const execByScenario = normalizeExecutions(executions);
  const stale = new Set(staleItemIds);

  // Execuções de ondas técnicas fora do mesh (ex.: Database Integrity Wave):
  // itemId → estado já resolvido (VALIDATED/VISITED/FAILED/...). Estados
  // desconhecidos são ignorados. Aplicados apenas a itens de inventário sem
  // domínio ligado — itens ligados a jornadas continuam governados pelo mesh.
  const validStates = new Set(Object.values(COVERAGE_STATES));
  const technicalByItem = new Map();
  for (const execution of technicalExecutions || []) {
    if (execution && execution.itemId && validStates.has(execution.state)) {
      technicalByItem.set(execution.itemId, execution.state);
    }
  }

  const domainScenarios = new Map();
  for (const scenario of scenarios) {
    if (!scenario || !scenario.domain) continue;
    if (!domainScenarios.has(scenario.domain)) domainScenarios.set(scenario.domain, []);
    domainScenarios.get(scenario.domain).push(scenario);
  }

  function scenarioState(scenario) {
    return stateForStatus(execByScenario.get(scenario.id));
  }

  function domainState(domain) {
    const group = domainScenarios.get(domain) || [];
    return aggregateGroupState(group.map(scenarioState));
  }

  function domainCriticality(domain) {
    const group = domainScenarios.get(domain) || [];
    return group.reduce(
      (acc, scenario) => maxCriticality(acc, mapScenarioCriticality(scenario.criticality)),
      'NORMAL',
    );
  }

  // Domínios ligados a uma jornada (id da jornada contém o domínio ou seu
  // canônico via aliases — ver journeyLinks.journeyMatchesDomain).
  function domainsForJourney(journeyId) {
    return [...domainScenarios.keys()].filter((domain) => journeyMatchesDomain(journeyId, domain, aliases));
  }

  const scenarioById = new Map();
  for (const scenario of scenarios) {
    if (scenario && scenario.id) scenarioById.set(scenario.id, scenario);
  }

  const journeyIds = Array.isArray(journeys)
    ? journeys
    : [...new Set((inventoryItems || []).flatMap((item) => item.linkedJourneys || []))].sort();

  const items = [];

  // 1. Jornadas de negócio. Cascata: (i) cenários ligados com execução
  // conhecida (journeyScenarioLinks; ligado sem execução conta UNCOVERED na
  // agregação) → (ii) matching por domínio (com aliases) → (iii) UNCOVERED.
  // Uma jornada nunca fica VALIDATED sem cenário executado e passando.
  for (const journeyId of journeyIds) {
    const link = journeyScenarioLinks && journeyScenarioLinks[journeyId];
    const linkedIds = link && Array.isArray(link.scenarioIds) ? link.scenarioIds : [];
    if (linkedIds.length > 0 && linkedIds.some((id) => execByScenario.has(id))) {
      items.push({
        id: `journey:${journeyId}`,
        dimension: 'journey',
        criticality: linkedIds.reduce(
          (acc, id) => {
            const linked = scenarioById.get(id);
            return linked ? maxCriticality(acc, mapScenarioCriticality(linked.criticality)) : acc;
          },
          'NORMAL',
        ),
        state: aggregateGroupState(linkedIds.map((id) => stateForStatus(execByScenario.get(id)))),
        linkedScenarios: linkedIds,
        linkSource: link.source,
      });
      continue;
    }

    const domains = domainsForJourney(journeyId);
    items.push({
      id: `journey:${journeyId}`,
      dimension: 'journey',
      criticality: domains.reduce((acc, domain) => maxCriticality(acc, domainCriticality(domain)), 'NORMAL'),
      state: aggregateGroupState(domains.map(domainState)),
      linkedDomains: domains,
    });
  }

  // 2. Outcomes (um por cenário do mesh).
  for (const scenario of scenarios) {
    if (!scenario || !scenario.id) continue;
    items.push({
      id: `outcome:${scenario.id}`,
      dimension: 'outcome',
      criticality: mapScenarioCriticality(scenario.criticality),
      state: scenarioState(scenario),
    });
  }

  // 3. Itens do inventário.
  for (const item of inventoryItems || []) {
    const base = {
      id: item.id,
      dimension: KIND_TO_DIMENSION[item.kind] || item.kind || 'unknown',
      criticality: item.criticality || 'NORMAL',
      state: COVERAGE_STATES.UNCOVERED,
    };

    if (item.linkStatus === 'ORPHANED') {
      base.state = COVERAGE_STATES.ORPHANED;
      items.push(base);
      continue;
    }

    const domains = [
      ...(item.linkedDomains || []),
      ...(item.linkedJourneys || []).flatMap((journeyId) => domainsForJourney(journeyId)),
    ];
    const uniqueDomains = [...new Set(domains)];

    if (uniqueDomains.length > 0) {
      base.criticality = uniqueDomains.reduce(
        (acc, domain) => maxCriticality(acc, domainCriticality(domain)),
        base.criticality,
      );
      base.state = aggregateGroupState(uniqueDomains.map(domainState));
    } else if (technicalByItem.has(item.id)) {
      // Onda técnica com execução própria (ex.: Database Integrity Wave).
      base.state = technicalByItem.get(item.id);
    }
    // Sem domínio ligado e sem execução técnica: permanece UNCOVERED.

    if (stale.has(item.id) && base.state !== COVERAGE_STATES.ORPHANED) {
      base.state = COVERAGE_STATES.REVALIDATION_REQUIRED;
    }

    items.push(base);
  }

  return items;
}

function normalizeViolations(input) {
  if (input === undefined || input === null) return { count: 0, items: [] };
  if (typeof input === 'number') return { count: input, items: [] };
  if (Array.isArray(input)) return { count: input.length, items: input };
  if (typeof input === 'object') {
    const items = Array.isArray(input.items) ? input.items : (Array.isArray(input.violations) ? input.violations : []);
    return { count: typeof input.count === 'number' ? input.count : items.length, items };
  }
  return { count: 0, items: [] };
}

function successRateStatus(status) {
  if (status === 'passed') return 'passed';
  if (status === 'failed' || status === 'flaky' || status === 'passed_via_fallback') return 'failed';
  return 'skipped';
}

function formatReason(check, threshold, actual, items) {
  const reason = { check, threshold, actual };
  if (items && items.length > 0) {
    reason.items = items.slice(0, REASON_ITEMS_LIMIT);
    if (items.length > REASON_ITEMS_LIMIT) reason.omitted = items.length - REASON_ITEMS_LIMIT;
  }
  return reason;
}

/**
 * Avalia o gate de cobertura.
 *
 * @param {object} input
 * @param {object[]} input.inventoryItems itens de config/system-inventory.json
 * @param {object[]} input.scenarios cenários do meshRegistry
 * @param {Array<{scenarioId:string,status:string}>} input.executions
 *   resultado da última execução por cenário. Execuções de scenarioIds que
 *   NÃO constam em `scenarios` são ignoradas nas métricas e reportadas à
 *   parte em `unexpectedExecutions` (nunca inflam o numerador).
 * @param {string[]} [input.journeys] ids de jornadas (default: derivado dos
 *   linkedJourneys do inventário).
 * @param {string[]} [input.staleItemIds] itens com fingerprint alterado desde
 *   a evidência (→ REVALIDATION_REQUIRED + evidência STALE).
 * @param {number|Array|object} [input.visibilityViolations]
 * @param {number|Array|object} [input.tenantIsolationViolations]
 * @param {number|Array|object} [input.ragDomainSegregationViolations]
 * @param {Array<{itemId:string,state:string}>} [input.technicalExecutions]
 *   estados resolvidos por ondas técnicas fora do mesh (ex.: Database
 *   Integrity Wave) para itens de inventário sem domínio ligado.
 * @param {object} [input.aliases] mapa alias → canônico de domínios
 *   (qa/coverage/journeyLinks.js#resolveDomainAliases).
 * @param {object} [input.journeyScenarioLinks] ligações jornada → cenários
 *   do mesh (qa/coverage/journeyLinks.js#buildJourneyScenarioLinks).
 * @param {object} [input.thresholds] overrides de DEFAULT_THRESHOLDS.
 * @param {string} [input.waveId]
 */
function evaluateCoverageGate(input = {}) {
  const {
    inventoryItems = [],
    scenarios = [],
    executions = [],
    journeys,
    staleItemIds = [],
    technicalExecutions = [],
    aliases,
    journeyScenarioLinks,
    thresholds = {},
    waveId = 'coverage-gate',
  } = input;

  const effectiveThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const items = buildGateItems({ inventoryItems, scenarios, executions, journeys, staleItemIds, technicalExecutions, aliases, journeyScenarioLinks });

  const visibility = normalizeViolations(input.visibilityViolations);
  const tenantIsolation = normalizeViolations(input.tenantIsolationViolations);
  const ragDomainSegregation = normalizeViolations(input.ragDomainSegregationViolations);

  const dimensions = dimensionCoverage(items);
  const critical = items.filter((item) => item.criticality === 'CRITICAL');
  const byState = (state) => critical.filter((item) => item.state === state);

  const staleCriticalItems = critical.filter(
    (item) => item.state === COVERAGE_STATES.STALE || item.state === COVERAGE_STATES.REVALIDATION_REQUIRED,
  );

  const criticalSummaryResult = {
    uncovered: byState(COVERAGE_STATES.UNCOVERED).length,
    failed: byState(COVERAGE_STATES.FAILED).length,
    stale: staleCriticalItems.length,
    orphaned: byState(COVERAGE_STATES.ORPHANED).length,
  };

  const orphaned = items.filter((item) => item.state === COVERAGE_STATES.ORPHANED);

  // Invariante de conjuntos: apenas execuções de cenários que CONSTAM no
  // registry entram no numerador das métricas. Execuções de scenarioIds
  // desconhecidos (ex.: cenário removido do registry) são reportadas à
  // parte em `unexpectedExecutions` e nunca inflam sucesso/cobertura.
  const knownScenarioIds = new Set(
    (scenarios || []).filter((scenario) => scenario && scenario.id).map((scenario) => scenario.id),
  );
  const knownExecutions = [];
  const unexpectedExecutions = [];
  for (const execution of executions || []) {
    if (execution && knownScenarioIds.has(execution.scenarioId)) {
      knownExecutions.push(execution);
    } else {
      unexpectedExecutions.push(execution && execution.scenarioId);
    }
  }
  const gateExecutions = knownExecutions.map((execution) => ({
    status: successRateStatus(execution && execution.status),
  }));

  const journeyItems = items.filter((item) => item.dimension === 'journey');
  const outcomeItems = items.filter((item) => item.dimension === 'outcome');
  const apiItems = items.filter((item) => item.dimension === 'api');
  const technicalItems = items.filter(
    (item) => item.dimension !== 'journey' && item.dimension !== 'outcome',
  );

  const journeyCoverage = validatedCoverage(journeyItems);
  const technicalCoverage = validatedCoverage(technicalItems);
  const validated = validatedCoverage(items);
  const weighted = weightedCoverage(items);

  function validatedPercentOfCritical(group) {
    const criticalGroup = group.filter((item) => item.criticality === 'CRITICAL');
    return {
      percent: validatedCoverage(criticalGroup),
      offending: criticalGroup.filter((item) => item.state !== COVERAGE_STATES.VALIDATED).map((i) => i.id),
    };
  }

  const reasons = [];

  const checks = [
    ['criticalJourneysValidated', validatedPercentOfCritical(journeyItems)],
    ['criticalOutcomesValidated', validatedPercentOfCritical(outcomeItems)],
    ['criticalApiContractsValidated', validatedPercentOfCritical(apiItems)],
  ];
  for (const [check, result] of checks) {
    if (result.percent < effectiveThresholds[check]) {
      reasons.push(formatReason(check, effectiveThresholds[check], result.percent, result.offending));
    }
  }

  const countChecks = [
    ['uncoveredCriticalItems', byState(COVERAGE_STATES.UNCOVERED)],
    ['failedCriticalItems', byState(COVERAGE_STATES.FAILED)],
    ['orphanedCriticalItems', byState(COVERAGE_STATES.ORPHANED)],
    ['staleCriticalEvidence', staleCriticalItems],
  ];
  for (const [check, offendingItems] of countChecks) {
    if (offendingItems.length > effectiveThresholds[check]) {
      reasons.push(formatReason(
        check, effectiveThresholds[check], offendingItems.length, offendingItems.map((i) => i.id),
      ));
    }
  }

  if (visibility.count > effectiveThresholds.visibilityViolations) {
    reasons.push(formatReason('visibilityViolations', effectiveThresholds.visibilityViolations, visibility.count, visibility.items));
  }
  if (tenantIsolation.count > effectiveThresholds.tenantIsolationViolations) {
    reasons.push(formatReason('tenantIsolationViolations', effectiveThresholds.tenantIsolationViolations, tenantIsolation.count, tenantIsolation.items));
  }
  if (ragDomainSegregation.count > effectiveThresholds.ragDomainSegregationViolations) {
    reasons.push(formatReason('ragDomainSegregationViolations', effectiveThresholds.ragDomainSegregationViolations, ragDomainSegregation.count, ragDomainSegregation.items));
  }

  const coverageChecks = [
    ['minimumJourneyCoverage', journeyCoverage],
    ['minimumTechnicalCoverage', technicalCoverage],
    ['minimumWeightedCoverage', weighted],
  ];
  for (const [check, actual] of coverageChecks) {
    if (actual < effectiveThresholds[check]) {
      reasons.push(formatReason(check, effectiveThresholds[check], actual));
    }
  }

  const decision = reasons.length === 0 ? 'GO' : 'NO_GO';

  return {
    waveId,
    status: decision,
    visitedCoverage: visitedCoverage(items),
    validatedCoverage: validated,
    successRate: successRate(gateExecutions),
    weightedCoverage: weighted,
    journeyCoverage,
    technicalCoverage,
    waveScore: waveScore(dimensions, 'business-journey'),
    dimensions,
    critical: criticalSummaryResult,
    orphaned: { count: orphaned.length, items: orphaned.map((item) => item.id).slice(0, REASON_ITEMS_LIMIT) },
    unexpectedExecutions: {
      count: unexpectedExecutions.length,
      items: unexpectedExecutions.filter(Boolean).slice(0, REASON_ITEMS_LIMIT),
    },
    visibilityViolations: visibility,
    tenantIsolationViolations: tenantIsolation,
    ragDomainSegregationViolations: ragDomainSegregation,
    totals: {
      items: items.length,
      journeys: journeyItems.length,
      outcomes: outcomeItems.length,
      inventory: technicalItems.length,
      executions: (executions || []).length,
    },
    releaseGate: {
      decision,
      reasons,
      thresholds: effectiveThresholds,
    },
  };
}

module.exports = {
  evaluateCoverageGate,
  buildGateItems,
  MESH_CRITICALITY_MAP,
  KIND_TO_DIMENSION,
  EXECUTION_STATUS_TO_STATE,
};
