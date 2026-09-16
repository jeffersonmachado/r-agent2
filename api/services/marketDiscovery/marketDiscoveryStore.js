'use strict';

/**
 * marketDiscoveryStore — AUTORIDADE PERSISTENTE da descoberta autônoma de
 * mercado (a camada ANTERIOR ao Discovery Set de benchmarks).
 *
 * Sem este store, a "descoberta de mercado" seria memória de processo: o
 * universo de candidatos, a evidência dos arquétipos e o pré-registro do
 * holdout desapareceriam no restart e nenhuma decisão seria auditável depois
 * da execução.
 *
 * Contrato (implementado por este módulo em produção e pelo store em memória
 * dos testes — `tests/helpers/marketDiscoveryMemoryStore.js`):
 *
 *   openRun / getRun / getRunById / updateRunState / listRuns
 *   upsertArchetype / listArchetypes / getArchetype
 *   upsertCandidate / listCandidates / getCandidate / updateCandidate
 *   recordDiscoverySet / getDiscoverySet / getLatestDiscoverySet / updateDiscoverySet
 *
 * Regras aplicadas AQUI (e não só na camada de política):
 *   - `tenant_key` obrigatório em toda operação: nenhuma leitura cruza tenant;
 *   - IDs determinísticos ⇒ retry/re-run são idempotentes (re-descobrir o
 *     mesmo fornecedor nunca duplica candidato nem infla o universo);
 *   - `deep_research_at` só é gravado por `markDeepResearchStarted`: profiling
 *     de candidato (estágio CANDIDATE ANALYSIS) nunca é confundido com a
 *     pesquisa profunda que o anti-leakage do holdout vigia.
 *
 * Sem `sequelize` inicializado a operação FALHA com `persistence_required` —
 * nunca cai para memória.
 */

const crypto = require('crypto');

const ERROR_CODES = Object.freeze({
  PERSISTENCE_REQUIRED: 'persistence_required',
  INVALID: 'market_discovery_store_invalid',
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

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function optionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
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
    run: require('../../db/models/MarketDiscoveryRun')(),
    archetype: require('../../db/models/MarketArchetype')(),
    candidate: require('../../db/models/MarketCandidate')(),
    discoverySet: require('../../db/models/MarketDiscoverySet')(),
  };
}

/**
 * @param {object} [options]
 * @param {object} [options.models] models injetados (testes de integração)
 */
