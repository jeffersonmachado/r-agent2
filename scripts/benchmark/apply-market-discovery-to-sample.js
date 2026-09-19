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
 * Chaves gerenciadas (apenas estas são tocadas): `benchmarks` (re-deriva as
 * entradas cuja `provenance.generator` é ESTE gerador — EXCETO as já
 * analisadas, que são fato persistido e jamais são dropadas, ABS-22), `holdout`
 * e `marketDiscoveryProvenance`. Todo o resto do sample é preservado byte a
 * byte em conteúdo.
 *
 * Uso:
 *   node scripts/benchmark/apply-market-discovery-to-sample.js --export run.json
 *   node scripts/benchmark/apply-market-discovery-to-sample.js --run-id mdr-...
 *   node scripts/benchmark/apply-market-discovery-to-sample.js --check ...
 */

const fs = require('fs');
const path = require('path');
const { emptyNovelty } = require('../../qa/benchmarks/benchmarkSufficiencyEngine');

const ROOT_DIR = path.join(__dirname, '..', '..');
const GENERATOR_ID = 'scripts/benchmark/apply-market-discovery-to-sample.js';

const ERROR_CODES = Object.freeze({
  SOURCE_REQUIRED: 'market_run_source_required',
  RUN_NOT_FOUND: 'market_discovery_run_not_found',
  RUN_NOT_COMPLETED: 'market_run_not_completed',
  HOLDOUT_NOT_PREREGISTERED: 'market_run_holdout_not_preregistered',
  HOLDOUT_WITHOUT_ARCHETYPE: 'market_run_holdout_without_archetype',
  EVIDENCE_MISSING: 'market_run_evidence_missing',
  SAMPLE_NOT_EVALUABLE: 'market_sample_not_evaluable',
  ANALYZED_RESELECTED: 'market_run_reselected_analyzed_benchmark',
  DRIFT: 'market_discovery_sample_drift_detected',
  VERTICAL_MISMATCH: 'market_run_sample_vertical_mismatch',
  SAMPLE_UNRESOLVED: 'market_sample_vertical_unresolved',
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
 * URL GENÉRICA: raiz do host, sem path nem query — mesma semântica de
 * `isGenericSource` do engine de suficiência. Uma homepage prova que o
 * fornecedor existe; uma página profunda já é conteúdo de marketing/produto.
 */
function isGenericUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.pathname.replace(/\/+$/, '') === '' && parsed.search.length <= 1;
  } catch (_) {
    return false;
  }
}

/**
 * Fontes DECLARADAS do benchmark derivado — o plano de deep research
 * (`buildResearchPlanFromSample`) ignora benchmark sem `sources`, então a
 * entrada aplicada precisa carregá-las ou jamais seria pesquisada.
 *
 * Disciplina de fases (ciclo 2, run real r8): as fontes declaradas são apenas
 * as GENÉRICAS (homepage/raiz) — o que se sabia antes do pré-registro é a
 * EXISTÊNCIA do fornecedor, nunca o inventário. As páginas profundas da
 * evidência de descoberta (listicles onde o sinal foi encontrado) NÃO viram
 * fonte declarada: permanecem auditáveis em `provenance.evidenceRefs`, e o
 * conteúdo específico é redescoberto pelo deep research no tempo próprio
 * (com `retrievedAt` de análise). Misturar as fases faria o engine
 * (evaluateHoldout) ler exposição pré-registro de conteúdo específico.
 */
