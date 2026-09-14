#!/usr/bin/env node
'use strict';

/**
 * validate-coverage-gate.js
 *
 * Coverage Gate (bloqueante por padrão): cruza o inventário real do sistema
 * (`config/system-inventory.json`), os cenários do QA Mesh
 * (`qa-mesh/meshRegistry.json`) e os resultados da última execução
 * (`qa-mesh/go-no-go-report.json` + histórico por cenário em
 * `qa-mesh/meshHistory/`) e avalia os thresholds de
 * `qa/coverage/gateThresholds.js`.
 *
 * Fontes de execução:
 * - go-no-go-report.json (execução canônica): atribui status por domínio
 *   apenas quando o domínio é homogêneo (ex.: todos passed) E o cenário
 *   consta nos results da execução canônica referenciada pelo relatório
 *   (qa-mesh/meshHistory/<executionId>.json). Status derivado por essa
 *   afinidade de domínio é inferência: `passed` vira `inferred_passed`
 *   (VISITED, nunca VALIDATED — ver qa/coverage/coverageGate.js).
 * - meshHistory/*.json: resultados por cenário; o mais recente vence.
 *   `passed` sem assertions registradas vira `passed_unverified` (VISITED).
 *   Antes de consumir o meshHistory, a integridade da cadeia append-only
 *   (qa-mesh/executionHistoryChain.verifyChain) é verificada — cadeia
 *   ausente/quebrada derruba o gate (fail-closed: NO EVIDENCE → NO
 *   VALIDATED COVERAGE).
 * - reports/db-integrity-report.json (Database Integrity Wave, opcional):
 *   estados VALIDATED/VISITED/FAILED por model, aplicados aos itens
 *   model:/table:/field: sem domínio ligado como technicalExecutions.
 * - reports/api-surface-report.json (API Surface Wave, opcional): probes
 *   HTTP reais por rota (existência, auth, classificação), aplicados aos
 *   itens api: sem domínio ligado como technicalExecutions.
 * - reports/page-surface-report.json (Page Surface Wave, opcional): probes
 *   reais de navegação por página (auth, classificação, carregamento),
 *   aplicados aos itens page: sem domínio ligado como technicalExecutions.
 * - Ligação jornada ↔ execução (qa/coverage/journeyLinks.js): aliases de
 *   domínio de config/qa-waves-registry.json + declaração versionada
 *   config/journey-scenario-links.json (estável no checkout; funciona igual
 *   no modo snapshot). Resumo registrado em inputs.journeyLinks.
 *
 * Violações de visibilidade: lê reports/visibility-policy-report.json
 * (executa scripts/governance/validate-visibility-policy.js se o relatório
 * não existir). Violações de isolamento de tenant: lê
 * reports/tenant-isolation-report.json (gerado por
 * scripts/governance/tenant-isolation-report.js); se o relatório estiver
 * ausente ou mais velho que 24h, o script é executado. Sem relatório algum
 * (ambiente sem jest/DB): source='missing' e 0 violações (conservador — não
 * bloqueia ambientes sem DB). Relatório existente com violations>0 alimenta
 * `tenantIsolationViolations` e bloqueia.
 *
 * Flags:
 *   --informative        exit 0 sempre (mode=informative no relatório)
 *   --check-fingerprints reconstrói o inventário e marca itens com
 *                        fingerprint alterado como REVALIDATION_REQUIRED
 *
 * Env: COVERAGE_GATE_MODE=informative; COVERAGE_GATE_* (overrides de
 * threshold — ver qa/coverage/gateThresholds.js);
 * COVERAGE_GATE_SKIP_TENANT_RUN=1 nunca executa o script de tenant (usa o
 * relatório existente, mesmo desatualizado — útil em CI rápido sem DB).
 *
 * Saída: reports/coverage-gate-report.json. Exit 1 em NO_GO (modo blocking).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { evaluateCoverageGate, buildGateItems } = require('../../qa/coverage/coverageGate');
const { resolveThresholds } = require('../../qa/coverage/gateThresholds');
const { resolveDomainAliases, canonicalDomain, buildJourneyScenarioLinks } = require('../../qa/coverage/journeyLinks');
const { buildInventory, diffInventories } = require('../../api/services/qa/inventory/inventoryEngine');

const ROOT_DIR = path.join(__dirname, '..', '..');
const INVENTORY_PATH = path.join(ROOT_DIR, 'config', 'system-inventory.json');
const MESH_REGISTRY_PATH = path.join(ROOT_DIR, 'qa-mesh', 'meshRegistry.json');
const GO_NO_GO_PATH = path.join(ROOT_DIR, 'qa-mesh', 'go-no-go-report.json');
const MESH_HISTORY_DIR = path.join(ROOT_DIR, 'qa-mesh', 'meshHistory');
const JOURNEY_CONTRACTS_PATH = path.join(ROOT_DIR, 'config', 'journey-contracts.json');
const VISIBILITY_REPORT_PATH = path.join(ROOT_DIR, 'reports', 'visibility-policy-report.json');
const VISIBILITY_VALIDATOR_PATH = path.join(ROOT_DIR, 'scripts', 'governance', 'validate-visibility-policy.js');
const TENANT_REPORT_PATH = path.join(ROOT_DIR, 'reports', 'tenant-isolation-report.json');
const RAG_SEGREGATION_REPORT_PATH = path.join(ROOT_DIR, 'reports', 'rag-domain-segregation-report.json');
const RAG_SEGREGATION_REPORT_SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'governance', 'rag-domain-segregation-report.js');
const TENANT_REPORT_SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'governance', 'tenant-isolation-report.js');
const TENANT_REPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Frescor das evidências das waves técnicas (db-integrity, api-surface,
// page-surface): relatório mais velho que o limiar tem seus estados
// VALIDATED degradados para STALE — evidência vencida não conta como
// cobertura válida (modelo de estados em qa/coverage/coverageStates.js).
// Override via COVERAGE_GATE_WAVE_REPORT_MAX_AGE_MS (testes/ambientes).
const WAVE_REPORT_MAX_AGE_MS = Number(process.env.COVERAGE_GATE_WAVE_REPORT_MAX_AGE_MS)
  || 7 * 24 * 60 * 60 * 1000;
const THRESHOLDS_CONFIG_PATH = path.join(ROOT_DIR, 'config', 'coverage-gate-thresholds.json');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'coverage-gate-report.json');
// Relatório da Database Integrity Wave (scripts/governance/db-integrity-wave.js):
// fonte adicional de execução técnica para itens model:/table:/field: sem
// domínio ligado. Ausente → comportamento inalterado (itens ficam UNCOVERED).
const DB_INTEGRITY_REPORT_PATH = path.join(ROOT_DIR, 'reports', 'db-integrity-report.json');
// Relatório da API Surface Wave (scripts/governance/api-surface-wave.js):
// probes HTTP reais por rota (existência, enforcement de auth e de
// classificação) — fonte de execução técnica para itens api: sem domínio
// ligado. Ausente → comportamento inalterado (itens ficam UNCOVERED).
const API_SURFACE_REPORT_PATH = path.join(ROOT_DIR, 'reports', 'api-surface-report.json');
// Relatório da Page Surface Wave (scripts/governance/page-surface-wave.js):
// probes reais de navegação (Playwright) por página (enforcement de auth e
// de classificação, carregamento são) — fonte de execução técnica para itens
// page: sem domínio ligado. Ausente → comportamento inalterado.
const PAGE_SURFACE_REPORT_PATH = path.join(ROOT_DIR, 'reports', 'page-surface-report.json');
// Snapshot versionado usado quando qa-mesh/meshRegistry.json não existe no
// checkout (arquivo de runtime, gitignored) — ex.: CI. Gerado por
// scripts/governance/coverage-gate-snapshot.js a partir dos dados vivos.
const SNAPSHOT_PATH = path.join(ROOT_DIR, 'config', 'coverage-gate-baseline.json');
// Ligação jornada ↔ execução (qa/coverage/journeyLinks.js): aliases de
// domínio (config/qa-waves-registry.json) e a declaração versionada
// jornada → cenários (config/journey-scenario-links.json). Ambos estáveis no
// checkout, então funcionam igual no modo snapshot (CI).
//
// IMPORTANTE: o gate NÃO lê qa-waves/journey-coverage/*.json diretamente.
// Esses arquivos são artefatos GERADOS por tools/system/platform-readiness.js
// (executado em `npm run zip:release`) e são reescritos com conteúdo degradado
// num checkout limpo sem o meshRegistry — foi o que derrubou a journeyCoverage
// no CI (regressão coberta por tests/unit/coverage/journeyLinksConfig.test.js).
// A declaração estável é sincronizada manualmente a partir deles com
// `npm run coverage-gate:links`.
const QA_WAVES_REGISTRY_PATH = path.join(ROOT_DIR, 'config', 'qa-waves-registry.json');
const JOURNEY_LINKS_CONFIG_PATH = path.join(ROOT_DIR, 'config', 'journey-scenario-links.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadJsonIfExists(filePath) {
  try {
    return loadJson(filePath);
  } catch {
    return null;
  }
}

/**
 * Extrai execuções por cenário da execução canônica (go-no-go-report).
 * Só atribui status quando o domínio é homogêneo (um único status agregado).
 * Domínios legados (ex.: `clinica`) são canonicalizados via aliases para
 * casar com o registry normalizado.
 */
