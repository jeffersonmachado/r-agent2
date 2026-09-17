'use strict';

/**
 * benchmarkResearchStore — AUTORIDADE PERSISTENTE da pesquisa de benchmarks.
 *
 * Substitui `runs = new Map()` (§B4 da missão de 2026-09-13). O mapa em memória
 * tinha três consequências inaceitáveis para pesquisa competitiva:
 *   1. um run iniciado desaparecia no restart do processo (§B5);
 *   2. nenhum achado era auditável depois da execução — nem a fonte, nem a
 *      evidência (§B6);
 *   3. `toSamplePatch()` não tinha consumidor real porque não havia estado
 *      durável para patch nenhum (§B7).
 *
 * Contrato (implementado por este módulo em produção e pelo store em memória
 * dos testes — `tests/helpers/benchmarkResearchMemoryStore.js`):
 *
 *   openRun / getRun / updateRunState
 *   listSubjects / getSubject / markSubjectAnalyzed
 *   upsertSource / listSources
 *   appendEvidence / listEvidence        (append-only)
 *   insertFinding / listFindings
 *   upsertSourceInspection / listSourceInspections   (proveniência por fonte)
 *
 * Regras aplicadas AQUI (e não só na camada de política):
 *   - `tenant_key` obrigatório em toda operação: nenhuma leitura cruza tenant;
 *   - IDs determinísticos ⇒ retry/replay são idempotentes (registrar o mesmo
 *     achado duas vezes não infla a curva de novidade);
 *   - evidência é append-only: não existe update nem delete neste módulo.
 *
 * Sem `sequelize` inicializado a operação FALHA com `persistence_required` —
 * nunca cai para memória.
 */

const crypto = require('crypto');

const ERROR_CODES = Object.freeze({
  PERSISTENCE_REQUIRED: 'persistence_required',
  INVALID: 'benchmark_research_store_invalid',
});

function storeError(code, message, extra = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function requireNonEmpty(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw storeError(ERROR_CODES.INVALID, `${field} é obrigatório`);
  }
  return normalized;
}