function createMarketDiscoveryStore({ models } = {}) {
  function resolveModels() {
    const resolved = models || defaultModels();
    for (const key of ['run', 'archetype', 'candidate', 'discoverySet']) {
      if (!resolved[key]) {
        throw storeError(ERROR_CODES.PERSISTENCE_REQUIRED, `model ausente: ${key}`);
      }
    }
    return resolved;
  }

  /** Run mais recente de `(tenant, vertical)` (opcionalmente de uma versão). */
  async function getRun({ tenantId, vertical, discoveryVersion = null }) {
    const { run } = resolveModels();
    const where = { tenant_key: requireNonEmpty(tenantId, 'tenantId'), vertical: requireNonEmpty(vertical, 'vertical') };
    if (discoveryVersion) where.discovery_version = String(discoveryVersion);
    return run.findOne({ where, order: [['started_at', 'DESC']] });
  }

  /**
   * Abre o run de descoberta. Idempotente por `(tenant, vertical, version)`:
   * reabrir o mesmo run não recria história nem reinicia a máquina de estados.
   */
  async function openRun({ tenantId, vertical, discoveryVersion, startedAt = null, metadata = {} }) {
    const { run } = resolveModels();
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const verticalId = requireNonEmpty(vertical, 'vertical');
    const version = requireNonEmpty(discoveryVersion, 'discoveryVersion');

    const id = deterministicId('mdr', [tenant, verticalId, version]);
    const existing = await run.findByPk(id);
    if (existing) return existing;

    return run.create({
      id,
      tenant_key: tenant,
      vertical: verticalId,
      discovery_version: version,
      state: 'MARKET_DISCOVERY_OPEN',
      started_at: startedAt ? new Date(startedAt) : new Date(),
      metadata: jsonObject(metadata),
    });
  }

  async function updateRunState({ tenantId, runId, state = null, metadata = null, completedAt = undefined }) {
    const { run } = resolveModels();
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const row = await run.findOne({ where: { id: requireNonEmpty(runId, 'runId'), tenant_key: tenant } });
    if (!row) throw storeError(ERROR_CODES.INVALID, `run inexistente: ${runId}`);
    const patch = {};
    if (state) patch.state = String(state);
    if (completedAt !== undefined) patch.completed_at = completedAt ? new Date(completedAt) : null;
    if (metadata) patch.metadata = { ...jsonObject(row.metadata, {}), ...jsonObject(metadata, {}) };
    if (Object.keys(patch).length > 0) await row.update(patch);
    return row;
  }

  /** Run pelo ID determinístico (leitura pós-restart: o ID é a identidade). */
  async function getRunById({ tenantId, runId }) {
    const { run } = resolveModels();
    return run.findOne({
      where: { id: requireNonEmpty(runId, 'runId'), tenant_key: requireNonEmpty(tenantId, 'tenantId') },
    });
  }

  async function listRuns({ tenantId, vertical = null }) {
    const { run } = resolveModels();
    const where = { tenant_key: requireNonEmpty(tenantId, 'tenantId') };
    if (vertical) where.vertical = String(vertical);
    return run.findAll({ where, order: [['started_at', 'DESC']] });
  }

  /**
   * Arquétipo é idempotente por `(tenant, vertical, archetype_key)`: a
   * revalidação ATUALIZA o estado (a evidência pode mudar o veredito), mas
   * nunca cria um segundo arquétipo com a mesma identidade.
   */
  async function upsertArchetype({ tenantId, runId = null, archetype }) {
    const { archetype: archetypeModel } = resolveModels();
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const vertical = requireNonEmpty(archetype?.vertical, 'archetype.vertical');
    const key = requireNonEmpty(archetype?.archetypeKey, 'archetype.archetypeKey');

    const id = deterministicId('mar', [tenant, vertical, key]);
    const payload = {
      run_id: runId ? String(runId) : null,
      name: requireNonEmpty(archetype?.name, 'archetype.name'),
      description: optionalString(archetype?.description),
      importance: String(archetype?.importance || 'RELEVANT').toUpperCase(),
      state: String(archetype?.state || 'EVIDENCE_REQUIRED'),
      origin: String(archetype?.origin || 'research'),
      source_evidence: jsonArray(archetype?.sourceEvidence),
      rationale: optionalString(archetype?.rationale),
      validated_at: archetype?.validatedAt ? new Date(archetype.validatedAt) : null,
      metadata: jsonObject(archetype?.metadata),
    };
    const existing = await archetypeModel.findByPk(id);
    if (existing) {
      await existing.update(payload);
      return existing;
    }
    return archetypeModel.create({ id, tenant_key: tenant, vertical, archetype_key: key, ...payload });
  }

  async function listArchetypes({ tenantId, vertical }) {
    const { archetype } = resolveModels();
    return archetype.findAll({
      where: { tenant_key: requireNonEmpty(tenantId, 'tenantId'), vertical: requireNonEmpty(vertical, 'vertical') },
      order: [['archetype_key', 'ASC']],
    });
  }

  async function getArchetype({ tenantId, vertical, archetypeKey }) {
    const { archetype } = resolveModels();
    return archetype.findOne({
      where: {
        tenant_key: requireNonEmpty(tenantId, 'tenantId'),
        vertical: requireNonEmpty(vertical, 'vertical'),
        archetype_key: requireNonEmpty(archetypeKey, 'archetypeKey'),
      },
    });
  }

  /**
   * Candidato é idempotente por `(tenant, vertical, candidate_key)`:
   * re-descobrir o mesmo fornecedor ATUALIZA evidência/estado, nunca duplica.
   * `deep_research_at` NÃO é gravado aqui — ver `markDeepResearchStarted`.
   */
  async function upsertCandidate({ tenantId, runId = null, candidate }) {
    const { candidate: candidateModel } = resolveModels();
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const vertical = requireNonEmpty(candidate?.vertical, 'candidate.vertical');
    const key = requireNonEmpty(candidate?.candidateKey, 'candidate.candidateKey');

    const id = deterministicId('mca', [tenant, vertical, key]);
    const payload = {
      run_id: runId ? String(runId) : null,
      name: requireNonEmpty(candidate?.name, 'candidate.name'),
      vendor: optionalString(candidate?.vendor),
      official_site: optionalString(candidate?.officialSite),
      official_docs: optionalString(candidate?.officialDocs),
      api_docs: optionalString(candidate?.apiDocs),
      country: optionalString(candidate?.country),
      region: optionalString(candidate?.region),
      segments: jsonArray(candidate?.segments),
      target_customers: jsonArray(candidate?.targetCustomers),
      archetypes: jsonArray(candidate?.archetypes),
      independence_group: optionalString(candidate?.independenceGroup),
      clone_of: optionalString(candidate?.cloneOf),
      base_product: optionalString(candidate?.baseProduct),
      origin: String(candidate?.origin || 'research'),
      state: String(candidate?.state || 'EVIDENCE_REQUIRED'),
      source_evidence: jsonArray(candidate?.sourceEvidence),
      rationale: optionalString(candidate?.rationale),
      metadata: jsonObject(candidate?.metadata),
    };
    const existing = await candidateModel.findByPk(id);
    if (existing) {
      await existing.update(payload);
      return existing;
    }
    return candidateModel.create({ id, tenant_key: tenant, vertical, candidate_key: key, ...payload });
  }

  /**
   * Grava o PROFILING do candidato (estágio CANDIDATE ANALYSIS). Nunca toca
   * `deep_research_at`: as duas datas têm semântica adversarial distinta.
   */
  async function updateCandidateProfile({ tenantId, candidateId, profile, profiledAt = null }) {
    const { candidate } = resolveModels();
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const row = await candidate.findOne({ where: { id: requireNonEmpty(candidateId, 'candidateId'), tenant_key: tenant } });
    if (!row) throw storeError(ERROR_CODES.INVALID, `candidato inexistente: ${candidateId}`);
    await row.update({
      profile: jsonObject(profile),
      profiled_at: profiledAt ? new Date(profiledAt) : new Date(),
    });
    return row;
  }

  /**
   * ÚNICA porta de gravação de `deep_research_at`. O supervisor de descoberta
   * nunca chama este método: quem chama é a integração com o subsistema de
   * benchmark research, DEPOIS do handoff. A data gravada aqui é o que a
   * verificação de leakage do holdout compara com `holdout_selected_at`.
   */
  async function markDeepResearchStarted({ tenantId, candidateId, startedAt = null, researchRunId = null }) {
    const { candidate } = resolveModels();
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const row = await candidate.findOne({ where: { id: requireNonEmpty(candidateId, 'candidateId'), tenant_key: tenant } });
    if (!row) throw storeError(ERROR_CODES.INVALID, `candidato inexistente: ${candidateId}`);
    // Idempotente: a PRIMEIRA abertura da pesquisa profunda é a que conta para
    // o anti-leakage. Sobrescrever a data permitiria "limpar" leakage.
    if (row.deep_research_at) return row;
    const patch = { deep_research_at: startedAt ? new Date(startedAt) : new Date() };
    if (researchRunId) patch.metadata = { ...jsonObject(row.metadata, {}), deepResearchRunId: String(researchRunId) };
    await row.update(patch);
    return row;
  }

  async function listCandidates({ tenantId, vertical, state = null, runId = null }) {
    const { candidate } = resolveModels();
    const where = { tenant_key: requireNonEmpty(tenantId, 'tenantId'), vertical: requireNonEmpty(vertical, 'vertical') };
    if (state) where.state = String(state);
    if (runId) where.run_id = requireNonEmpty(runId, 'runId');
    return candidate.findAll({ where, order: [['candidate_key', 'ASC']] });
  }

  async function getCandidate({ tenantId, vertical, candidateKey }) {
    const { candidate } = resolveModels();
    return candidate.findOne({
      where: {
        tenant_key: requireNonEmpty(tenantId, 'tenantId'),
        vertical: requireNonEmpty(vertical, 'vertical'),
        candidate_key: requireNonEmpty(candidateKey, 'candidateKey'),
      },
    });
  }

  /**
   * Registra o DISCOVERY SET selecionado. Idempotente por
   * `(tenant, vertical, version)`: re-selecionar com a mesma versão atualiza a
   * rationale, nunca cria um segundo set concorrente.
   */
  async function recordDiscoverySet({ tenantId, runId = null, set }) {
    const { discoverySet } = resolveModels();
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const vertical = requireNonEmpty(set?.vertical, 'set.vertical');
    const version = requireNonEmpty(set?.discoverySetVersion, 'set.discoverySetVersion');
    const selected = jsonArray(set?.selectedCandidates).map((id) => String(id ?? '').trim()).filter(Boolean);
    if (selected.length === 0) throw storeError(ERROR_CODES.INVALID, 'discovery set vazio');
    if (new Set(selected).size !== selected.length) throw storeError(ERROR_CODES.INVALID, 'discovery set com duplicatas');

    const id = deterministicId('mds', [tenant, vertical, version]);
    const payload = {
      run_id: runId ? String(runId) : null,
      state: String(set?.state || 'SELECTED'),
      selected_candidates: selected,
      selection_rationale: jsonArray(set?.selectionRationale),
      selection_policy: jsonObject(set?.selectionPolicy),
      metadata: jsonObject(set?.metadata),
    };
    const existing = await discoverySet.findByPk(id);
    if (existing) {
      await existing.update(payload);
      return existing;
    }
    return discoverySet.create({
      id, tenant_key: tenant, vertical, discovery_set_version: version, ...payload,
    });
  }

  async function getDiscoverySet({ tenantId, setId }) {
    const { discoverySet } = resolveModels();
    return discoverySet.findOne({
      where: { id: requireNonEmpty(setId, 'setId'), tenant_key: requireNonEmpty(tenantId, 'tenantId') },
    });
  }

  async function getLatestDiscoverySet({ tenantId, vertical }) {
    const { discoverySet } = resolveModels();
    return discoverySet.findOne({
      where: { tenant_key: requireNonEmpty(tenantId, 'tenantId'), vertical: requireNonEmpty(vertical, 'vertical') },
      order: [['created_at', 'DESC']],
    });
  }

  /**
   * Atualização controlada do discovery set. O patch é montado AQUI para que
   * campos de holdout só mudem pelas transições da máquina de estados do
   * módulo de pré-registro — não por patch livre do chamador.
   */
  async function updateDiscoverySet({ tenantId, setId, patch = {} }) {
    const { discoverySet } = resolveModels();
    const tenant = requireNonEmpty(tenantId, 'tenantId');
    const row = await discoverySet.findOne({ where: { id: requireNonEmpty(setId, 'setId'), tenant_key: tenant } });
    if (!row) throw storeError(ERROR_CODES.INVALID, `discovery set inexistente: ${setId}`);
    const allowed = {};
    if (patch.state) allowed.state = String(patch.state);
    if (patch.holdoutCandidateId !== undefined) allowed.holdout_candidate_id = optionalString(patch.holdoutCandidateId);
    if (patch.holdoutSelectedAt !== undefined) allowed.holdout_selected_at = patch.holdoutSelectedAt ? new Date(patch.holdoutSelectedAt) : null;
    if (patch.holdoutSelectionBasis !== undefined) allowed.holdout_selection_basis = jsonObject(patch.holdoutSelectionBasis, null);
    if (patch.holdoutPreregistered !== undefined) allowed.holdout_preregistered = patch.holdoutPreregistered === true;
    if (patch.openedAt !== undefined) allowed.opened_at = patch.openedAt ? new Date(patch.openedAt) : null;
    if (patch.deepResearchRunId !== undefined) allowed.deep_research_run_id = optionalString(patch.deepResearchRunId);
    if (patch.metadata) allowed.metadata = { ...jsonObject(row.metadata, {}), ...jsonObject(patch.metadata, {}) };
    if (Object.keys(allowed).length > 0) await row.update(allowed);
    return row;
  }

  return {
    errorCodes: ERROR_CODES,
    getRun,
    getRunById,
    openRun,
    updateRunState,
    listRuns,
    upsertArchetype,
    listArchetypes,
    getArchetype,
    upsertCandidate,
    updateCandidateProfile,
    markDeepResearchStarted,
    listCandidates,
    getCandidate,
    recordDiscoverySet,
    getDiscoverySet,
    getLatestDiscoverySet,
    updateDiscoverySet,
  };
}

module.exports = {
  ERROR_CODES,
  deterministicId,
  toIso,
  createMarketDiscoveryStore,
};