function executionsFromGoNoGo(report, aliases) {
  const executions = [];
  const totals = report && report.totals;
  if (!totals || !totals.domains) return executions;

  for (const [rawDomain, counts] of Object.entries(totals.domains)) {
    const total = counts.total || 0;
    if (total === 0) continue;
    let status = null;
    if ((counts.passed || 0) === total) status = 'passed';
    else if ((counts.fallbackPassed || 0) === total) status = 'passed_via_fallback';
    else if ((counts.failed || 0) === total) status = 'failed';
    else if ((counts.skipped || 0) === total) status = 'skipped';
    if (!status) continue; // domínio heterogêneo: sem atribuição confiável
    executions.push({ domain: canonicalDomain(rawDomain, aliases), status, source: 'go-no-go-report' });
  }
  return executions;
}

/**
 * Cenários com execução REAL na execução canônica referenciada pelo
 * go-no-go report (qa-mesh/meshHistory/<executionId>.json). O broadcast por
 * domínio só pode valer para esses scenarioIds; sem o arquivo de resultados
 * da execução canônica, o conjunto é vazio e o broadcast é desativado
 * (NO EVIDENCE → NO VALIDATED COVERAGE).
 */
function realExecutionScenarioIds(report, historyDir = MESH_HISTORY_DIR) {
  const executionId = (report && (report.executionId || (report.totals && report.totals.executionId))) || null;
  if (!executionId) return new Set();
  const historyFile = path.join(historyDir, `${executionId}.json`);
  const run = loadJsonIfExists(historyFile);
  if (!run || !Array.isArray(run.results)) return new Set();
  return new Set(run.results.filter((r) => r && r.id).map((r) => r.id));
}

