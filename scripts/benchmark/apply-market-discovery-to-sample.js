#!/usr/bin/env node
'use strict';

/**
 * apply-market-discovery-to-sample.js — GERADOR que aplica a saída de um run
 * de MARKET DISCOVERY ao sample versionado (`config/benchmarks/<vertical>.json`).
 *
 * Por que existe (T-MR3, 2026-09-15): quando a descoberta de mercado revalida
 * arquétipos/candidatos e produz um NOVO discovery set, o sample versionado
 * precisa refletir essa verdade — mas NUNCA por edição manual apresentada
 * como saída de runtime. O único caminho legítimo é este gerador:
 * determinístico, idempotente, com proveniência por item
 * (`marketDiscoveryRunId` + `appliedAt` = `completedAt` do run + evidenceRefs
 * de cada candidato) e `--check` que detecta drift.
 *
 * Fontes do run (nesta ordem):
 *   --export <arquivo.json>   export do run (ver `buildRunExport` / saída de
 *                             GET /api/market-discovery/runs/:runId);
 *   (default)                 Postgres real via marketDiscoveryStore —
 *                             `--run-id <id>` ou `--vertical <v>` (run mais
 *                             recente). Sem banco: `persistence_required`,
 *                             NUNCA fallback.
 *
 * Recusas fail-closed (nada é escrito):
 *   - run não concluído (state ≠ MARKET_DISCOVERY_HANDED_OFF);
 *   - holdout não pré-registrado;
 *   - candidato selecionado sem evidência (`evidenceRef`);
 *   - sample resultante não avaliável pelo engine de suficiência.
 *
 * Chaves gerenciadas (apenas estas são tocadas): `benchmarks` (apenas as
 * entradas cuja `provenance.generator` é ESTE gerador), `holdout` e
 * `marketDiscoveryProvenance`. Todo o resto do sample é preservado byte a
 * byte em conteúdo.
 *
 * Uso:
 *   node scripts/benchmark/apply-market-discovery-to-sample.js --export run.json
 *   node scripts/benchmark/apply-market-discovery-to-sample.js --run-id mdr-...
 *   node scripts/benchmark/apply-market-discovery-to-sample.js --check ...
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const GENERATOR_ID = 'scripts/benchmark/apply-market-discovery-to-sample.js';

const ERROR_CODES = Object.freeze({
  SOURCE_REQUIRED: 'market_run_source_required',
  RUN_NOT_FOUND: 'market_discovery_run_not_found',
  RUN_NOT_COMPLETED: 'market_run_not_completed',
  HOLDOUT_NOT_PREREGISTERED: 'market_run_holdout_not_preregistered',
  EVIDENCE_MISSING: 'market_run_evidence_missing',
  SAMPLE_NOT_EVALUABLE: 'market_sample_not_evaluable',
  DRIFT: 'market_discovery_sample_drift_detected',
});

/** Chaves do sample gerenciadas por este gerador. */
const MANAGED_KEYS = Object.freeze([
  'benchmarks',
  'holdout',
  'marketDiscoveryProvenance',
]);

function generatorError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function plain(row) {
  if (!row) return null;
  if (typeof row.get === 'function') return row.get({ plain: true });
  return JSON.parse(JSON.stringify(row));
}

function evidenceRefsOf(candidate) {
  return list(candidate?.sourceEvidence ?? candidate?.source_evidence)
    .map((item) => String(item?.evidenceRef || '').trim())
    .filter(Boolean)
    .sort();
}

/**
 * Fontes DECLARADAS do benchmark derivado — o plano de deep research
 * (`buildResearchPlanFromSample`) ignora benchmark sem `sources`, então a
 * entrada aplicada precisa carregá-las ou jamais seria pesquisada. As fontes
 * vêm da EVIDÊNCIA persistida do run (URL + tier + hash), nunca inventadas;
 * o site oficial entra como fonte declarada ainda que a evidência aponte
 * para uma página específica do domínio.
 */
