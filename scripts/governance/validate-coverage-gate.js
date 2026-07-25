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
 *   apenas quando o domínio é homogêneo (ex.: todos passed).
 * - meshHistory/*.json: resultados por cenário; o mais recente vence.
 * - reports/db-integrity-report.json (Database Integrity Wave, opcional):
 *   estados VALIDATED/VISITED/FAILED por model, aplicados aos itens
 *   model:/table:/field: sem domínio ligado como technicalExecutions.
 * - Ligação jornada ↔ execução (qa/coverage/journeyLinks.js): aliases de
 *   domínio de config/qa-waves-registry.json + mapas verticais
 *   qa-waves/journey-coverage/*.json (versionados; funcionam também no modo
 *   snapshot). Resumo registrado em inputs.journeyLinks.
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
const { resolveDomainAliases, buildJourneyScenarioLinks } = require('../../qa/coverage/journeyLinks');
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
const TENANT_REPORT_SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'governance', 'tenant-isolation-report.js');
const TENANT_REPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const THRESHOLDS_CONFIG_PATH = path.join(ROOT_DIR, 'config', 'coverage-gate-thresholds.json');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'coverage-gate-report.json');
// Relatório da Database Integrity Wave (scripts/governance/db-integrity-wave.js):
// fonte adicional de execução técnica para itens model:/table:/field: sem
// domínio ligado. Ausente → comportamento inalterado (itens ficam UNCOVERED).
const DB_INTEGRITY_REPORT_PATH = path.join(ROOT_DIR, 'reports', 'db-integrity-report.json');
// Snapshot versionado usado quando qa-mesh/meshRegistry.json não existe no
// checkout (arquivo de runtime, gitignored) — ex.: CI. Gerado por
// scripts/governance/coverage-gate-snapshot.js a partir dos dados vivos.
const SNAPSHOT_PATH = path.join(ROOT_DIR, 'config', 'coverage-gate-baseline.json');
// Ligação jornada ↔ execução (qa/coverage/journeyLinks.js): aliases de
// domínio e mapas verticais jornada → cenários. Ambos versionados, então
// funcionam igual no modo snapshot (CI).
const QA_WAVES_REGISTRY_PATH = path.join(ROOT_DIR, 'config', 'qa-waves-registry.json');
const JOURNEY_COVERAGE_DIR = path.join(ROOT_DIR, 'qa-waves', 'journey-coverage');

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
 */
function executionsFromGoNoGo(report) {
  const executions = [];
  const totals = report && report.totals;
  if (!totals || !totals.domains) return executions;

  for (const [domain, counts] of Object.entries(totals.domains)) {
    const total = counts.total || 0;
    if (total === 0) continue;
    let status = null;
    if ((counts.passed || 0) === total) status = 'passed';
    else if ((counts.fallbackPassed || 0) === total) status = 'passed_via_fallback';
    else if ((counts.failed || 0) === total) status = 'failed';
    else if ((counts.skipped || 0) === total) status = 'skipped';
    if (!status) continue; // domínio heterogêneo: sem atribuição confiável
    executions.push({ domain, status, source: 'go-no-go-report' });
  }
  return executions;
}

/** Último resultado por cenário a partir do histórico do mesh. */
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
        latestByScenario.set(result.id, result.status);
      }
    }
  }
  for (const [scenarioId, status] of latestByScenario) {
    executions.push({ scenarioId, status, source: 'meshHistory' });
  }
  return executions;
}

/** Combina as fontes: canônica por domínio + histórico por cenário (vence). */
function buildExecutions(scenarios) {
  const byScenario = new Map();

  const domainStatus = new Map();
  for (const entry of executionsFromGoNoGo(loadJsonIfExists(GO_NO_GO_PATH))) {
    domainStatus.set(entry.domain, entry.status);
  }
  for (const scenario of scenarios) {
    if (scenario && scenario.id && scenario.domain && domainStatus.has(scenario.domain)) {
      byScenario.set(scenario.id, domainStatus.get(scenario.domain));
    }
  }

  for (const entry of executionsFromHistory(MESH_HISTORY_DIR)) {
    byScenario.set(entry.scenarioId, entry.status);
  }

  return [...byScenario.entries()].map(([scenarioId, status]) => ({ scenarioId, status }));
}