/**
 * Último resultado por cenário a partir do histórico do mesh.
 * `passed` só permanece `passed` quando o cenário tem assertions registradas
 * na execução; sem assertions registradas vira `passed_unverified`
 * (VISITED — executou, mas sem validação de assertivas).
 */
function executionsFromHistory(historyDir) {
  const executions = [];
  if (!fs.existsSync(historyDir)) return executions;

  const files = fs.readdirSync(historyDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(historyDir, name));

  const runs = [];
  for (const file of files) {
    const run = loadJsonIfExists(file);
    if (run && Array.isArray(run.results)) {
      runs.push({ startedAt: run.startedAt || '', results: run.results });
    }
  }
  runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const latestByScenario = new Map();
  for (const run of runs) {
    for (const result of run.results) {
      if (result && result.id && result.status) {
        latestByScenario.set(result.id, {
          status: result.status,
          hasAssertions: Array.isArray(result.assertions) && result.assertions.length > 0,
        });
      }
    }
  }
  for (const [scenarioId, entry] of latestByScenario) {
    const status = entry.status === 'passed' && !entry.hasAssertions
      ? 'passed_unverified'
      : entry.status;
    executions.push({ scenarioId, status, source: 'meshHistory' });
  }
  return executions;
}

/** Status de broadcast por afinidade de domínio: inferência nunca valida. */
function capBroadcastStatus(status) {
  return status === 'passed' ? 'inferred_passed' : status;
}

/**
 * Combina as fontes: canônica por domínio + histórico por cenário (vence).
 * O broadcast por domínio é restrito aos scenarioIds com execução real na
 * execução canônica do go-no-go report e nunca produz VALIDATED.
 */
function buildExecutions(scenarios, options = {}) {
  const historyDir = options.historyDir || MESH_HISTORY_DIR;
  const goNoGoPath = options.goNoGoPath || GO_NO_GO_PATH;
  const aliases = options.aliases
    || resolveDomainAliases(loadJsonIfExists(options.registryConfigPath || QA_WAVES_REGISTRY_PATH));
  const byScenario = new Map();

  const report = loadJsonIfExists(goNoGoPath);
  const domainStatus = new Map();
  for (const entry of executionsFromGoNoGo(report, aliases)) {
    domainStatus.set(entry.domain, entry.status);
  }
  const executedIds = realExecutionScenarioIds(report, historyDir);
  for (const scenario of scenarios) {
    if (scenario && scenario.id && scenario.domain && executedIds.has(scenario.id)
      && domainStatus.has(scenario.domain)) {
      byScenario.set(scenario.id, capBroadcastStatus(domainStatus.get(scenario.domain)));
    }
  }

  for (const entry of executionsFromHistory(historyDir)) {
    byScenario.set(entry.scenarioId, entry.status);
  }

  return [...byScenario.entries()].map(([scenarioId, status]) => ({ scenarioId, status }));
}

/**
 * Integridade da cadeia append-only do histórico do mesh
 * (qa-mesh/executionHistoryChain.verifyChain). Fail-closed: se o gate vai
 * consumir meshHistory (há arquivos de histórico), a cadeia precisa existir
 * e verificar íntegra; cadeia ausente ou quebrada invalida a evidência.
 * Sem meshHistory (modo snapshot, ex.: CI) a verificação não se aplica.
 *
 * `options.verifyChain`/`options.chainPath` existem para testes.
 */