function deterministicId(prefix, parts) {
  const digest = crypto.createHash('sha256').update(parts.map((p) => String(p ?? '')).join('\u0000')).digest('hex');
  return `${prefix}-${digest.slice(0, 48)}`;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function jsonObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

/**
 * Carrega os models do agregado. Falha explícita (nunca fallback em memória)
 * quando o Sequelize não foi inicializado.
 */
function defaultModels() {
  const { getSequelize } = require('../../db/sequelize');
  if (!getSequelize()) {
    throw storeError(ERROR_CODES.PERSISTENCE_REQUIRED, 'Sequelize não inicializado: connect() é obrigatório');
  }
  return {
    run: require('../../db/models/BenchmarkResearchRun')(),
    subject: require('../../db/models/BenchmarkResearchSubject')(),
    source: require('../../db/models/BenchmarkResearchSource')(),
    evidence: require('../../db/models/BenchmarkResearchEvidence')(),
    finding: require('../../db/models/BenchmarkResearchFinding')(),
    inspection: require('../../db/models/BenchmarkSourceInspection')(),
  };
}

/**
 * @param {object} [options]
 * @param {object} [options.models] models injetados (testes de integração)
 */
function createBenchmarkResearchStore({ models } = {}) {
  function resolveModels() {
    const resolved = models || defaultModels();
    for (const key of ['run', 'subject', 'source', 'evidence', 'finding', 'inspection']) {
      if (!resolved[key]) {
        throw storeError(ERROR_CODES.PERSISTENCE_REQUIRED, `model ausente: ${key}`);
      }
    }
    return resolved;
  }

  /** Run mais recente de `(tenant, vertical)` (opcionalmente de uma versão). */
  async function getRun({ tenantId, vertical, researchVersion = null }) {
    const { run } = resolveModels();
    const where = { tenant_key: requireNonEmpty(tenantId, 'tenantId'), vertical: requireNonEmpty(vertical, 'vertical') };
    if (researchVersion) where.research_version = String(researchVersion);
    return run.findOne({ where, order: [['registered_at', 'DESC']] });
  }

  /**
   * TODOS os runs de `(tenant, vertical)` em ordem cronológica ASC.
   * FITNESS-ABS-14: a derivação de evidência de arquétipo precisa do histórico
   * completo — os findings que respaldam um benchmark são os do último run que
   * o contém, não necessariamente do run mais recente da vertical.
   */
  async function listRuns({ tenantId, vertical }) {
    const { run } = resolveModels();
    return run.findAll({
      where: { tenant_key: requireNonEmpty(tenantId, 'tenantId'), vertical: requireNonEmpty(vertical, 'vertical') },
      order: [['registered_at', 'ASC']],
    });
  }

  /**
   * Registra o DISCOVERY SET. Idempotente por `(tenant, vertical, version)`:
   * reabrir o mesmo run não recria história nem reordena o discovery set.
   */
  async function openRun({
    tenantId,
    vertical,
    researchVersion,
    benchmarkIds = [],
    holdoutBenchmarkId = null,
    registeredAt,
    metadata = {},
  }) {
    const { run, subject } = resolveModels();
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const verticalId = requireNonEmpty(vertical, 'vertical');
    const version = requireNonEmpty(researchVersion, 'researchVersion');
    const ids = (Array.isArray(benchmarkIds) ? benchmarkIds : []).map((id) => String(id ?? '').trim()).filter(Boolean);
    if (ids.length === 0) throw storeError(ERROR_CODES.INVALID, 'discovery set vazio');
    if (new Set(ids).size !== ids.length) throw storeError(ERROR_CODES.INVALID, 'discovery set com duplicatas');

    const id = deterministicId('brr', [tenant, verticalId, version]);
    const existing = await run.findByPk(id);
    if (existing) {
      // Idempotência explícita: o run já existe com o MESMO discovery set.
      return existing;
    }

    const at = registeredAt ? new Date(registeredAt) : new Date();
    const created = await run.create({
      id,
      tenant_key: tenant,
      vertical: verticalId,
      research_version: version,
      state: 'RESEARCH_DISCOVERY_OPEN',
      holdout_benchmark_id: holdoutBenchmarkId ? String(holdoutBenchmarkId) : null,
      saturation_reached: false,
      registered_at: at,
      discovery_set: ids,
      metadata: jsonObject(metadata),
    });

    // A ORDEM do discovery set é prova: a curva de novidade é sensível a ela.
    for (const [index, benchmarkId] of ids.entries()) {
      const subjectId = deterministicId('brs', [tenant, id, benchmarkId]);
      const existingSubject = await subject.findByPk(subjectId);
      if (existingSubject) continue;
      await subject.create({
        id: subjectId,
        tenant_key: tenant,
        run_id: id,
        benchmark_id: benchmarkId,
        discovery_order: index + 1,
      });
    }

    return created;
  }

  async function updateRunState({ tenantId, runId, state = null, saturationReached = null }) {
    const { run } = resolveModels();
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const row = await run.findOne({ where: { id: requireNonEmpty(runId, 'runId'), tenant_key: tenant } });
    if (!row) throw storeError(ERROR_CODES.INVALID, `run inexistente: ${runId}`);
    const patch = {};
    if (state) patch.state = String(state);
    if (saturationReached !== null) patch.saturation_reached = saturationReached === true;
    if (Object.keys(patch).length > 0) await row.update(patch);
    return row;
  }

  async function listSubjects({ tenantId, runId }) {
    const { subject } = resolveModels();
    return subject.findAll({
      where: { tenant_key: requireNonEmpty(tenantId, 'tenantId'), run_id: requireNonEmpty(runId, 'runId') },
      order: [['discovery_order', 'ASC']],
    });
  }

  async function getSubject({ tenantId, runId, benchmarkId }) {
    const { subject } = resolveModels();
    return subject.findOne({
      where: {
        tenant_key: requireNonEmpty(tenantId, 'tenantId'),
        run_id: requireNonEmpty(runId, 'runId'),
        benchmark_id: requireNonEmpty(benchmarkId, 'benchmarkId'),
      },
    });
  }

  /** Marca um benchmark como ANALISADO (exige evidência já validada na política). */
  async function markSubjectAnalyzed({
    tenantId,
    runId,
    benchmarkId,
    analyzedAt,
    researchVersion,
    findingsInventory,
    marketArchetypeMapping,
  }) {
    const { subject } = resolveModels();
    const row = await getSubject({ tenantId, runId, benchmarkId });
    if (!row) throw storeError(ERROR_CODES.INVALID, `benchmark fora do discovery set: ${benchmarkId}`);
    await row.update({
      analyzed_at: analyzedAt ? new Date(analyzedAt) : new Date(),
      research_version: requireNonEmpty(researchVersion, 'researchVersion'),
      findings_inventory: Array.isArray(findingsInventory) ? findingsInventory : [],
      market_archetype_mapping: jsonObject(marketArchetypeMapping, null),
    });
    return row;
  }

  /**
   * Fonte é idempotente por `(tenant, run, benchmark, url)`. Re-verificar a
   * mesma URL ATUALIZA o estado de verificação (o status HTTP pode mudar), mas
   * nunca cria uma segunda fonte.
   */
  async function upsertSource({ tenantId, runId, benchmarkId, source }) {
    const { source: sourceModel } = resolveModels();
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const run = requireNonEmpty(runId, 'runId');
    const benchmark = requireNonEmpty(benchmarkId, 'benchmarkId');
    const url = requireNonEmpty(source?.url, 'source.url');

    const id = deterministicId('brsrc', [tenant, run, benchmark, url]);
    const existing = await sourceModel.findByPk(id);
    const payload = {
      tier: Number.isFinite(Number(source?.tier)) ? Number(source.tier) : null,
      specificity: source?.specificity ? String(source.specificity) : null,
      http_status: Number.isFinite(Number(source?.httpStatus)) ? Number(source.httpStatus) : null,
      verified: source?.verified === true,
      verification_state: String(source?.verificationState || 'UNVERIFIED'),
      verified_at: source?.verified === true ? new Date() : null,
    };
    if (existing) {
      await existing.update(payload);
      return existing;
    }
    return sourceModel.create({
      id,
      tenant_key: tenant,
      run_id: run,
      benchmark_id: benchmark,
      url,
      ...payload,
    });
  }

  /**
   * Persiste o ESTADO DE PESQUISA do benchmark: estado por EIXO (capability,
   * journey, businessRule), inspeções executadas e resumo da extração.
   *
   * Fica no `metadata` da linha do SUBJECT (não em memória) por dois motivos:
   *   1. `analyzedAt` só pode ser concedido com os três eixos pesquisados — o
   *      estado que justifica a concessão precisa sobreviver ao restart;
   *   2. auditabilidade: "o eixo de jornada foi pesquisado?" é uma pergunta que
   *      o auditor faz depois, não durante a execução.
   */
  async function updateSubjectResearchState({ tenantId, runId, benchmarkId, patch = {} }) {
    const row = await getSubject({ tenantId, runId, benchmarkId });
    if (!row) throw storeError(ERROR_CODES.INVALID, `benchmark fora do discovery set: ${benchmarkId}`);
    // Objeto NOVO: o Sequelize compara a referência do JSONB para decidir se
    // emite o UPDATE. Mutar `row.metadata` in-place faz o campo ser considerado
    // INALTERADO e a gravação silenciosamente não acontece.
    const metadata = { ...jsonObject(row.metadata, {}) };
    if (patch.axes) metadata.researchAxes = { ...jsonObject(metadata.researchAxes, {}), ...patch.axes };
    if (patch.inspections) metadata.inspections = { ...jsonObject(metadata.inspections, {}), ...patch.inspections };
    if (patch.extraction) metadata.extraction = { ...jsonObject(metadata.extraction, {}), ...patch.extraction };
    if (patch.metadata) Object.assign(metadata, jsonObject(patch.metadata, {}));
    await row.update({ metadata });
    return row;
  }

  async function listSources({ tenantId, runId, benchmarkId = null }) {
    const { source } = resolveModels();
    const where = { tenant_key: requireNonEmpty(tenantId, 'tenantId'), run_id: requireNonEmpty(runId, 'runId') };
    if (benchmarkId) where.benchmark_id = String(benchmarkId);
    return source.findAll({ where, order: [['created_at', 'ASC']] });
  }

  /**
   * APPEND-ONLY. O id determinístico torna a captura repetida idempotente:
   * a mesma evidência não vira duas provas.
   */
  async function appendEvidence({
    tenantId,
    runId,
    benchmarkId,
    sourceId = null,
    evidenceRef,
    contentHash = null,
    httpStatus = null,
    capturedAt = null,
    metadata = {},
  }) {
    const { evidence } = resolveModels();
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const run = requireNonEmpty(runId, 'runId');
    const benchmark = requireNonEmpty(benchmarkId, 'benchmarkId');
    const ref = requireNonEmpty(evidenceRef, 'evidenceRef');

    const id = deterministicId('bre', [tenant, run, benchmark, ref]);
    const existing = await evidence.findByPk(id);
    if (existing) return existing;

    return evidence.create({
      id,
      tenant_key: tenant,
      run_id: run,
      benchmark_id: benchmark,
      source_id: sourceId ? String(sourceId) : null,
      evidence_ref: ref,
      content_hash: contentHash ? String(contentHash) : null,
      http_status: Number.isFinite(Number(httpStatus)) ? Number(httpStatus) : null,
      captured_at: capturedAt ? new Date(capturedAt) : new Date(),
      metadata: jsonObject(metadata),
    });
  }

  async function listEvidence({ tenantId, runId, benchmarkId = null }) {
    const { evidence } = resolveModels();
    const where = { tenant_key: requireNonEmpty(tenantId, 'tenantId'), run_id: requireNonEmpty(runId, 'runId') };
    if (benchmarkId) where.benchmark_id = String(benchmarkId);
    return evidence.findAll({ where, order: [['captured_at', 'ASC']] });
  }

  /**
   * Insere um achado. Idempotente por conteúdo do achado: um retry do runner
   * devolve a MESMA linha em vez de contar novidade duas vezes.
   */
  async function insertFinding({
    tenantId,
    runId,
    benchmarkId,
    kind,
    externalName = null,
    canonicalId = null,
    classification = null,
    archetype = null,
    verified = false,
    verificationState = 'UNVERIFIED',
    sourceId = null,
    evidenceId = null,
    recordedAt = null,
    metadata = {},
  }) {
    const { finding } = resolveModels();
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const run = requireNonEmpty(runId, 'runId');
    const benchmark = requireNonEmpty(benchmarkId, 'benchmarkId');
    const findingKind = requireNonEmpty(kind, 'kind');
    const name = externalName ? String(externalName) : null;

    const id = deterministicId('brf', [
      tenant, run, benchmark, findingKind, name, canonicalId || '', evidenceId || '',
    ]);
    const existing = await finding.findByPk(id);
    if (existing) return existing;

    return finding.create({
      id,
      tenant_key: tenant,
      run_id: run,
      benchmark_id: benchmark,
      kind: findingKind,
      external_name: name,
      canonical_id: canonicalId ? String(canonicalId) : null,
      classification: classification ? String(classification) : null,
      archetype: archetype ? String(archetype) : null,
      verified: verified === true,
      verification_state: String(verificationState),
      source_id: sourceId ? String(sourceId) : null,
      evidence_id: evidenceId ? String(evidenceId) : null,
      recorded_at: recordedAt ? new Date(recordedAt) : new Date(),
      metadata: jsonObject(metadata),
    });
  }

  async function listFindings({ tenantId, runId, benchmarkId = null }) {
    const { finding } = resolveModels();
    const where = { tenant_key: requireNonEmpty(tenantId, 'tenantId'), run_id: requireNonEmpty(runId, 'runId') };
    if (benchmarkId) where.benchmark_id = String(benchmarkId);
    return finding.findAll({ where, order: [['recorded_at', 'ASC']] });
  }

  /**
   * UPSERT da inspeção de UMA fonte (T-B2). Identidade determinística por
   * `(tenant, run, benchmark, source, contentHash)`: re-inspecionar o MESMO
   * conteúdo ATUALIZA a linha (o estado por eixo pode mudar), mas nunca cria
   * uma segunda inspeção. Um `contentHash` NOVO é outra linha — o conteúdo
   * mudou, logo é outro documento analisado.
   */
  async function upsertSourceInspection({
    tenantId,
    runId,
    benchmarkId,
    subjectId = null,
    sourceId = null,
    url,
    contentHash,
    retrievedAt = null,
    inspectedAt = null,
    documentType = null,
    provider = null,
    documentationStatus = 'NOT_EXECUTED',
    apiStatus = 'NOT_EXECUTED',
    axisStatuses = {},
    errors = [],
    metadata = {},
  }) {
    const { inspection } = resolveModels();
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const run = requireNonEmpty(runId, 'runId');
    const benchmark = requireNonEmpty(benchmarkId, 'benchmarkId');
    const sourceUrl = requireNonEmpty(url, 'url');
    const hash = requireNonEmpty(contentHash, 'contentHash');

    const id = deterministicId('brsi', [tenant, run, benchmark, sourceId || sourceUrl, hash]);
    const payload = {
      tenant_key: tenant,
      run_id: run,
      // O subject id é determinístico por (tenant, run, benchmark): resolvido
      // aqui para a linha ser auto-suficiente sem JOIN.
      subject_id: subjectId ? String(subjectId) : deterministicId('brs', [tenant, run, benchmark]),
      benchmark_id: benchmark,
      source_id: sourceId ? String(sourceId) : null,
      url: sourceUrl,
      content_hash: hash,
      retrieved_at: retrievedAt ? new Date(retrievedAt) : new Date(),
      inspected_at: inspectedAt ? new Date(inspectedAt) : new Date(),
      document_type: documentType ? String(documentType) : null,
      provider: provider ? String(provider) : null,
      documentation_status: String(documentationStatus),
      api_status: String(apiStatus),
      capability_axis_status: String(axisStatuses.CAPABILITY_AXIS || 'NOT_RESEARCHED'),
      journey_axis_status: String(axisStatuses.JOURNEY_AXIS || 'NOT_RESEARCHED'),
      business_rule_axis_status: String(axisStatuses.BUSINESS_RULE_AXIS || 'NOT_RESEARCHED'),
      errors: Array.isArray(errors) ? errors : [],
      metadata: jsonObject(metadata),
    };

    const existing = await inspection.findByPk(id);
    if (existing) {
      await existing.update(payload);
      return existing;
    }
    return inspection.create({ id, ...payload });
  }

  async function listSourceInspections({ tenantId, runId, benchmarkId = null }) {
    const { inspection } = resolveModels();
    const where = { tenant_key: requireNonEmpty(tenantId, 'tenantId'), run_id: requireNonEmpty(runId, 'runId') };
    if (benchmarkId) where.benchmark_id = String(benchmarkId);
    return inspection.findAll({ where, order: [['inspected_at', 'ASC']] });
  }

  /**
   * Ids de benchmarks JÁ ANALISADOS na vertical, em qualquer run — a verdade
   * DURÁVEL de "já pesquisado" (run real r18, 2026-09-17): o sample esquece
   * benchmark graduado (o gerador re-deriva as entradas gerenciadas), então a
   * exclusão derivada só do sample evapora e o market discovery re-seleciona
   * vendor já pesquisado — re-pesquisa mede novidade ~0 e desliza a janela de
   * saturação sem conhecimento novo (gaming estrutural do denominador).
   */
  async function listAnalyzedBenchmarkIds({ tenantId, vertical }) {
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const runs = await listRuns({ tenantId: tenant, vertical: requireNonEmpty(vertical, 'vertical') });
    const ids = new Set();
    for (const run of runs) {
      const runId = typeof run.get === 'function' ? run.get({ plain: true }).id : run.id;
      const subjects = await listSubjects({ tenantId: tenant, runId });
      for (const subject of subjects) {
        const row = typeof subject.get === 'function' ? subject.get({ plain: true }) : subject;
        if (row.analyzed_at) ids.add(String(row.benchmark_id));
      }
    }
    return [...ids].sort();
  }

  return {
    errorCodes: ERROR_CODES,
    getRun,
    listRuns,
    openRun,
    updateRunState,
    listSubjects,
    getSubject,
    updateSubjectResearchState,
    markSubjectAnalyzed,
    upsertSource,
    listSources,
    appendEvidence,
    listEvidence,
    insertFinding,
    listFindings,
    upsertSourceInspection,
    listSourceInspections,
    listAnalyzedBenchmarkIds,
  };
}

module.exports = {
  ERROR_CODES,
  deterministicId,
  toIso,
  createBenchmarkResearchStore,
};