function declaredSourcesOf(candidate) {
  const byUrl = new Map();
  for (const item of list(candidate?.sourceEvidence ?? candidate?.source_evidence)) {
    const url = String(item?.url || '').trim();
    if (!url || byUrl.has(url) || !isGenericUrl(url) || !url.startsWith('https://')) continue;
    byUrl.set(url, {
      url,
      tier: Number.isFinite(Number(item?.tier)) ? Number(item.tier) : 5,
      specificity: 'GENERIC',
      // Declarada, NÃO verificada: a verificação é do deep research, no tempo
      // dele (com retrievedAt de análise). Declarar como verificada seria
      // fabricar trabalho que ainda não aconteceu.
      retrievedAt: null,
      verified: false,
      provenance: {
        evidenceRef: item?.evidenceRef ? String(item.evidenceRef) : null,
        contentHash: item?.contentHash ? String(item.contentHash) : null,
      },
    });
  }
  const site = String(candidate?.officialSite || candidate?.official_site || '').trim();
  if (site && isGenericUrl(site) && site.startsWith('https://') && !byUrl.has(site)) {
    byUrl.set(site, { url: site, tier: 5, specificity: 'GENERIC', retrievedAt: null, verified: false });
  }
  return [...byUrl.values()];
}

function candidateEntry(candidate, { role, order, runExport }) {
  const candidateKey = String(candidate.candidateKey || candidate.candidate_key);
  return {
    id: candidateKey,
    name: String(candidate.name || candidateKey),
    role,
    order,
    archetype: list(candidate.archetypes)[0] || null,
    // Grupo de independência: o estágio DIVERSITY não encontrou grupo
    // compartilhado → o candidato é o próprio grupo até prova em contrário
    // (null esvaziaria as janelas de grupos independentes da saturação).
    independenceGroup: candidate.independenceGroup || candidate.independence_group || candidateKey,
    cloneOf: candidate.cloneOf || candidate.clone_of || null,
    officialSite: candidate.officialSite || candidate.official_site || null,
    sources: declaredSourcesOf(candidate),
    // Novelty AUSENTE é ambíguo (não medido × medido zerado): a entrada
    // derivada declara a estrutura completa e vazia — o que a distingue de
    // "analisado" é a ausência de analyzedAt, como em todo o engine.
    novelty: emptyNovelty(),
    findingsInventory: [],
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

  // Contrato completo do registro de holdout (ciclo 2, run real r8): o engine
  // (evaluateHoldout.preregistrationFields) exige selectionEvidence,
  // marketArchetype e inventoryVersion — emitir só benchmarkId/selectedAt/
  // reason produzia holdout_preregistration_incomplete a jusante.
  const holdoutKey = String(holdout.candidateKey);
  const holdoutCandidate = candidatesByKey.get(holdoutKey);
  const holdoutArchetype = list(holdoutCandidate.archetypes)[0] || null;
  if (!isNonEmptyString(holdoutArchetype)) {
    throw generatorError(
      ERROR_CODES.HOLDOUT_WITHOUT_ARCHETYPE,
      `candidato holdout ${holdoutKey} sem arquétipo no run ${runExport.runId}: marketArchetype é obrigatório e nunca é inventado`,
    );
  }
  const inventoryVersion = isNonEmptyString(next.inventoryVersion)
    ? String(next.inventoryVersion)
    : (isNonEmptyString(next.holdout?.inventoryVersion) ? String(next.holdout.inventoryVersion) : null);
  if (!inventoryVersion) {
    throw generatorError(
      ERROR_CODES.SAMPLE_NOT_EVALUABLE,
      'sample sem inventoryVersion: o pré-registro do holdout exige a versão do inventário canônico',
    );
  }

  // INCORPORAÇÃO de holdouts aposentados (regra do ciclo de absorção: holdout
  // que cumpriu seu papel — analisado ou não — NUNCA some nem fica eternamente
  // fora do discovery set; seus achados passam a contar no inventário). A regra
  // vale para QUALQUER 'validation' que não é o holdout pré-registrado DESTE
  // run — não só para o registro corrente de holdout: a aplicação do r8 (ciclo
  // 2) rodou com o gerador anterior a esta regra e o zenplanner (holdout do
  // ciclo 1, analisado) ficou 'validation' depois que o registro passou a ser
  // outro benchmark — fora do discovery set, seus achados não contavam no
  // inventário (denominador encolhido por omissão).
  const demoted = [];
  for (const entry of list(next.benchmarks)) {
    if (!entry || entry.role !== 'validation' || String(entry.id) === holdoutKey) continue;
    entry.role = 'discovery';
    entry.incorporation = {
      generator: GENERATOR_ID,
      fromRole: 'validation',
      marketDiscoveryRunId: String(runExport.runId),
      discoverySetId: String(runExport.discoverySetId),
      appliedAt: String(runExport.completedAt),
      note: 'holdout de ciclo anterior incorporado ao discovery set — os achados passam a contar no inventário; substituído pelo holdout pré-registrado deste run',
    };
    demoted.push(entry);
  }

  // Benchmarks: entradas gerenciadas por ESTE gerador são re-derivadas; as
  // demais (análises anteriores, seeds históricos) são preservadas intactas —
  // EXCETO quando a chave está no set/holdout DESTE run (run real r21,
  // 2026-09-17): um seed DECLARADO pelo operador que também foi selecionado
  // seria preservado E derivado — o r21 terminou com 6 vendors duplicados e o
  // plano de deep research analisou cada um duas vezes. Uma chave = UMA
  // entrada; a versão derivada (com lineage do run) absorve a declaração.
  //
  // ABS-22 (runs reais r17/r21/r22, 2026-09-17): entrada gerenciada COM
  // análise persistida (`analyzedAt`) é FATO — o deep research aconteceu, a
  // novelty foi medida, os achados alimentam o inventário. A aplicação de um
  // run novo NUNCA a dropa (o r22 dropou os 6 analisados do r21; o r17 já
  // tinha dropado o vantagefit.io; a regen do ABS-21, o goteamup.com) —
  // sumir com análise encolhe o denominador da saturação, e remover benchmark
  // para ficar verde é proibido. Só propostas gerenciadas NÃO analisadas são
  // suplantadas pelo run novo. E se o run novo RE-SELECIONAR uma chave
  // analisada (a exclusão durável ABS-20 falhou a montante), a recusa é
  // fail-closed: derivar por cima apagaria a análise em silêncio.
  const runKeys = new Set([...selected.map(String), ...(selected.includes(holdoutKey) ? [] : [String(holdoutKey)])]);
  const hasAnalysis = (entry) => isNonEmptyString(entry?.analyzedAt);
  const reselected = list(next.benchmarks).find((entry) => hasAnalysis(entry) && runKeys.has(String(entry?.id)));
  if (reselected) {
    throw generatorError(
      ERROR_CODES.ANALYZED_RESELECTED,
      `run ${runExport.runId} re-selecionou o benchmark analisado ${reselected.id} (analyzedAt=${reselected.analyzedAt}): a exclusão durável falhou a montante — nunca derive por cima de análise persistida`,
    );
  }
  const preserved = list(next.benchmarks).filter((entry) => (entry?.provenance?.generator !== GENERATOR_ID || hasAnalysis(entry))
    && !runKeys.has(String(entry?.id)));
  const maxOrder = preserved.reduce((max, entry) => Math.max(max, Number(entry?.order) || 0), 0);
  // O holdout incorporado foi analisado DEPOIS de todos os benchmarks do ciclo
  // anterior (era o holdout de validação deles): fecha a sequência preservada.
  for (const entry of demoted) {
    entry.order = maxOrder + demoted.indexOf(entry) + 1;
  }
  const derivedBase = maxOrder + demoted.length;
  const derived = selected.map((key, index) => candidateEntry(candidatesByKey.get(key), {
    role: 'discovery',
    order: derivedBase + index + 1,
    runExport,
  }));
  if (!selected.includes(holdoutKey)) {
    derived.push(candidateEntry(candidatesByKey.get(holdoutKey), {
      role: 'validation',
      order: derivedBase + derived.length + 1,
      runExport,
    }));
  }
  // A deduplicação por chave já aconteceu no filtro de `preserved` (acima).
  next.benchmarks = [...preserved, ...derived]
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.id).localeCompare(String(b.id)));

  // Holdout do sample = holdout PRÉ-REGISTRADO do run (com proveniência e
  // evidência de seleção composta de FATOS do run — nunca texto genérico).
  const holdoutEvidenceRefs = evidenceRefsOf(holdoutCandidate);
  const basisText = isNonEmptyString(holdout.basis?.reason)
    ? String(holdout.basis.reason)
    : JSON.stringify(holdout.basis || {});
  const selectionEvidence = [
    `Existência verificada no run ${runExport.runId} por evidência hash-bound (${holdoutEvidenceRefs.join(', ')}).`,
    `Site oficial declarado: ${holdoutCandidate.officialSite || holdoutCandidate.official_site || 'não identificado'}.`,
    `Pré-registrado em ${holdout.preregisteredAt} ANTES de qualquer pesquisa profunda de inventário (deep research); fases executadas até aqui: MARKET, ARCHETYPES, CANDIDATES, CANDIDATE_ANALYSIS (profiling de mercado), DIVERSITY, DISCOVERY_SET — conforme o pipeline governado.`,
    `Base da seleção: ${basisText}.`,
  ].join(' ');
  next.holdout = {
    benchmarkId: holdoutKey,
    selectedAsHoldoutAt: String(holdout.preregisteredAt),
    selectionReason: basisText,
    selectionEvidence,
    marketArchetype: String(holdoutArchetype),
    inventoryVersion,
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

  // ── ALVO: o sample da VERTICAL do run — nunca um default fixo ─────────────
  // DEFEITO CORRIGIDO (2026-09-19): o caminho default era
  // `config/benchmarks/fitness.json` HARDCODED. Rodar
  // `--vertical beauty` lia o run de beauty e gravava no sample de FITNESS:
  // 521 linhas de concorrentes de beleza foram escritas no corpus CURADO de
  // academias (role/incorporation/holdout sobrescritos). Corrupção cruzada
  // silenciosa de artefato de pesquisa — o `--vertical` selecionava o RUN e
  // não o arquivo. Agora o sample é derivado da vertical e uma divergência
  // entre run e sample é RECUSADA antes de qualquer escrita.
  const explicitSamplePath = args.sample ? path.resolve(args.sample) : null;
  const explicitSample = explicitSamplePath && fs.existsSync(explicitSamplePath)
    ? JSON.parse(fs.readFileSync(explicitSamplePath, 'utf8'))
    : null;

  const runExport = await resolveRunExport(
    args,
    explicitSample || { vertical: args.vertical || null },
  );

  const targetVertical = String(runExport.vertical || args.vertical || '').trim();
  const samplePath = explicitSamplePath
    || (isNonEmptyString(targetVertical)
      ? path.join(ROOT_DIR, 'config', 'benchmarks', `${targetVertical}.json`)
      : null);
  if (!samplePath) {
    throw generatorError(
      ERROR_CODES.SAMPLE_UNRESOLVED,
      'não foi possível resolver a vertical do sample: informe --sample ou --vertical',
    );
  }
  if (!fs.existsSync(samplePath)) {
    throw generatorError(ERROR_CODES.SOURCE_REQUIRED, `sample ausente: ${samplePath}`);
  }
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));

  // Defesa em profundidade: run e sample precisam ser da MESMA vertical.
  if (isNonEmptyString(sample.vertical)
    && isNonEmptyString(runExport.vertical)
    && sample.vertical !== runExport.vertical) {
    throw generatorError(
      ERROR_CODES.VERTICAL_MISMATCH,
      `sample ${path.relative(ROOT_DIR, samplePath)} é da vertical '${sample.vertical}' `
      + `e o run ${runExport.runId} é da vertical '${runExport.vertical}': '
      + 'aplicação cruzada é proibida (corromperia corpus de outra vertical)`,
    );
  }

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