function checkMeshHistoryChain(options = {}) {
  const historyDir = options.historyDir || MESH_HISTORY_DIR;
  const hasHistory = fs.existsSync(historyDir)
    && fs.readdirSync(historyDir).some((name) => name.endsWith('.json'));
  if (!hasHistory) {
    return { applicable: false, valid: true, source: 'meshHistory ausente (não consumido)' };
  }
  const source = 'qa-mesh/execution-history/index.jsonl';
  let chainPath = options.chainPath;
  let verify = options.verifyChain;
  if (!chainPath || !verify) {
    // Lazy: só carrega o módulo (que resolve CHAIN_PATH via env) quando o
    // teste não injetou as dependências.
    const chain = require('../../qa-mesh/executionHistoryChain');
    chainPath = chainPath || chain.CHAIN_PATH;
    verify = verify || chain.verifyChain;
  }
  if (!fs.existsSync(chainPath)) {
    return { applicable: true, valid: false, reason: 'mesh_history_chain_missing', source };
  }
  let result;
  try {
    result = verify();
  } catch (error) {
    return { applicable: true, valid: false, reason: `mesh_history_chain_verify_error: ${error.message}`, source };
  }
  if (!result || result.valid !== true) {
    return {
      applicable: true,
      valid: false,
      reason: 'mesh_history_chain_broken',
      brokenAt: result ? result.brokenAt : null,
      source,
    };
  }
  return { applicable: true, valid: true, source };
}

/**
 * Aplica o resultado da verificação da cadeia ao resultado do gate:
 * cadeia inválida adiciona reason bloqueante e força NO_GO (fail-closed).
 */
function applyMeshHistoryChainCheck(result, chainCheck) {
  if (!chainCheck || chainCheck.applicable !== true || chainCheck.valid === true) {
    return result;
  }
  const actual = chainCheck.brokenAt !== null && chainCheck.brokenAt !== undefined
    ? `${chainCheck.reason} (brokenAt=${chainCheck.brokenAt})`
    : chainCheck.reason;
  result.releaseGate.reasons.push({
    check: 'meshHistoryChainIntegrity',
    threshold: 'valid',
    actual,
  });
  result.releaseGate.decision = 'NO_GO';
  result.status = 'NO_GO';
  return result;
}

/**
 * Política de frescor das evidências de wave: relatório sem generatedAt ou
 * mais velho que options.maxAgeMs (padrão WAVE_REPORT_MAX_AGE_MS) tem seus
 * estados VALIDATED degradados para STALE — evidência vencida não conta
 * como cobertura válida. Estados não-VALIDATED são preservados.
 * `options.nowMs` existe para testes determinísticos.
 */
function applyWaveReportStaleness(executions, report, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : WAVE_REPORT_MAX_AGE_MS;
  const generatedAtMs = Date.parse(report && report.generatedAt);
  const stale = !Number.isFinite(generatedAtMs) || (nowMs - generatedAtMs) > maxAgeMs;
  if (!stale) {
    return { executions, stale: false };
  }
  return {
    stale: true,
    ageMs: Number.isFinite(generatedAtMs) ? nowMs - generatedAtMs : null,
    executions: executions.map((entry) => (
      entry.state === 'VALIDATED' ? { ...entry, state: 'STALE' } : entry
    )),
  };
}

/**
 * Lê reports/db-integrity-report.json e mapeia:
 * - cada entrada perModel para TODOS os itens do inventário pertencentes
 *   àquele model — correspondência por `item.model === <nome do model>`
 *   (mesma grafia do scanner) restrita aos kinds model/table/field;
 * - cada entrada perRelation para o item `relation:` de MESMO id
 *   (correspondência direta e inequívoca).
 * Sem relatório: fonte 'missing', nenhuma execução técnica (comportamento
 * inalterado). `options.reportPath` existe para testes com fixtures.
 */
function loadDbIntegrityTechnicalExecutions(inventoryItems, options = {}) {
  const report = loadJsonIfExists(options.reportPath || DB_INTEGRITY_REPORT_PATH);
  if (!report || !Array.isArray(report.perModel)) {
    return { executions: [], source: 'missing', dbAvailable: null };
  }
  const stateByModel = new Map();
  for (const entry of report.perModel) {
    if (entry && typeof entry.id === 'string' && entry.id.startsWith('model:') && entry.state) {
      stateByModel.set(entry.id.slice('model:'.length), entry.state);
    }
  }
  const stateByRelationId = new Map();
  for (const entry of (Array.isArray(report.perRelation) ? report.perRelation : [])) {
    if (entry && typeof entry.id === 'string' && entry.id.startsWith('relation:') && entry.state) {
      stateByRelationId.set(entry.id, entry.state);
    }
  }
  const modelKinds = new Set(['model', 'table', 'field']);
  const executions = [];
  for (const item of inventoryItems || []) {
    if (!item) continue;
    if (modelKinds.has(item.kind) && item.model && stateByModel.has(item.model)) {
      executions.push({ itemId: item.id, state: stateByModel.get(item.model) });
    } else if (item.kind === 'relation' && stateByRelationId.has(item.id)) {
      executions.push({ itemId: item.id, state: stateByRelationId.get(item.id) });
    }
  }
  const freshness = applyWaveReportStaleness(executions, report, options);
  return {
    executions: freshness.executions,
    stale: freshness.stale,
    source: `reports/db-integrity-report.json (${report.generatedAt || 'sem data'})`,
    dbAvailable: report.dbAvailable === true,
  };
}