function declaredSourcesOf(candidate) {
  const byUrl = new Map();
  for (const item of list(candidate?.sourceEvidence ?? candidate?.source_evidence)) {
    const url = String(item?.url || '').trim();
    if (!url || byUrl.has(url)) continue;
    byUrl.set(url, {
      url,
      tier: Number.isFinite(Number(item?.tier)) ? Number(item.tier) : 5,
      specificity: 'official',
      provenance: {
        evidenceRef: item?.evidenceRef ? String(item.evidenceRef) : null,
        contentHash: item?.contentHash ? String(item.contentHash) : null,
      },
    });
  }
  const site = String(candidate?.officialSite || candidate?.official_site || '').trim();
  if (site && !byUrl.has(site)) {
    byUrl.set(site, { url: site, tier: 5, specificity: 'official' });
  }
  const apiDocs = String(candidate?.apiDocs || candidate?.api_docs || '').trim();
  if (apiDocs && !byUrl.has(apiDocs)) {
    byUrl.set(apiDocs, { url: apiDocs, tier: 5, specificity: 'api-docs' });
  }
  return [...byUrl.values()];
}

function candidateEntry(candidate, { role, order, runExport }) {
  return {
    id: String(candidate.candidateKey || candidate.candidate_key),
    name: String(candidate.name || candidate.candidateKey || candidate.candidate_key),
    role,
    order,
    archetype: list(candidate.archetypes)[0] || null,
    independenceGroup: candidate.independenceGroup || candidate.independence_group || null,
    cloneOf: candidate.cloneOf || candidate.clone_of || null,
    officialSite: candidate.officialSite || candidate.official_site || null,
    sources: declaredSourcesOf(candidate),
    country: candidate.country || null,
    segments: list(candidate.segments),
    targetCustomers: list(candidate.targetCustomers || candidate.target_customers),
    archetypes: list(candidate.archetypes),
    provenance: {
      generator: GENERATOR_ID,
      marketDiscoveryRunId: String(runExport.runId),
      discoverySetId: String(runExport.discoverySetId),
      appliedAt: String(runExport.completedAt),
      evidenceRefs: evidenceRefsOf(candidate),
    },
  };
}

/**
 * Núcleo PURO e determinístico: mesmo sample + mesmo run export → mesma
 * saída, sem relógio nem rede. `appliedAt` é o `completedAt` do run (fato
 * persistido), nunca o relógio do gerador.
 *
 * @param {object} args
 * @param {object} args.sample     sample versionado atual
 * @param {object} args.runExport  export do run de market discovery
 * @returns {object} novo sample (o original nunca é mutado)
 */
