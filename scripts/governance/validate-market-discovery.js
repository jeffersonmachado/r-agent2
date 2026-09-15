#!/usr/bin/env node
'use strict';

/**
 * validate-market-discovery.js — gate da camada AUTÔNOMA DE DESCOBERTA DE
 * MERCADO (a camada ANTERIOR ao Discovery Set de benchmarks).
 *
 * Invariantes verificados EXECUTAVELMENTE (não é inspeção documental):
 *  1. os módulos do subsistema existem (store, supervisor, archetypes,
 *     candidates, independence, selection, holdout, models, migration);
 *  2. o supervisor é superfície DEVELOPMENT com tenant SYSTEM e nunca é
 *     montado como rota PRODUCTION;
 *  3. arquétipos são evidence-based: sem evidência NÃO há ACCEPTED, e os
 *     arquétipos fitness `financial-billing`/`student-digital-experience`
 *     são REVALIDADOS (nunca removidos para forçar PASS);
 *  4. candidatos são evidence-based: seeds são referência, descoberto sem
 *     evidência não entra no universo aceito;
 *  5. clone/white-label não conta como diversidade real;
 *  6. a seleção do Discovery Set é determinística e auditável;
 *  7. o holdout é pré-registrado ANTES de pesquisa profunda; leakage → FAIL;
 *  8. persistência fail-closed: o store exige Sequelize (`persistence_required`)
 *     e não contém fallback em memória (o store em memória só existe em
 *     `tests/helpers/`).
 *
 * Saída: `reports/market-discovery-report.json` (versionado).
 * Uso: node scripts/governance/validate-market-discovery.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..', '..');
const SUBSYSTEM_DIR = path.join(ROOT_DIR, 'api', 'services', 'marketDiscovery');
const FITNESS_SAMPLE_PATH = path.join(ROOT_DIR, 'config', 'benchmarks', 'fitness.json');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'market-discovery-report.json');

const REQUIRED_FILES = Object.freeze([
  'api/services/marketDiscovery/marketDiscoveryStore.js',
  'api/services/marketDiscovery/marketDiscoverySupervisor.js',
  'api/services/marketDiscovery/archetypeDiscovery.js',
  'api/services/marketDiscovery/candidateDiscovery.js',
  'api/services/marketDiscovery/independence.js',
  'api/services/marketDiscovery/discoverySetSelection.js',
  'api/services/marketDiscovery/holdoutPreregistration.js',
  'api/db/models/MarketDiscoveryRun.js',
  'api/db/models/MarketArchetype.js',
  'api/db/models/MarketCandidate.js',
  'api/db/models/MarketDiscoverySet.js',
  'api/db/migrations/20260915120000-create-market-discovery.js',
  'tests/helpers/marketDiscoveryMemoryStore.js',
]);

const VIOLATION_CODES = Object.freeze({
  MODULE_MISSING: 'market_discovery_module_missing',
  SUPERVISOR_NOT_DEVELOPMENT: 'market_discovery_supervisor_not_development_only',
  SUPERVISOR_ROUTE_EXPOSED: 'market_discovery_route_exposed_to_production',
  ARCHETYPE_WITHOUT_EVIDENCE_ACCEPTED: 'market_discovery_archetype_without_evidence_accepted',
  ARCHETYPE_REVALIDATION_BROKEN: 'market_discovery_archetype_revalidation_broken',
  CANDIDATE_WITHOUT_EVIDENCE_ACCEPTED: 'market_discovery_candidate_without_evidence_accepted',
  INDEPENDENCE_COLLAPSE_BROKEN: 'market_discovery_independence_collapse_broken',
  SELECTION_NOT_DETERMINISTIC: 'market_discovery_selection_not_deterministic',
  HOLDOUT_LEAKAGE_NOT_DETECTED: 'market_discovery_holdout_leakage_not_detected',
  HOLDOUT_HEALTHY_REJECTED: 'market_discovery_holdout_healthy_rejected',
  PERSISTENCE_NOT_FAIL_CLOSED: 'market_discovery_persistence_not_fail_closed',
  MEMORY_FALLBACK_IN_PRODUCTION_CODE: 'market_discovery_memory_fallback_in_production_code',
});

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function violation(code, detail = {}) {
  return { code, ...detail };
}

function check(id, description, fn, checks, violations) {
  try {
    const detail = fn();
    checks.push({ id, description, status: 'PASS', ...(detail ? { detail } : {}) });
  } catch (error) {
    checks.push({ id, description, status: 'FAIL', reason: error.message });
    violations.push(...(error.violations || [violation(error.code || 'market_discovery_check_failed', { check: id, reason: error.message })]));
  }
}

function expect(condition, code, message, violations) {
  if (!condition) {
    const error = new Error(message);
    error.violations = violations || [violation(code, { reason: message })];
    throw error;
  }
}

async function run() {
  const checks = [];
  const violations = [];

  // ── 1. Artefatos obrigatórios (fail-closed) ────────────────────────────
  const missing = REQUIRED_FILES.filter((file) => !fs.existsSync(path.join(ROOT_DIR, file)));
  check('artifacts', 'artefatos do subsistema existem', () => {
    expect(missing.length === 0, VIOLATION_CODES.MODULE_MISSING, `artefatos ausentes: ${missing.join(', ')}`,
      missing.map((file) => violation(VIOLATION_CODES.MODULE_MISSING, { file })));
    return { files: REQUIRED_FILES.length };
  }, checks, violations);
  if (missing.length > 0) return { checks, violations };

  const storeModule = require(path.join(SUBSYSTEM_DIR, 'marketDiscoveryStore.js'));
  const supervisorModule = require(path.join(SUBSYSTEM_DIR, 'marketDiscoverySupervisor.js'));
  const archetypes = require(path.join(SUBSYSTEM_DIR, 'archetypeDiscovery.js'));
  const candidates = require(path.join(SUBSYSTEM_DIR, 'candidateDiscovery.js'));
  const independence = require(path.join(SUBSYSTEM_DIR, 'independence.js'));
  const selection = require(path.join(SUBSYSTEM_DIR, 'discoverySetSelection.js'));
  const holdout = require(path.join(SUBSYSTEM_DIR, 'holdoutPreregistration.js'));

  // ── 2. Supervisor DEVELOPMENT-only, tenant SYSTEM ──────────────────────
  check('supervisor_classification', 'supervisor é DEVELOPMENT-only com tenant SYSTEM', () => {
    const capability = supervisorModule.MARKET_DISCOVERY_CAPABILITY;
    const principal = supervisorModule.buildDiscoveryPrincipal();
    const bad = [];
    if (capability.visibility !== 'DEVELOPMENT') bad.push(violation(VIOLATION_CODES.SUPERVISOR_NOT_DEVELOPMENT, { field: 'capability.visibility', value: capability.visibility }));
    if (principal.classification !== 'DEVELOPMENT') bad.push(violation(VIOLATION_CODES.SUPERVISOR_NOT_DEVELOPMENT, { field: 'principal.classification', value: principal.classification }));
    if (principal.tenant !== 'system') bad.push(violation(VIOLATION_CODES.SUPERVISOR_NOT_DEVELOPMENT, { field: 'principal.tenant', value: principal.tenant }));
    if (principal.domain !== 'SYSTEM') bad.push(violation(VIOLATION_CODES.SUPERVISOR_NOT_DEVELOPMENT, { field: 'principal.domain', value: principal.domain }));
    if (capability.sideEffects !== false) bad.push(violation(VIOLATION_CODES.SUPERVISOR_NOT_DEVELOPMENT, { field: 'capability.sideEffects', value: capability.sideEffects }));
    expect(bad.length === 0, VIOLATION_CODES.SUPERVISOR_NOT_DEVELOPMENT, 'supervisor fora da classificação DEVELOPMENT/SYSTEM', bad);
    return { visibility: capability.visibility, tenant: principal.tenant };
  }, checks, violations);

  // ── 2b. Nenhuma rota HTTP expõe o subsistema ───────────────────────────
  check('no_http_route', 'nenhuma rota registrada monta o subsistema de descoberta', () => {
    const routeFiles = ['api/app/registerRoutes.js', 'api/app/routeRegistry.js'];
    const bad = [];
    for (const file of routeFiles) {
      const abs = path.join(ROOT_DIR, file);
      if (!fs.existsSync(abs)) continue;
      const source = fs.readFileSync(abs, 'utf8');
      if (/marketDiscovery/i.test(source)) {
        bad.push(violation(VIOLATION_CODES.SUPERVISOR_ROUTE_EXPOSED, { file }));
      }
    }
    expect(bad.length === 0, VIOLATION_CODES.SUPERVISOR_ROUTE_EXPOSED, 'subsistema montado em rotas HTTP', bad);
    return { inspected: routeFiles };
  }, checks, violations);

  // ── 3. Arquétipos evidence-based + revalidação fitness ─────────────────
  check('archetypes_evidence', 'arquétipo sem evidência nunca é ACCEPTED', () => {
    const withoutEvidence = archetypes.evaluateArchetypeAcceptance({ archetypeKey: 'x', name: 'X', sourceEvidence: [] });
    const invalidEvidence = archetypes.evaluateArchetypeAcceptance({ archetypeKey: 'x', name: 'X', sourceEvidence: [{ note: 'texto livre' }] });
    const withEvidence = archetypes.evaluateArchetypeAcceptance({
      archetypeKey: 'x', name: 'X',
      sourceEvidence: [{ url: 'https://x.example.com/', evidenceRef: 'ev-1', contentHash: 'sha256:a' }],
    });
    const bad = [];
    if (withoutEvidence.accepted) bad.push(violation(VIOLATION_CODES.ARCHETYPE_WITHOUT_EVIDENCE_ACCEPTED, { case: 'empty' }));
    if (invalidEvidence.accepted) bad.push(violation(VIOLATION_CODES.ARCHETYPE_WITHOUT_EVIDENCE_ACCEPTED, { case: 'free_text' }));
    if (!withEvidence.accepted) bad.push(violation(VIOLATION_CODES.ARCHETYPE_REVALIDATION_BROKEN, { case: 'valid_evidence_rejected' }));
    expect(bad.length === 0, VIOLATION_CODES.ARCHETYPE_WITHOUT_EVIDENCE_ACCEPTED, 'aceitação de arquétipo não é evidence-based', bad);
  }, checks, violations);

  check('fitness_archetype_revalidation', 'financial-billing e student-digital-experience são REVALIDADOS, nunca removidos', () => {
    expect(fs.existsSync(FITNESS_SAMPLE_PATH), VIOLATION_CODES.ARCHETYPE_REVALIDATION_BROKEN, 'config/benchmarks/fitness.json ausente');
    const sample = JSON.parse(fs.readFileSync(FITNESS_SAMPLE_PATH, 'utf8'));
    const declared = (sample.archetypes || []).map((a) => ({ ...a, vertical: 'fitness' }));
    const mustRevalidate = ['financial-billing', 'student-digital-experience'];
    const bad = [];
    for (const key of mustRevalidate) {
      if (!declared.some((a) => a.id === key)) bad.push(violation(VIOLATION_CODES.ARCHETYPE_REVALIDATION_BROKEN, { archetype: key, reason: 'removed_from_config' }));
    }
    const { records, accepted, rejected } = archetypes.revalidateArchetypes({ declared, evidenceByArchetype: {} });
    // Sem evidência deste run: NADA aceito, NADA rejeitado, TUDO retido.
    if (accepted.length > 0) bad.push(violation(VIOLATION_CODES.ARCHETYPE_WITHOUT_EVIDENCE_ACCEPTED, { accepted }));
    if (rejected.length > 0) bad.push(violation(VIOLATION_CODES.ARCHETYPE_REVALIDATION_BROKEN, { rejected, reason: 'rejection_without_evidence' }));
    for (const key of mustRevalidate) {
      if (!records.some((r) => r.archetypeKey === key)) bad.push(violation(VIOLATION_CODES.ARCHETYPE_REVALIDATION_BROKEN, { archetype: key, reason: 'dropped_by_revalidation' }));
    }
    expect(bad.length === 0, VIOLATION_CODES.ARCHETYPE_REVALIDATION_BROKEN, 'revalidação de arquétipos fitness violada', bad);
    return { declared: declared.length, retainedWithoutEvidence: records.length };
  }, checks, violations);

  // ── 4. Candidatos evidence-based ───────────────────────────────────────
  check('candidates_evidence', 'candidato sem evidência não entra no universo aceito', () => {
    const zeroEvidence = candidates.discoverCandidates({
      vertical: 'fitness',
      seeds: [],
      researchResults: [{ name: 'Relevante Sem Prova', rationale: 'agente achou relevante', sourceEvidence: [] }],
    });
    const withEvidence = candidates.discoverCandidates({
      vertical: 'fitness',
      seeds: [],
      researchResults: [{
        name: 'Novo', sourceEvidence: [{ url: 'https://n.example.com/', evidenceRef: 'ev-n', contentHash: 'sha256:n' }],
      }],
    });
    const bad = [];
    if (zeroEvidence.accepted.length > 0) bad.push(violation(VIOLATION_CODES.CANDIDATE_WITHOUT_EVIDENCE_ACCEPTED, { case: 'zero_evidence' }));
    if (withEvidence.accepted.length !== 1) bad.push(violation(VIOLATION_CODES.CANDIDATE_WITHOUT_EVIDENCE_ACCEPTED, { case: 'valid_evidence_not_accepted' }));
    expect(bad.length === 0, VIOLATION_CODES.CANDIDATE_WITHOUT_EVIDENCE_ACCEPTED, 'aceitação de candidato não é evidence-based', bad);
  }, checks, violations);

  // ── 5. Independência: clone/white-label não conta como diversidade ─────
  check('independence', 'clone/white-label colapsa no grupo econômico efetivo', () => {
    const universe = [
      { candidateKey: 'gymnovo', independenceGroup: 'gymnovo' },
      { candidateKey: 'gymnovo-wl', independenceGroup: 'grupo-proprio', cloneOf: 'gymnovo' },
    ];
    const report = independence.independenceReport(universe);
    const bad = [];
    if (report.independentCount !== 1) bad.push(violation(VIOLATION_CODES.INDEPENDENCE_COLLAPSE_BROKEN, { independentCount: report.independentCount }));
    if (report.clones.length !== 1) bad.push(violation(VIOLATION_CODES.INDEPENDENCE_COLLAPSE_BROKEN, { clones: report.clones }));
    expect(bad.length === 0, VIOLATION_CODES.INDEPENDENCE_COLLAPSE_BROKEN, 'clones contados como diversidade', bad);
    return { independentCount: report.independentCount, totalCandidates: report.totalCandidates };
  }, checks, violations);

  // ── 6. Seleção determinística do Discovery Set ─────────────────────────
  check('selection_deterministic', 'o mesmo universo produz sempre o mesmo discovery set', () => {
    const pool = [
      { candidateKey: 'a', archetypes: ['independent-gym'], country: 'BR', independenceGroup: 'a', segments: [], targetCustomers: [], profile: null },
      { candidateKey: 'b', archetypes: ['financial-billing'], country: 'US', independenceGroup: 'b', segments: [], targetCustomers: [], profile: null },
      { candidateKey: 'c', archetypes: ['student-digital-experience'], country: 'IE', independenceGroup: 'c', segments: [], targetCustomers: [], profile: null },
    ];
    const archetypeKeys = ['independent-gym', 'financial-billing', 'student-digital-experience'];
    const first = selection.selectDiscoverySet({ candidates: pool, acceptedArchetypeKeys: archetypeKeys, size: 2 });
    const second = selection.selectDiscoverySet({ candidates: [...pool].reverse(), acceptedArchetypeKeys: archetypeKeys, size: 2 });
    const bad = [];
    if (JSON.stringify(first.selected) !== JSON.stringify(second.selected)) {
      bad.push(violation(VIOLATION_CODES.SELECTION_NOT_DETERMINISTIC, { first: first.selected, second: second.selected }));
    }
    if (!Array.isArray(first.rationale) || first.rationale.length !== first.selected.length) {
      bad.push(violation(VIOLATION_CODES.SELECTION_NOT_DETERMINISTIC, { reason: 'rationale_missing' }));
    }
    expect(bad.length === 0, VIOLATION_CODES.SELECTION_NOT_DETERMINISTIC, 'seleção não determinística', bad);
    return { selected: first.selected };
  }, checks, violations);

  // ── 7. Holdout pré-registrado antes de pesquisa profunda; leakage FAIL ─
  check('holdout_no_leakage', 'leakage temporal do holdout é FAIL; fluxo íntegro passa', () => {
    const leaked = holdout.evaluateHoldoutLeakage({
      holdout: { candidateId: 'h', selectedAt: '2026-09-15T12:00:00.000Z', preregistered: true },
      candidate: { candidateKey: 'h', deep_research_at: '2026-09-15T11:00:00.000Z' },
    });
    const notPreregistered = holdout.evaluateHoldoutLeakage({
      holdout: { candidateId: 'h', selectedAt: null, preregistered: false },
      candidate: { candidateKey: 'h' },
    });
    const healthy = holdout.evaluateHoldoutLeakage({
      holdout: { candidateId: 'h', selectedAt: '2026-09-15T12:00:00.000Z', preregistered: true },
      candidate: { candidateKey: 'h', deep_research_at: '2026-09-15T13:00:00.000Z' },
      discoverySetKeys: ['a', 'b'],
    });
    const bad = [];
    if (leaked.status !== 'FAIL' || !leaked.violations.some((v) => v.reason === 'holdout_leakage_analyzed_before_preregistration')) {
      bad.push(violation(VIOLATION_CODES.HOLDOUT_LEAKAGE_NOT_DETECTED, { case: 'analyzed_before_preregistration' }));
    }
    if (notPreregistered.status !== 'FAIL' || !notPreregistered.violations.some((v) => v.reason === 'holdout_not_preregistered')) {
      bad.push(violation(VIOLATION_CODES.HOLDOUT_LEAKAGE_NOT_DETECTED, { case: 'not_preregistered' }));
    }
    if (healthy.status !== 'PASS') {
      bad.push(violation(VIOLATION_CODES.HOLDOUT_HEALTHY_REJECTED, { violations: healthy.violations }));
    }
    expect(bad.length === 0, VIOLATION_CODES.HOLDOUT_LEAKAGE_NOT_DETECTED, 'anti-leakage do holdout violado', bad);
  }, checks, violations);

  // ── 8. Persistência fail-closed + sem fallback em memória ──────────────
  await (async () => {
    const id = 'persistence_fail_closed';
    const description = 'store exige Sequelize e não tem fallback em memória';
    try {
      let rejected = null;
      try {
        const store = storeModule.createMarketDiscoveryStore();
        await store.getRun({ tenantId: 'system', vertical: 'fitness' });
      } catch (error) {
        rejected = error;
      }
      const bad = [];
      if (!rejected || rejected.code !== storeModule.ERROR_CODES.PERSISTENCE_REQUIRED) {
        bad.push(violation(VIOLATION_CODES.PERSISTENCE_NOT_FAIL_CLOSED, { received: rejected ? rejected.code : 'resolved' }));
      }
      const storeSource = fs.readFileSync(path.join(SUBSYSTEM_DIR, 'marketDiscoveryStore.js'), 'utf8');
      if (/new Map\(/.test(storeSource)) {
        bad.push(violation(VIOLATION_CODES.MEMORY_FALLBACK_IN_PRODUCTION_CODE, { file: 'api/services/marketDiscovery/marketDiscoveryStore.js' }));
      }
      const memoryHelperOutsideTests = [];
      for (const dir of ['api', 'src', 'engine', 'core']) {
        const dirAbs = path.join(ROOT_DIR, dir);
        if (!fs.existsSync(dirAbs)) continue;
        let matches = '';
        try {
          matches = execFileSync('grep', ['-rlE', "require\\(['\"][^'\"]*marketDiscoveryMemoryStore", dirAbs], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
        } catch {
          matches = ''; // grep exit 1 = nenhuma ocorrência (resultado esperado)
        }
        for (const entry of matches.split('\n').filter(Boolean)) {
          memoryHelperOutsideTests.push(entry);
        }
      }
      if (memoryHelperOutsideTests.length > 0) {
        bad.push(violation(VIOLATION_CODES.MEMORY_FALLBACK_IN_PRODUCTION_CODE, { files: memoryHelperOutsideTests }));
      }
      expect(bad.length === 0, VIOLATION_CODES.PERSISTENCE_NOT_FAIL_CLOSED, 'persistência não é fail-closed', bad);
      checks.push({ id, description, status: 'PASS', detail: { errorCode: storeModule.ERROR_CODES.PERSISTENCE_REQUIRED } });
    } catch (error) {
      checks.push({ id, description, status: 'FAIL', reason: error.message });
      violations.push(...(error.violations || [violation(VIOLATION_CODES.PERSISTENCE_NOT_FAIL_CLOSED, { reason: error.message })]));
    }
  })();

  return { checks, violations };
}

async function main() {
  const { checks, violations } = await run();
  const report = {
    reportType: 'market-discovery',
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    checksExecuted: checks.length,
    checksPassed: checks.filter((c) => c.status === 'PASS').length,
    checks,
    violations,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[market-discovery] status=${report.status} checks=${report.checksPassed}/${report.checksExecuted} violações=${violations.length}\n`,
    );
    for (const c of checks) process.stdout.write(`  - ${c.id}: ${c.status}${c.reason ? ` (${c.reason})` : ''}\n`);
    for (const v of violations) process.stdout.write(`  ! ${v.code}: ${JSON.stringify(v)}\n`);
  }
  process.exit(violations.length === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[market-discovery] falha fatal: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { run, main, VIOLATION_CODES, REQUIRED_FILES, REPORT_PATH };