/**
 * Lê reports/api-surface-report.json (API Surface Wave) e mapeia cada entrada
 * perItem para o item do inventário de MESMO id (correspondência direta —
 * ids `api:` são estáveis e inequívocos). Sem relatório: fonte 'missing',
 * nenhuma execução técnica. `options.reportPath` existe para testes.
 */
function loadApiSurfaceTechnicalExecutions(inventoryItems, options = {}) {
  const report = loadJsonIfExists(options.reportPath || API_SURFACE_REPORT_PATH);
  if (!report || !Array.isArray(report.perItem)) {
    return { executions: [], source: 'missing' };
  }
  const stateById = new Map();
  for (const entry of report.perItem) {
    if (entry && typeof entry.id === 'string' && entry.id.startsWith('api:') && entry.state) {
      stateById.set(entry.id, entry.state);
    }
  }
  const executions = [];
  for (const item of inventoryItems || []) {
    if (item && item.kind === 'api' && stateById.has(item.id)) {
      executions.push({ itemId: item.id, state: stateById.get(item.id) });
    }
  }
  const freshness = applyWaveReportStaleness(executions, report, options);
  return {
    executions: freshness.executions,
    stale: freshness.stale,
    source: `reports/api-surface-report.json (${report.generatedAt || 'sem data'})`,
  };
}

/**
 * Lê reports/page-surface-report.json (Page Surface Wave) e mapeia cada
 * entrada perItem para o item do inventário de MESMO id (correspondência
 * direta — ids `page:` são estáveis e inequívocos). Sem relatório: fonte
 * 'missing', nenhuma execução técnica. `options.reportPath` existe para
 * testes.
 */
function loadPageSurfaceTechnicalExecutions(inventoryItems, options = {}) {
  const report = loadJsonIfExists(options.reportPath || PAGE_SURFACE_REPORT_PATH);
  if (!report || !Array.isArray(report.perItem)) {
    return { executions: [], source: 'missing' };
  }
  const stateById = new Map();
  for (const entry of report.perItem) {
    if (entry && typeof entry.id === 'string' && entry.id.startsWith('page:') && entry.state) {
      stateById.set(entry.id, entry.state);
    }
  }
  const executions = [];
  for (const item of inventoryItems || []) {
    if (item && item.kind === 'page' && stateById.has(item.id)) {
      executions.push({ itemId: item.id, state: stateById.get(item.id) });
    }
  }
  const freshness = applyWaveReportStaleness(executions, report, options);
  return {
    executions: freshness.executions,
    stale: freshness.stale,
    source: `reports/page-surface-report.json (${report.generatedAt || 'sem data'})`,
  };
}

/**
 * Carrega as entradas da ligação jornada ↔ cenários: aliases de domínio
 * (config/qa-waves-registry.json) e a declaração versionada
 * config/journey-scenario-links.json ({ verticals: [{ vertical, journeys:
 * [{ journey, scenarios: [{ scenarioId, status }] }] }] }). Config ausente/
 * inválido → aliases resolvidos normalmente e lista de links vazia (o gate
 * reporta as jornadas como UNCOVERED em vez de falhar silencioso).
 *
 * `options.linksConfigPath` / `options.registryConfigPath` existem para os
 * testes de regressão apontarem fixtures sem tocar nos configs reais.
 */
function loadJourneyLinkInputs(scenarios, options = {}) {
  const linksConfigPath = options.linksConfigPath || JOURNEY_LINKS_CONFIG_PATH;
  const registryConfigPath = options.registryConfigPath || QA_WAVES_REGISTRY_PATH;
  const aliases = resolveDomainAliases(loadJsonIfExists(registryConfigPath));
  const linksConfig = loadJsonIfExists(linksConfigPath);
  const journeyCoverageFiles = linksConfig && Array.isArray(linksConfig.verticals)
    ? linksConfig.verticals
    : [];
  const meshScenarioIds = (scenarios || [])
    .filter((scenario) => scenario && scenario.id)
    .map((scenario) => ({ id: scenario.id, domain: scenario.domain }));
  const links = buildJourneyScenarioLinks({ journeyCoverageFiles, meshScenarioIds, aliases });
  const bySource = {};
  for (const link of Object.values(links)) {
    bySource[link.source] = (bySource[link.source] || 0) + 1;
  }
  return {
    aliases,
    links,
    summary: {
      total: Object.keys(links).length,
      bySource,
      verticals: journeyCoverageFiles.length,
      aliases: Object.keys(aliases).length,
      linksSource: linksConfig
        ? path.relative(ROOT_DIR, linksConfigPath)
        : `${path.relative(ROOT_DIR, linksConfigPath)} (ausente/inválido)`,
    },
  };
}