function applyMarketDiscoveryToSample({ sample, runExport }) {
  if (!sample || typeof sample !== 'object') {
    throw generatorError(ERROR_CODES.SOURCE_REQUIRED, 'sample é obrigatório');
  }
  if (!runExport || typeof runExport !== 'object' || !isNonEmptyString(runExport.runId)) {
    throw generatorError(ERROR_CODES.SOURCE_REQUIRED, 'run export com runId é obrigatório');
  }
  if (String(runExport.state || '') !== 'MARKET_DISCOVERY_HANDED_OFF') {
    throw generatorError(
      ERROR_CODES.RUN_NOT_COMPLETED,
      `run ${runExport.runId} não concluído (state=${runExport.state || 'ausente'}): só runs HANDED_OFF viram sample`,
    );
  }
  const holdout = runExport.holdout || {};
  if (holdout.preregistered !== true || !isNonEmptyString(holdout.candidateKey) || !isNonEmptyString(holdout.preregisteredAt)) {
    throw generatorError(
      ERROR_CODES.HOLDOUT_NOT_PREREGISTERED,
      `run ${runExport.runId} sem holdout pré-registrado: o sample nunca reflete pesquisa sem pré-registro`,
    );
  }

  const selected = list(runExport.selectedCandidates).map((key) => String(key));
  const candidatesByKey = new Map(
    list(runExport.candidates).map((candidate) => [String(candidate.candidateKey || candidate.candidate_key), candidate]),
  );
  const requiredKeys = [...selected, String(holdout.candidateKey)];
  for (const key of requiredKeys) {
    const candidate = candidatesByKey.get(key);
    if (!candidate) {
      throw generatorError(ERROR_CODES.EVIDENCE_MISSING, `candidato ${key} ausente do export do run ${runExport.runId}`);
    }
    if (evidenceRefsOf(candidate).length === 0) {
      throw generatorError(
        ERROR_CODES.EVIDENCE_MISSING,
        `candidato ${key} sem evidência (evidenceRef) no run ${runExport.runId}: proveniência fabricada é proibida`,
      );
    }
  }

  const next = JSON.parse(JSON.stringify(sample));

  // Benchmarks: entradas gerenciadas por ESTE gerador são re-derivadas; as
  // demais (análises anteriores, seeds históricos) são preservadas intactas.
  const preserved = list(next.benchmarks).filter((entry) => entry?.provenance?.generator !== GENERATOR_ID);
  const maxOrder = preserved.reduce((max, entry) => Math.max(max, Number(entry?.order) || 0), 0);
  const derived = selected.map((key, index) => candidateEntry(candidatesByKey.get(key), {
    role: 'discovery',
    order: maxOrder + index + 1,
    runExport,
  }));
  const holdoutKey = String(holdout.candidateKey);
  if (!selected.includes(holdoutKey)) {
    derived.push(candidateEntry(candidatesByKey.get(holdoutKey), {
      role: 'validation',
      order: maxOrder + derived.length + 1,
      runExport,
    }));
  }
  next.benchmarks = [...preserved, ...derived]
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.id).localeCompare(String(b.id)));

  // Holdout do sample = holdout PRÉ-REGISTRADO do run (com proveniência).
  next.holdout = {
    benchmarkId: holdoutKey,
    selectedAsHoldoutAt: String(holdout.preregisteredAt),
    selectionReason: isNonEmptyString(holdout.basis?.reason)
      ? String(holdout.basis.reason)
      : JSON.stringify(holdout.basis || {}),
    provenance: {
      generator: GENERATOR_ID,
      marketDiscoveryRunId: String(runExport.runId),
      discoverySetId: String(runExport.discoverySetId),
      appliedAt: String(runExport.completedAt),
    },
  };

  next.marketDiscoveryProvenance = {
    generator: GENERATOR_ID,
    marketDiscoveryRunId: String(runExport.runId),
    discoverySetId: String(runExport.discoverySetId),
    vertical: String(runExport.vertical || sample.vertical || ''),
    discoveryVersion: String(runExport.discoveryVersion || ''),
    appliedAt: String(runExport.completedAt),
    selectedCandidates: selected,
    holdoutCandidateKey: holdoutKey,
    rule: 'sample derivado do run de market discovery por gerador determinístico; edição manual é drift (`--check` falha)',
  };

  return next;
}

/** Compara apenas as chaves gerenciadas (drift = divergência nelas). */
function sectionsEqual(sample, derived) {
  return MANAGED_KEYS.every(
    (key) => JSON.stringify(sample?.[key] ?? null) === JSON.stringify(derived?.[key] ?? null),
  );
}

/**
 * Monta o export do run a partir do STORE (Postgres). Falha explícita quando
 * o run não existe ou não concluiu — nunca sintetiza um export parcial.
 */
async function loadRunExportFromStore({ store, tenantId = 'system', runId = null, vertical = null }) {
  const runRow = runId
    ? await store.getRunById({ tenantId, runId })
    : await store.getRun({ tenantId, vertical });
  const run = plain(runRow);
  if (!run) {
    throw generatorError(ERROR_CODES.RUN_NOT_FOUND, `run não encontrado (${runId || `latest de ${vertical}`})`);
  }
  const setId = run.metadata?.handoff?.discoverySetId || run.metadata?.discoverySetId || null;
  const set = setId ? plain(await store.getDiscoverySet({ tenantId, setId })) : null;
  if (!set) {
    throw generatorError(ERROR_CODES.RUN_NOT_COMPLETED, `run ${run.id} sem discovery set persistido`);
  }
  const candidateKeys = [...list(set.selected_candidates), set.holdout_candidate_id].filter(Boolean);
  const candidates = [];
  for (const key of candidateKeys) {
    const row = plain(await store.getCandidate({ tenantId, vertical: run.vertical, candidateKey: key }));
    if (row) candidates.push(row);
  }
  return {
    runId: String(run.id),
    vertical: String(run.vertical),
    discoveryVersion: String(run.discovery_version),
    state: String(run.state),
    completedAt: run.completed_at ? new Date(run.completed_at).toISOString() : null,
    discoverySetId: String(set.id),
    selectedCandidates: list(set.selected_candidates),
    holdout: {
      candidateKey: set.holdout_candidate_id || null,
      preregistered: set.holdout_preregistered === true,
      preregisteredAt: set.holdout_selected_at ? new Date(set.holdout_selected_at).toISOString() : null,
      basis: set.holdout_selection_basis || null,
    },
    candidates,
  };
}

