#!/usr/bin/env node
'use strict';

/**
 * validate-market-discovery-runtime.js — gate do RUNTIME de market discovery
 * (T-MR1…T-MR5). Complementa `validate-market-discovery.js` (que prova a
 * POLÍTICA do subsistema) provando que o subsistema tem CHAMADOR REAL:
 *
 *   1. route_module_mounted        — o módulo de rotas existe, é instanciado
 *      em registerRoutes e MONTADO no routeRegistry (compareRouteMounts ok);
 *   2. development_classification_only — toda rota passa por
 *      `checkClassification(req, 'DEVELOPMENT')` e o router nunca aparece em
 *      montagem PRODUCTION;
 *   3. lineage_link_exercised      — a lineage Market Discovery → Benchmark
 *      Research é implementada E exercitada (openDiscoverySet grava
 *      `metadata.lineage.marketDiscoveryRunId`; lineage inválida é recusada);
 *   4. sample_generator_check_mode — o gerador
 *      `scripts/benchmark/apply-market-discovery-to-sample.js` existe e seu
 *      `--check` passa em sincronia e falha em drift (CLI real, fixture
 *      temporário, sem banco);
 *   5. holdout_order_enforced      — a ordem holdout-antes-de-pesquisa-
 *      profunda é enforced no caminho executável (pipeline + handoff);
 *   6. restart_persistence         — o estado do run sobrevive a uma NOVA
 *      instância de store contra o Postgres real; sem banco acessível o check
 *      é SKIPPED com `db_unavailable` (mesma postura dos drills do AI Control
 *      Plane: nunca PASS fabricado, nunca FAIL por ambiente).
 *
 * Saída: reports/market-discovery-runtime-report.json
 * Uso:   node --env-file-if-exists=.env scripts/governance/validate-market-discovery-runtime.js
 * Exit:  1 se qualquer check FAIL; 0 com PASS/SKIP.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT, 'reports', 'market-discovery-runtime-report.json');
const GENERATOR_PATH = path.join(ROOT, 'scripts', 'benchmark', 'apply-market-discovery-to-sample.js');

const checks = [];

function check(id, description, fn) {
  try {
    const detail = fn();
    checks.push({ id, description, status: 'PASS', detail: detail || null });
  } catch (error) {
    checks.push({ id, description, status: 'FAIL', error: error.message });
  }
}

async function checkAsync(id, description, fn) {
  try {
    const detail = await fn();
    checks.push({ id, description, status: 'PASS', detail: detail || null });
  } catch (error) {
    checks.push({ id, description, status: 'FAIL', error: error.message });
  }
}

function skip(id, description, reason) {
  checks.push({ id, description, status: 'SKIP', detail: reason });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readSource(rel) {
  const abs = path.join(ROOT, rel);
  assert(fs.existsSync(abs), `arquivo ausente: ${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

// ── 1. Módulo de rotas montado ──────────────────────────────────────────────
check('route_module_mounted', 'módulo market-discovery instanciado e montado', () => {
  const registerRoutes = readSource('api/app/registerRoutes.js');
  const routeRegistry = readSource('api/app/routeRegistry.js');
  readSource('api/modules/market-discovery/routes.js');
  readSource('api/composition/market-discovery/index.js');
  assert(registerRoutes.includes("require('../composition/market-discovery')"), 'registerRoutes não requer a composition market-discovery');
  assert(registerRoutes.includes('marketDiscoveryRouter'), 'registerRoutes não instancia marketDiscoveryRouter');
  assert(routeRegistry.includes('routers.marketDiscoveryRouter'), 'routeRegistry não monta marketDiscoveryRouter');

  const { compareRouteMounts } = require('./lib/route-mount-consistency');
  const result = compareRouteMounts({ registerRoutesSource: registerRoutes, routeRegistrySource: routeRegistry });
  assert(result.ok, `route-mounts inconsistente: ${result.detail || result.code}`);
  return 'router declarado, instanciado e montado; compareRouteMounts ok';
});

// ── 2. Classificação DEVELOPMENT-only ───────────────────────────────────────
check('development_classification_only', 'todas as rotas passam por checkClassification DEVELOPMENT; sem exposição PRODUCTION', () => {
  const routes = readSource('api/modules/market-discovery/routes.js');
  assert(routes.includes("checkClassification(req, 'DEVELOPMENT')"), 'guard DEVELOPMENT ausente do módulo de rotas');
  assert(routes.includes('canonicalResearchTenant'), 'resolução fail-closed do tenant SYSTEM ausente');
  assert(!/requireClassification\('PRODUCTION'\)/.test(routes), 'módulo expõe classificação PRODUCTION');

  // Nenhuma superfície PRODUCTION monta o router (menu/páginas públicas).
  const routeRegistry = readSource('api/app/routeRegistry.js');
  const mountLines = routeRegistry.split('\n').filter((line) => line.includes('marketDiscoveryRouter'));
  assert(mountLines.length === 1 && mountLines[0].includes('{ router: routers.marketDiscoveryRouter }'),
    'marketDiscoveryRouter montado mais de uma vez ou com path público');
  return 'guard DEVELOPMENT + tenant SYSTEM fail-closed; montagem única sem path prefix público';
});

// ── 3. Lineage exercitada ───────────────────────────────────────────────────
async function lineageLinkCheck() {
  const { createBenchmarkResearchService } = require(path.join(ROOT, 'api', 'services', 'benchmark', 'benchmarkResearchService'));
  const { createBenchmarkResearchMemoryStore } = require(path.join(ROOT, 'tests', 'helpers', 'benchmarkResearchMemoryStore'));

  const store = createBenchmarkResearchMemoryStore();
  const service = createBenchmarkResearchService({ store, now: () => '2026-09-15T12:00:00.000Z' });
  await service.openDiscoverySet({
    tenantId: 'system',
    vertical: 'gate-lineage',
    researchVersion: 'gate-lineage-v1',
    benchmarkIds: ['alpha', 'beta'],
    holdoutBenchmarkId: 'gamma',
    lineage: {
      source: 'market-discovery',
      marketDiscoveryRunId: 'mdr-gate',
      discoverySetId: 'mds-gate',
      holdoutPreregisteredAt: '2026-09-15T11:59:00.000Z',
    },
  });
  const run = await store.getRun({ tenantId: 'system', vertical: 'gate-lineage', researchVersion: 'gate-lineage-v1' });
  assert(run?.metadata?.lineage?.marketDiscoveryRunId === 'mdr-gate', 'lineage não persistida no metadata do run');

  let refused = false;
  try {
    await service.openDiscoverySet({
      tenantId: 'system',
      vertical: 'gate-lineage',
      researchVersion: 'gate-lineage-invalid',
      benchmarkIds: ['alpha'],
      lineage: { source: 'market-discovery' },
    });
  } catch (error) {
    refused = error.code === 'market_discovery_lineage_invalid';
  }
  assert(refused, 'lineage sem marketDiscoveryRunId não foi recusada');
  return 'lineage gravada e lineage inválida recusada (market_discovery_lineage_invalid)';
}

// ── 4. Gerador do sample com --check ────────────────────────────────────────
check('sample_generator_check_mode', 'apply-market-discovery-to-sample existe; --check passa em sincronia e falha em drift', () => {
  assert(fs.existsSync(GENERATOR_PATH), 'gerador ausente');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-gate-'));
  try {
    // Fixtures transitórias em os.tmpdir() (criadas e apagadas neste check) —
    // classificadas como TEMPORARY_CACHE em governance/json-persistence-audit.js.
    const samplePath = path.join(dir, 'market-discovery-gate-fixture.sample.json');
    const exportPath = path.join(dir, 'market-discovery-gate-fixture.run-export.json');
    const sample = {
      vertical: 'gate-vertical',
      sampleVersion: 'gate-v1',
      archetypes: [{ id: 'a1', importance: 'REQUIRED', status: 'ACTIVE', name: 'A1' }],
      benchmarks: [{
        id: 'legacy', name: 'Legacy', role: 'discovery', order: 1, archetype: 'a1',
        independenceGroup: 'g-legacy', sources: [{ url: 'https://legacy.example.com/', tier: 5 }], novelty: {},
      }],
      holdout: { benchmarkId: 'legacy', selectedAsHoldoutAt: '2026-09-01T00:00:00.000Z', selectionReason: 'histórico' },
    };
    const runExport = {
      runId: 'mdr-gate',
      vertical: 'gate-vertical',
      discoveryVersion: 'gate-discovery-v1',
      state: 'MARKET_DISCOVERY_HANDED_OFF',
      completedAt: '2026-09-15T12:00:00.000Z',
      discoverySetId: 'mds-gate',
      selectedCandidates: ['novo.example.com'],
      holdout: { candidateKey: 'hold.example.com', preregistered: true, preregisteredAt: '2026-09-15T11:59:00.000Z', basis: { reason: 'gate' } },
      candidates: [
        { candidateKey: 'novo.example.com', name: 'Novo', archetypes: ['a1'], independenceGroup: 'g-novo', sourceEvidence: [{ url: 'https://novo.example.com/', evidenceRef: 'ev-novo' }] },
        { candidateKey: 'hold.example.com', name: 'Hold', archetypes: ['a1'], independenceGroup: 'g-hold', sourceEvidence: [{ url: 'https://hold.example.com/', evidenceRef: 'ev-hold' }] },
      ],
    };
    fs.writeFileSync(samplePath, `${JSON.stringify(sample, null, 2)}\n`);
    fs.writeFileSync(exportPath, `${JSON.stringify(runExport, null, 2)}\n`);

    const run = (args) => spawnSync(process.execPath, [GENERATOR_PATH, ...args], { encoding: 'utf8' });
    assert(run(['--sample', samplePath, '--export', exportPath]).status === 0, 'escrita inicial falhou');
    assert(run(['--sample', samplePath, '--export', exportPath, '--check']).status === 0, '--check falhou em sincronia');

    const synced = fs.readFileSync(samplePath, 'utf8');
    assert(run(['--sample', samplePath, '--export', exportPath]).status === 0, 're-escrita falhou');
    assert(fs.readFileSync(samplePath, 'utf8') === synced, 'gerador não é idempotente');

    const drifted = JSON.parse(synced);
    drifted.marketDiscoveryProvenance.selectedCandidates = ['adulterado.example.com'];
    fs.writeFileSync(samplePath, `${JSON.stringify(drifted, null, 2)}\n`);
    const drift = run(['--sample', samplePath, '--export', exportPath, '--check']);
    assert(drift.status === 1, '--check não detectou drift');
    assert(`${drift.stdout}${drift.stderr}`.includes('DRIFT'), 'saída do drift sem código explícito');
    return 'write → check PASS; drift → check FAIL; idempotente byte a byte';
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 5. Ordem do holdout no caminho executável ───────────────────────────────
async function holdoutOrderCheck() {
  const crypto = require('crypto');
  const { createToolRegistry } = require(path.join(ROOT, 'src', 'core', 'cognitive', 'tool-registry'));
  const { createMarketDiscoverySupervisor } = require(path.join(ROOT, 'api', 'services', 'marketDiscovery', 'marketDiscoverySupervisor'));
  const { createDiscoveryHandoff, LINEAGE_ERROR_CODES } = require(path.join(ROOT, 'api', 'services', 'marketDiscovery', 'discoveryHandoff'));
  const { createMarketDiscoveryMemoryStore } = require(path.join(ROOT, 'tests', 'helpers', 'marketDiscoveryMemoryStore'));
  const { createBenchmarkResearchMemoryStore } = require(path.join(ROOT, 'tests', 'helpers', 'benchmarkResearchMemoryStore'));
  const { createBenchmarkResearchService } = require(path.join(ROOT, 'api', 'services', 'benchmark', 'benchmarkResearchService'));

  const silent = { info() {}, warn() {}, error() {}, debug() {} };
  const sha = (content) => crypto.createHash('sha256').update(String(content)).digest('hex');
  let tick = Date.parse('2026-09-15T12:00:00.000Z');
  const now = () => new Date(tick++).toISOString();
  const providers = {
    search: async () => ({
      candidates: [
        { url: 'https://alpha-gym.com/', title: 'Alpha', country: 'BR', archetypes: ['a1'], independenceGroup: 'g1' },
        { url: 'https://beta-fit.com/', title: 'Beta', country: 'BR', archetypes: ['a1'], independenceGroup: 'g2' },
        { url: 'https://gamma-gym.com/', title: 'Gamma', country: 'US', archetypes: ['a1'], independenceGroup: 'g3' },
      ],
    }),
    fetch: async (input) => ({ httpStatus: 200, content: `docs ${input.url}`, contentType: 'text/html', contentHash: sha(input.url) }),
    inspectDocumentation: async () => ({ sections: ['1', '2', '3', '4', '5', '6', '7', '8'] }),
    inspectApiDocs: async () => ({ operations: ['GET /x'] }),
    captureEvidence: async (input) => ({ evidenceRef: `ev-${sha(input.url).slice(0, 8)}`, contentHash: input.contentHash }),
  };
  const sample = {
    vertical: 'gate-holdout',
    archetypes: [{ id: 'a1', importance: 'REQUIRED', name: 'A1' }],
    benchmarks: [{ id: 'seed-1', name: 'Seed', archetype: 'a1', independenceGroup: 'g0', sources: [{ tier: 5, url: 'https://seed-gym.com/' }] }],
  };

  const store = createMarketDiscoveryMemoryStore();
  const supervisor = createMarketDiscoverySupervisor({
    store,
    registry: createToolRegistry({ logger: silent }),
    providers,
    tenantId: 'system',
    now,
    logger: silent,
    selection: { size: 2 },
  });
  const result = await supervisor.discover({ vertical: 'gate-holdout', discoveryVersion: 'gate-holdout-v1', sample });
  assert(result.status === 'MARKET_DISCOVERY_COMPLETED', `run não completou: ${result.status}`);

  const set = await store.getDiscoverySet({ tenantId: 'system', setId: result.discoverySet.id });
  assert(set.holdout_preregistered === true, 'holdout não pré-registrado');
  assert(Date.parse(set.holdout_selected_at) < Date.parse(set.opened_at), 'pré-registro não é estritamente anterior à abertura');
  const holdout = await store.getCandidate({ tenantId: 'system', vertical: 'gate-holdout', candidateKey: set.holdout_candidate_id });
  assert(!holdout.deep_research_at, 'holdout com deep_research_at antes do handoff');

  // E o handoff é fail-closed sem pré-registro.
  const rawRun = await store.openRun({ tenantId: 'system', vertical: 'gate-holdout', discoveryVersion: 'gate-raw-v1' });
  await store.upsertCandidate({
    tenantId: 'system',
    runId: rawRun.id,
    candidate: { vertical: 'gate-holdout', candidateKey: 'alpha.example.com', name: 'Alpha', state: 'ACCEPTED', sourceEvidence: [{ url: 'https://alpha.example.com/', evidenceRef: 'ev-1' }] },
  });
  const rawSet = await store.recordDiscoverySet({
    tenantId: 'system',
    runId: rawRun.id,
    set: { vertical: 'gate-holdout', discoverySetVersion: 'gate-raw-v1', selectedCandidates: ['alpha.example.com'] },
  });
  const handoff = createDiscoveryHandoff({
    marketStore: store,
    benchmarkService: createBenchmarkResearchService({ store: createBenchmarkResearchMemoryStore(), now }),
    now,
  });
  let refused = false;
  try {
    await handoff.openBenchmarkResearchRun({
      tenantId: 'system',
      handoff: {
        vertical: 'gate-holdout',
        researchVersion: 'gate-raw-v1-deep-research',
        benchmarkIds: ['alpha.example.com'],
        holdoutBenchmarkId: null,
        discoverySetId: rawSet.id,
        discoveryRunId: rawRun.id,
        holdoutPreregisteredAt: null,
      },
    });
  } catch (error) {
    refused = error.code === LINEAGE_ERROR_CODES.HOLDOUT_NOT_PREREGISTERED;
  }
  assert(refused, 'handoff sem pré-registro não foi recusado');
  return 'pré-registro estritamente anterior à abertura; handoff sem pré-registro recusado';
}

// ── 6. Persistência pós-restart contra Postgres real ────────────────────────
async function restartPersistenceCheck() {
  const { connect, getSequelize, close } = require(path.join(ROOT, 'api', 'db', 'sequelize'));
  await connect();
  const sequelize = getSequelize();
  if (!sequelize) throw new Error('db_unavailable: sequelize não inicializado');
  await sequelize.authenticate();

  const { createMarketDiscoveryStore } = require(path.join(ROOT, 'api', 'services', 'marketDiscovery', 'marketDiscoveryStore'));
  const instanceA = createMarketDiscoveryStore();
  const opened = await instanceA.openRun({
    tenantId: 'system',
    vertical: '__gate_restart_probe__',
    discoveryVersion: 'runtime-gate-v1',
    startedAt: '2026-09-15T12:00:00.000Z',
    metadata: { probe: 'runtime-gate' },
  });
  await instanceA.updateRunState({ tenantId: 'system', runId: opened.id, state: 'MARKET_SCANNED', metadata: { gateStage: 'scanned' } });

  // "Restart": outra instância de store, mesma autoridade (o banco).
  const instanceB = createMarketDiscoveryStore();
  const reread = await instanceB.getRunById({ tenantId: 'system', runId: opened.id });
  assert(reread, 'instância B não releu o run');
  const state = reread.state;
  const metadata = reread.metadata || {};
  assert(state === 'MARKET_SCANNED', `estado relido diverge: ${state}`);
  assert(metadata.gateStage === 'scanned', 'metadata relida diverge');

  const reopened = await instanceB.openRun({
    tenantId: 'system',
    vertical: '__gate_restart_probe__',
    discoveryVersion: 'runtime-gate-v1',
    startedAt: '2026-09-16T00:00:00.000Z',
  });
  assert(reopened.id === opened.id, 'reabertura não foi idempotente');
  return `run ${opened.id} relido por nova instância com estado/metadata íntegros`;
}

async function main() {
  await checkAsync('lineage_link_exercised', 'openDiscoverySet persiste metadata.lineage.marketDiscoveryRunId e recusa lineage inválida', lineageLinkCheck);

  await checkAsync('holdout_order_enforced', 'holdout pré-registrado ANTES de pesquisa profunda no caminho executável', holdoutOrderCheck);

  // Restart contra Postgres real: disponível → executa; indisponível → SKIP
  // honesto (db_unavailable), nunca PASS fabricado.
  let dbAvailable = false;
  try {
    const { connect, getSequelize } = require(path.join(ROOT, 'api', 'db', 'sequelize'));
    await connect();
    const sequelize = getSequelize();
    if (!sequelize) throw new Error('db_unavailable');
    await sequelize.authenticate();
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
  if (dbAvailable) {
    await checkAsync('restart_persistence', 'estado do run sobrevive a nova instância de store (Postgres real)', async () => {
      const detail = await restartPersistenceCheck();
      const { close } = require(path.join(ROOT, 'api', 'db', 'sequelize'));
      if (typeof close === 'function') await close().catch(() => {});
      return detail;
    });
  } else {
    skip('restart_persistence', 'estado do run sobrevive a nova instância de store (Postgres real)', 'db_unavailable: Postgres inacessível neste ambiente — check exige banco real e NÃO fabrica PASS');
  }

  // 7. Suíte de testes presente (o gate não substitui o Jest).
  check('runtime_tests_present', 'suítes Jest do runtime de market discovery presentes', () => {
    for (const rel of [
      'tests/unit/marketDiscovery/runtimeRoutes.test.js',
      'tests/unit/marketDiscovery/benchmarkLineage.test.js',
      'tests/unit/marketDiscovery/restartPersistence.test.js',
      'tests/unit/benchmark/applyMarketDiscoveryToSample.test.js',
    ]) {
      assert(fs.existsSync(path.join(ROOT, rel)), `suíte ausente: ${rel}`);
    }
    return '4 suítes presentes';
  });

  const failed = checks.filter((c) => c.status === 'FAIL');
  const skipped = checks.filter((c) => c.status === 'SKIP');
  const report = {
    gate: 'market-discovery-runtime',
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    generatedAt: new Date().toISOString(),
    totals: { checks: checks.length, passed: checks.length - failed.length - skipped.length, failed: failed.length, skipped: skipped.length },
    checks,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  for (const c of checks) {
    const icon = c.status === 'PASS' ? '✅' : (c.status === 'SKIP' ? '⏭️' : '❌');
    console.log(`${icon} ${c.id} — ${c.description}`);
    if (c.detail) console.log(`    ${c.detail}`);
    if (c.error) console.log(`    ${c.error}`);
  }
  console.log('');
  console.log('relatório: reports/market-discovery-runtime-report.json');

  if (failed.length > 0) {
    console.log(`FAIL: ${checks.length - failed.length}/${checks.length} checks`);
    process.exit(1);
  }
  console.log(`PASS: ${checks.length}/${checks.length} checks (${skipped.length} skipped)`);
}

main().catch((error) => {
  console.error(`market-discovery-runtime gate error: ${error.message}`);
  process.exit(1);
});