function loadVisibilityViolations() {  let report = loadJsonIfExists(VISIBILITY_REPORT_PATH);
  let source = 'reports/visibility-policy-report.json';
  if (!report) {
    execFileSync(process.execPath, [VISIBILITY_VALIDATOR_PATH], { stdio: 'inherit' });
    report = loadJsonIfExists(VISIBILITY_REPORT_PATH);
    source = 'validate-visibility-policy (executado)';
  }
  const violations = (report && report.violations) || [];
  return { count: violations.length, items: violations.map((v) => v.path || v.surface || v.type), source };
}

/**
 * Lê reports/tenant-isolation-report.json. Se ausente ou mais velho que 24h,
 * executa scripts/governance/tenant-isolation-report.js (que roda o Jest de
 * tenant) — salvo quando COVERAGE_GATE_SKIP_TENANT_RUN=1. Sem relatório
 * algum: source='missing', 0 violações (conservador). O script de tenant sai
 * com exit 1 quando há violações: nesse caso o relatório ainda é lido e
 * alimenta o gate.
 */
function loadTenantIsolationViolations() {
  const skipRun = process.env.COVERAGE_GATE_SKIP_TENANT_RUN === '1';
  let report = loadJsonIfExists(TENANT_REPORT_PATH);
  const stale = !report
    || !Number.isFinite(Date.parse(report.generatedAt))
    || (Date.now() - Date.parse(report.generatedAt)) > TENANT_REPORT_MAX_AGE_MS;

  if (stale && !skipRun) {
    console.log('[coverage-gate] relatório de tenant ausente/desatualizado; '
      + 'executando tenant-isolation-report...');
    try {
      execFileSync(process.execPath, [TENANT_REPORT_SCRIPT_PATH], { stdio: 'inherit' });
    } catch {
      // exit != 0 (violações ou ambiente sem jest): o relatório, se gravado, é lido abaixo.
    }
    report = loadJsonIfExists(TENANT_REPORT_PATH);
  }

  if (!report) {
    return { count: 0, items: [], source: 'missing' };
  }
  const count = typeof report.violations === 'number' ? report.violations : 0;
  const items = Array.isArray(report.failingSuites) ? report.failingSuites : [];
  const source = `reports/tenant-isolation-report.json${skipRun ? ' (skip-run)' : ''}`;
  return { count, items, source };
}

/**
 * Lê reports/rag-domain-segregation-report.json. Se ausente ou mais velho que
 * 24h, executa scripts/governance/rag-domain-segregation-report.js — salvo
 * quando COVERAGE_GATE_SKIP_RAG_RUN=1. A contagem agrega as métricas
 * bloqueantes (crossDomainLeakage, crossTenantLeakage, unclassifiedDocuments,
 * indexedSecrets, operationalAccessToSystemDomain etc.); os itens nomeiam as
 * métricas ofensoras. Relatório ausente, vencido, FAIL ou com probes
 * incompletos conta como violação: ausência de evidência é fail-closed.
 */
function evaluateRagDomainSegregationReport(report, { now = Date.now(), source = 'memory' } = {}) {
  if (!report || !report.metrics) {
    return { count: 1, items: ['rag_report_missing'], source };
  }

  const finalGeneratedAt = Date.parse(report.generatedAt);
  const evidenceFailures = [];
  if (!Number.isFinite(finalGeneratedAt)
    || (now - finalGeneratedAt) > TENANT_REPORT_MAX_AGE_MS) {
    evidenceFailures.push('rag_report_stale');
  }
  if (report.status !== 'PASS') evidenceFailures.push(`rag_report_status=${report.status || 'missing'}`);
  if (report.probes?.serviceReachable !== true) evidenceFailures.push('rag_runtime_unreachable');
  for (const key of ['crossDomainLeakage', 'crossTenantLeakage', 'operationalAccessToSystemDomain']) {
    if (typeof report.probes?.[key] !== 'number') evidenceFailures.push(`${key}=not_executed`);
  }
  const offending = Object.entries(report.metrics)
    .filter(([, value]) => typeof value === 'number' && value > 0);
  const metricCount = offending.reduce((acc, [, value]) => acc + value, 0);
  const items = [
    ...new Set(evidenceFailures),
    ...offending.map(([metric, value]) => `${metric}=${value}`),
  ];
  return { count: metricCount + evidenceFailures.length, items, source };
}