/** Validação pós-derivação COM O ENGINE (mesma disciplina do sample-patch). */
function assertEvaluable(candidate) {
  const { evaluateSampleSufficiency } = require('../../qa/benchmarks/benchmarkSufficiencyEngine');
  const policy = require('../../config/benchmark-sufficiency-policy.json');
  let evaluation = null;
  try {
    evaluation = evaluateSampleSufficiency({ sample: candidate, policy });
  } catch (error) {
    throw generatorError(ERROR_CODES.SAMPLE_NOT_EVALUABLE, `engine recusou o sample candidato: ${error.message}`);
  }
  if (!evaluation || !evaluation.status) {
    throw generatorError(ERROR_CODES.SAMPLE_NOT_EVALUABLE, 'engine não produziu avaliação para o sample candidato');
  }
  return evaluation;
}

function parseArgs(argv) {
  const args = { check: false, sample: null, export: null, runId: null, vertical: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--check') args.check = true;
    else if (flag === '--sample') args.sample = argv[++index];
    else if (flag === '--export') args.export = argv[++index];
    else if (flag === '--run-id') args.runId = argv[++index];
    else if (flag === '--vertical') args.vertical = argv[++index];
  }
  return args;
}

async function resolveRunExport(args, sample) {
  if (args.export) {
    const exportPath = path.resolve(args.export);
    if (!fs.existsSync(exportPath)) {
      throw generatorError(ERROR_CODES.SOURCE_REQUIRED, `export ausente: ${args.export}`);
    }
    return JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  }
  if (!args.runId && !args.vertical && !sample.vertical) {
    throw generatorError(ERROR_CODES.SOURCE_REQUIRED, 'sem --export é obrigatório --run-id ou --vertical');
  }
  // Modo banco: conecta no Postgres real. Sem banco: persistence_required.
  const { connect, getSequelize, close } = require('../../api/db/sequelize');
  await connect();
  if (!getSequelize()) {
    throw generatorError('persistence_required', 'Sequelize não inicializado: o run só pode vir do Postgres');
  }
  try {
    const { createMarketDiscoveryStore } = require('../../api/services/marketDiscovery/marketDiscoveryStore');
    const store = createMarketDiscoveryStore();
    return await loadRunExportFromStore({
      store,
      tenantId: 'system',
      runId: args.runId,
      vertical: args.vertical || sample.vertical,
    });
  } finally {
    if (typeof close === 'function') await close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const samplePath = path.resolve(args.sample || path.join(ROOT_DIR, 'config', 'benchmarks', 'fitness.json'));
  if (!fs.existsSync(samplePath)) {
    throw generatorError(ERROR_CODES.SOURCE_REQUIRED, `sample ausente: ${samplePath}`);
  }
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const runExport = await resolveRunExport(args, sample);

  const derived = applyMarketDiscoveryToSample({ sample, runExport });

  if (args.check) {
    if (!sectionsEqual(sample, derived)) {
      const drifted = MANAGED_KEYS.filter(
        (key) => JSON.stringify(sample[key] ?? null) !== JSON.stringify(derived[key] ?? null),
      );
      process.stderr.write(`[apply-market-discovery] DRIFT (${ERROR_CODES.DRIFT}): ${drifted.join(', ')}\n`);
      process.exit(1);
    }
    process.stdout.write('[apply-market-discovery] OK: sample em sincronia com o run de market discovery\n');
    return;
  }

  assertEvaluable(derived);
  fs.writeFileSync(samplePath, `${JSON.stringify(derived, null, 2)}\n`);
  process.stdout.write(
    `[apply-market-discovery] ${path.relative(ROOT_DIR, samplePath)}: run=${runExport.runId} `
    + `set=${list(runExport.selectedCandidates).length} holdout=${runExport.holdout?.candidateKey || 'nenhum'}\n`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[apply-market-discovery] ${error.code || 'error'}: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  GENERATOR_ID,
  MANAGED_KEYS,
  ERROR_CODES,
  applyMarketDiscoveryToSample,
  sectionsEqual,
  loadRunExportFromStore,
};