/**
 * Lê reports/db-integrity-report.json e mapeia cada entrada perModel para
 * TODOS os itens do inventário pertencentes àquele model — correspondência
 * por `item.model === <nome do model>` (mesma grafia do scanner) restrita aos
 * kinds model/table/field; itens relation: ficam fora por ora. Sem relatório:
 * fonte 'missing', nenhuma execução técnica (comportamento inalterado).
 */
function loadDbIntegrityTechnicalExecutions(inventoryItems) {
  const report = loadJsonIfExists(DB_INTEGRITY_REPORT_PATH);
  if (!report || !Array.isArray(report.perModel)) {
    return { executions: [], source: 'missing', dbAvailable: null };
  }
  const stateByModel = new Map();
  for (const entry of report.perModel) {
    if (entry && typeof entry.id === 'string' && entry.id.startsWith('model:') && entry.state) {
      stateByModel.set(entry.id.slice('model:'.length), entry.state);
    }
  }
  const kinds = new Set(['model', 'table', 'field']);
  const executions = [];
  for (const item of inventoryItems || []) {
    if (item && kinds.has(item.kind) && item.model && stateByModel.has(item.model)) {
      executions.push({ itemId: item.id, state: stateByModel.get(item.model) });
    }
  }
  return {
    executions,
    source: `reports/db-integrity-report.json (${report.generatedAt || 'sem data'})`,
    dbAvailable: report.dbAvailable === true,
  };
}

/**
 * Carrega as entradas da ligação jornada ↔ cenários: aliases de domínio
 * (config/qa-waves-registry.json) e os arquivos verticais
 * qa-waves/journey-coverage/*.json. Ausentes → aliases {} e lista vazia
 * (comportamento do motor inalterado).
 */
function loadJourneyLinkInputs(scenarios) {
  const aliases = resolveDomainAliases(loadJsonIfExists(QA_WAVES_REGISTRY_PATH));
  let journeyCoverageFiles = [];
  if (fs.existsSync(JOURNEY_COVERAGE_DIR)) {
    journeyCoverageFiles = fs.readdirSync(JOURNEY_COVERAGE_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => loadJsonIfExists(path.join(JOURNEY_COVERAGE_DIR, name)))
      .filter(Boolean);
  }
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
      verticalFiles: journeyCoverageFiles.length,
      aliases: Object.keys(aliases).length,
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
  if (fs.existsSync(MESH_REGISTRY_PATH)) {
    scenarios = loadJson(MESH_REGISTRY_PATH);
    executions = buildExecutions(scenarios);
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
  const dbIntegrity = loadDbIntegrityTechnicalExecutions(inventory.items);
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
    technicalExecutions: dbIntegrity.executions,
    aliases: journeyLinks.aliases,
    journeyScenarioLinks: journeyLinks.links,
    visibilityViolations: visibility,
    tenantIsolationViolations: tenantIsolation,
    thresholds,
    waveId: 'system-coverage',
  });

  const gateItems = buildGateItems({
    inventoryItems: inventory.items,
    scenarios,
    executions,
    journeys,
    staleItemIds,
    technicalExecutions: dbIntegrity.executions,
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
      visibilitySource: visibility.source,
      fingerprintCheck: checkFingerprints,
      tenantIsolationSource: tenantIsolation.source,
      dbIntegritySource: dbIntegrity.source,
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

module.exports = { buildExecutions, loadJourneyLinkInputs, MESH_REGISTRY_PATH, SNAPSHOT_PATH, ROOT_DIR };