function loadRagDomainSegregationViolations() {
  const skipRun = process.env.COVERAGE_GATE_SKIP_RAG_RUN === '1';
  let report = loadJsonIfExists(RAG_SEGREGATION_REPORT_PATH);
  const stale = !report
    || !Number.isFinite(Date.parse(report.generatedAt))
    || (Date.now() - Date.parse(report.generatedAt)) > TENANT_REPORT_MAX_AGE_MS;

  if (stale && !skipRun) {
    console.log('[coverage-gate] relatório de segregação RAG ausente/desatualizado; '
      + 'executando rag-domain-segregation-report...');
    try {
      // O processo FILHO precisa do `.env` do projeto: o gerador usa
      // `RAG_INTERNAL_TOKEN` para os probes autenticados, e sem o token eles são
      // pulados e o relatório sai FAIL — derrubando a consolidação do release
      // mesmo com o token presente em `.env` (defesa em profundidade; o gerador
      // também carrega o `.env` por conta própria).
      execFileSync(process.execPath, [
        `--env-file-if-exists=${path.join(ROOT_DIR, '.env')}`,
        RAG_SEGREGATION_REPORT_SCRIPT_PATH,
      ], { stdio: 'inherit', cwd: ROOT_DIR });
    } catch {
      // exit != 0 (violações ou ambiente): o relatório, se gravado, é lido abaixo.
    }
    report = loadJsonIfExists(RAG_SEGREGATION_REPORT_PATH);
  }

  const source = report
    ? `reports/rag-domain-segregation-report.json${skipRun ? ' (skip-run)' : ''}`
    : 'missing';
  return evaluateRagDomainSegregationReport(report, { source });
}

function main() {
  const args = process.argv.slice(2);
  const informative = args.includes('--informative')
    || process.env.COVERAGE_GATE_MODE === 'informative';
  const checkFingerprints = args.includes('--check-fingerprints');

  const inventory = loadJson(INVENTORY_PATH);
  const journeyContracts = loadJsonIfExists(JOURNEY_CONTRACTS_PATH);
  const journeys = Object.keys((journeyContracts && journeyContracts.journeys) || {});

  let scenarios;
  let executions;
  let registrySource = path.relative(ROOT_DIR, MESH_REGISTRY_PATH);
  let meshHistoryChain = { applicable: false, valid: true, source: 'snapshot mode (meshHistory não consumido)' };
  if (fs.existsSync(MESH_REGISTRY_PATH)) {
    scenarios = loadJson(MESH_REGISTRY_PATH);
    executions = buildExecutions(scenarios);
    meshHistoryChain = checkMeshHistoryChain();
    if (meshHistoryChain.applicable && !meshHistoryChain.valid) {
      console.error(`[coverage-gate] FALHA: cadeia de integridade do meshHistory inválida — ${meshHistoryChain.reason}`);
    }
  } else {
    const snapshot = loadJsonIfExists(SNAPSHOT_PATH);
    if (!snapshot || !Array.isArray(snapshot.scenarios) || !Array.isArray(snapshot.executions)) {
      console.error('[coverage-gate] qa-mesh/meshRegistry.json ausente e snapshot '
        + `${path.relative(ROOT_DIR, SNAPSHOT_PATH)} inválido. `
        + 'Gere com: npm run coverage-gate:snapshot');
      process.exit(1);
    }
    scenarios = snapshot.scenarios;
    executions = snapshot.executions;
    registrySource = `${path.relative(ROOT_DIR, SNAPSHOT_PATH)} (snapshot ${snapshot.generatedAt || 'sem data'})`;
  }
  const visibility = loadVisibilityViolations();
  const tenantIsolation = loadTenantIsolationViolations();
  const ragDomainSegregation = loadRagDomainSegregationViolations();
  const dbIntegrity = loadDbIntegrityTechnicalExecutions(inventory.items);
  const apiSurface = loadApiSurfaceTechnicalExecutions(inventory.items);
  const pageSurface = loadPageSurfaceTechnicalExecutions(inventory.items);
  for (const [label, wave] of [['db-integrity', dbIntegrity], ['api-surface', apiSurface], ['page-surface', pageSurface]]) {
    if (wave.stale) {
      console.log(`[coverage-gate] AVISO: relatório ${label} STALE (limiar ${WAVE_REPORT_MAX_AGE_MS}ms excedido ou sem data) — estados VALIDATED degradados para STALE`);
    }
  }
  const technicalExecutions = [...dbIntegrity.executions, ...apiSurface.executions, ...pageSurface.executions];
  const journeyLinks = loadJourneyLinkInputs(scenarios);

  let staleItemIds = [];
  if (checkFingerprints) {
    console.log('[coverage-gate] reconstruindo inventário para diff de fingerprints...');
    const next = buildInventory({ rootDir: ROOT_DIR });
    staleItemIds = diffInventories(inventory, next).changed.map((entry) => entry.id);
    console.log(`[coverage-gate] fingerprints alterados: ${staleItemIds.length}`);
  }

  const { thresholds } = resolveThresholds({ configPath: THRESHOLDS_CONFIG_PATH });

  const result = evaluateCoverageGate({
    inventoryItems: inventory.items,
    scenarios,
    executions,
    journeys,
    staleItemIds,
    technicalExecutions,
    aliases: journeyLinks.aliases,
    journeyScenarioLinks: journeyLinks.links,
    visibilityViolations: visibility,
    tenantIsolationViolations: tenantIsolation,
    ragDomainSegregationViolations: ragDomainSegregation,
    thresholds,
    waveId: 'system-coverage',
  });
  applyMeshHistoryChainCheck(result, meshHistoryChain);

  const gateItems = buildGateItems({
    inventoryItems: inventory.items,
    scenarios,
    executions,
    journeys,
    staleItemIds,
    technicalExecutions,
    aliases: journeyLinks.aliases,
    journeyScenarioLinks: journeyLinks.links,
  });
  const journeyStates = gateItems
    .filter((item) => item.dimension === 'journey')
    .map((item) => ({
      id: item.id,
      state: item.state,
      linkedScenarios: item.linkedScenarios || [],
      linkedDomains: item.linkedDomains || [],
    }));

  const report = {
    ...result,
    mode: informative ? 'informative' : 'blocking',
    generatedAt: new Date().toISOString(),
    journeyStates,
    inputs: {
      inventory: path.relative(ROOT_DIR, INVENTORY_PATH),
      meshRegistry: registrySource,
      executionsMode: fs.existsSync(MESH_REGISTRY_PATH) ? 'live' : 'snapshot',
      executionsSources: ['qa-mesh/go-no-go-report.json', 'qa-mesh/meshHistory/'],
      meshHistoryChain,
      visibilitySource: visibility.source,
      fingerprintCheck: checkFingerprints,
      tenantIsolationSource: tenantIsolation.source,
      dbIntegritySource: dbIntegrity.source,
      apiSurfaceSource: apiSurface.source,
      pageSurfaceSource: pageSurface.source,
      journeyLinks: journeyLinks.summary,
      ...(dbIntegrity.dbAvailable === false
        ? { dbIntegrityNote: 'dbAvailable=false: itens técnicos da Database Integrity Wave ficaram no máximo VISITED (sem tier live)' }
        : {}),
    },
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[coverage-gate] mode=${report.mode} decision=${result.releaseGate.decision}`);
  console.log(`[coverage-gate] visited=${result.visitedCoverage}% validated=${result.validatedCoverage}% `
    + `weighted=${result.weightedCoverage}% successRate=${result.successRate}%`);
  console.log(`[coverage-gate] journeyCoverage=${result.journeyCoverage}% technicalCoverage=${result.technicalCoverage}% `
    + `waveScore=${result.waveScore}`);
  console.log(`[coverage-gate] critical: uncovered=${result.critical.uncovered} failed=${result.critical.failed} `
    + `stale=${result.critical.stale} orphaned=${result.critical.orphaned} | orphaned total=${result.orphaned.count}`);
  console.log(`[coverage-gate] visibilityViolations=${result.visibilityViolations.count} `
    + `tenantIsolationViolations=${result.tenantIsolationViolations.count}`);
  for (const reason of result.releaseGate.reasons) {
    const items = reason.items ? ` items=[${reason.items.slice(0, 5).join(', ')}${reason.items.length > 5 ? ', …' : ''}]` : '';
    console.log(`[coverage-gate] REASON ${reason.check}: actual=${reason.actual} threshold=${reason.threshold}${items}`);
  }
  console.log(`[coverage-gate] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);
  const notValidated = journeyStates.filter((j) => j.state !== 'VALIDATED');
  if (notValidated.length > 0) {
    console.log(`[coverage-gate] jornadas não validadas (${notValidated.length}):`);
    for (const j of notValidated) {
      console.log(`  - ${j.id}: ${j.state} (scenarios=[${j.linkedScenarios.join(',')}] domains=[${j.linkedDomains.join(',')}])`);
    }
  }

  if (!informative && result.releaseGate.decision === 'NO_GO') {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { buildExecutions, executionsFromGoNoGo, executionsFromHistory, realExecutionScenarioIds, checkMeshHistoryChain, applyMeshHistoryChainCheck, loadJourneyLinkInputs, loadDbIntegrityTechnicalExecutions, loadApiSurfaceTechnicalExecutions, loadPageSurfaceTechnicalExecutions, evaluateRagDomainSegregationReport, loadRagDomainSegregationViolations, applyWaveReportStaleness, MESH_REGISTRY_PATH, SNAPSHOT_PATH, ROOT_DIR };
