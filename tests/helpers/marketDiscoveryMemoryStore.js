'use strict';

/**
 * Store de descoberta de mercado EM MEMÓRIA — exclusivo de TESTES.
 *
 * Ele existe para que a POLÍTICA (evidência obrigatória, independência,
 * seleção determinística, anti-leakage do holdout) possa ser exercitada sem
 * banco, sem que produção tenha qualquer fallback em memória. O contrato é o
 * MESMO de `api/services/marketDiscovery/marketDiscoveryStore.js` (Postgres).
 *
 * O estado é compartilhável por injeção (`createMarketDiscoveryMemoryStore({
 * state })`): duas instâncias sobre o mesmo `state` simulam RESTART de
 * processo — a segunda instância enxerga tudo o que a primeira persistiu.
 *
 * Nunca importe este módulo de dentro de `api/`.
 */

const crypto = require('crypto');

function deterministicId(prefix, parts) {
  const digest = crypto.createHash('sha256').update(parts.map((p) => String(p ?? '')).join('\u0000')).digest('hex');
  return `${prefix}-${digest.slice(0, 48)}`;
}

function clone(row) {
  if (!row) return null;
  return JSON.parse(JSON.stringify(row));
}

function required(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    const error = new Error(`market_discovery_store_invalid: ${field} é obrigatório`);
    error.code = 'market_discovery_store_invalid';
    throw error;
  }
  return normalized;
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function jsonObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function optionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function createMarketDiscoveryMemoryStore({ state } = {}) {
  const backing = state || { runs: new Map(), archetypes: new Map(), candidates: new Map(), sets: new Map() };

  async function getRun({ tenantId, vertical, discoveryVersion = null }) {
    const tenant = required(tenantId, 'tenantId');
    const verticalId = required(vertical, 'vertical');
    const matches = [...backing.runs.values()]
      .filter((row) => row.tenant_key === tenant && row.vertical === verticalId
        && (!discoveryVersion || row.discovery_version === String(discoveryVersion)));
    matches.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
    return clone(matches[0] || null);
  }

  async function getRunById({ tenantId, runId }) {
    const tenant = required(tenantId, 'tenantId');
    const id = required(runId, 'runId');
    const row = backing.runs.get(id);
    return row && row.tenant_key === tenant ? clone(row) : null;
  }

  async function openRun({ tenantId, vertical, discoveryVersion, startedAt = null, metadata = {} }) {
    const tenant = required(tenantId, 'tenantId');
    const verticalId = required(vertical, 'vertical');
    const version = required(discoveryVersion, 'discoveryVersion');
    const id = deterministicId('mdr', [tenant, verticalId, version]);
    if (backing.runs.has(id)) return clone(backing.runs.get(id));
    const row = {
      id,
      tenant_key: tenant,
      vertical: verticalId,
      discovery_version: version,
      state: 'MARKET_DISCOVERY_OPEN',
      started_at: startedAt || new Date().toISOString(),
      completed_at: null,
      metadata: metadata || {},
    };
    backing.runs.set(id, row);
    return clone(row);
  }

  async function updateRunState({ tenantId, runId, state: nextState = null, metadata = null, completedAt = undefined }) {
    const row = backing.runs.get(required(runId, 'runId'));
    if (!row || row.tenant_key !== required(tenantId, 'tenantId')) {
      const error = new Error(`market_discovery_store_invalid: run inexistente: ${runId}`);
      error.code = 'market_discovery_store_invalid';
      throw error;
    }
    if (nextState) row.state = String(nextState);
    if (completedAt !== undefined) row.completed_at = completedAt || null;
    if (metadata) row.metadata = { ...jsonObject(row.metadata, {}), ...jsonObject(metadata, {}) };
    return clone(row);
  }

  async function listRuns({ tenantId, vertical = null }) {
    const tenant = required(tenantId, 'tenantId');
    return [...backing.runs.values()]
      .filter((row) => row.tenant_key === tenant && (!vertical || row.vertical === vertical))
      .map(clone);
  }

  async function upsertArchetype({ tenantId, runId = null, archetype }) {
    const tenant = required(tenantId, 'tenantId');
    const vertical = required(archetype?.vertical, 'archetype.vertical');
    const key = required(archetype?.archetypeKey, 'archetype.archetypeKey');
    const id = deterministicId('mar', [tenant, vertical, key]);
    const payload = {
      id,
      tenant_key: tenant,
      vertical,
      run_id: runId ? String(runId) : null,
      archetype_key: key,
      name: required(archetype?.name, 'archetype.name'),
      description: optionalString(archetype?.description),
      importance: String(archetype?.importance || 'RELEVANT').toUpperCase(),
      state: String(archetype?.state || 'EVIDENCE_REQUIRED'),
      origin: String(archetype?.origin || 'research'),
      source_evidence: jsonArray(archetype?.sourceEvidence),
      rationale: optionalString(archetype?.rationale),
      validated_at: archetype?.validatedAt || null,
      metadata: jsonObject(archetype?.metadata),
    };
    backing.archetypes.set(id, { ...(backing.archetypes.get(id) || {}), ...payload });
    return clone(backing.archetypes.get(id));
  }

  async function listArchetypes({ tenantId, vertical }) {
    const tenant = required(tenantId, 'tenantId');
    const verticalId = required(vertical, 'vertical');
    return [...backing.archetypes.values()]
      .filter((row) => row.tenant_key === tenant && row.vertical === verticalId)
      .sort((a, b) => a.archetype_key.localeCompare(b.archetype_key))
      .map(clone);
  }

  async function getArchetype({ tenantId, vertical, archetypeKey }) {
    const id = deterministicId('mar', [required(tenantId, 'tenantId'), required(vertical, 'vertical'), required(archetypeKey, 'archetypeKey')]);
    return clone(backing.archetypes.get(id) || null);
  }

  async function upsertCandidate({ tenantId, runId = null, candidate }) {
    const tenant = required(tenantId, 'tenantId');
    const vertical = required(candidate?.vertical, 'candidate.vertical');
    const key = required(candidate?.candidateKey, 'candidate.candidateKey');
    const id = deterministicId('mca', [tenant, vertical, key]);
    const existing = backing.candidates.get(id) || {};
    const payload = {
      id,
      tenant_key: tenant,
      vertical,
      run_id: runId ? String(runId) : null,
      candidate_key: key,
      name: required(candidate?.name, 'candidate.name'),
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
    backing.candidates.set(id, {
      profile: null,
      profiled_at: null,
      deep_research_at: null,
      ...existing,
      ...payload,
    });
    return clone(backing.candidates.get(id));
  }

  async function updateCandidateProfile({ tenantId, candidateId, profile, profiledAt = null }) {
    const row = backing.candidates.get(required(candidateId, 'candidateId'));
    if (!row || row.tenant_key !== required(tenantId, 'tenantId')) {
      const error = new Error(`market_discovery_store_invalid: candidato inexistente: ${candidateId}`);
      error.code = 'market_discovery_store_invalid';
      throw error;
    }
    row.profile = jsonObject(profile);
    row.profiled_at = profiledAt || new Date().toISOString();
    return clone(row);
  }

  async function markDeepResearchStarted({ tenantId, candidateId, startedAt = null, researchRunId = null }) {
    const row = backing.candidates.get(required(candidateId, 'candidateId'));
    if (!row || row.tenant_key !== required(tenantId, 'tenantId')) {
      const error = new Error(`market_discovery_store_invalid: candidato inexistente: ${candidateId}`);
      error.code = 'market_discovery_store_invalid';
      throw error;
    }
    if (row.deep_research_at) return clone(row);
    row.deep_research_at = startedAt || new Date().toISOString();
    if (researchRunId) row.metadata = { ...jsonObject(row.metadata, {}), deepResearchRunId: String(researchRunId) };
    return clone(row);
  }

  async function listCandidates({ tenantId, vertical, state: filterState = null, runId = null }) {
    const tenant = required(tenantId, 'tenantId');
    const verticalId = required(vertical, 'vertical');
    return [...backing.candidates.values()]
      .filter((row) => row.tenant_key === tenant && row.vertical === verticalId
        && (!filterState || row.state === filterState)
        && (!runId || row.run_id === String(runId)))
      .sort((a, b) => a.candidate_key.localeCompare(b.candidate_key))
      .map(clone);
  }

  async function getCandidate({ tenantId, vertical, candidateKey }) {
    const id = deterministicId('mca', [required(tenantId, 'tenantId'), required(vertical, 'vertical'), required(candidateKey, 'candidateKey')]);
    return clone(backing.candidates.get(id) || null);
  }

  async function recordDiscoverySet({ tenantId, runId = null, set }) {
    const tenant = required(tenantId, 'tenantId');
    const vertical = required(set?.vertical, 'set.vertical');
    const version = required(set?.discoverySetVersion, 'set.discoverySetVersion');
    const selected = jsonArray(set?.selectedCandidates).map((id) => String(id ?? '').trim()).filter(Boolean);
    if (selected.length === 0) {
      const error = new Error('market_discovery_store_invalid: discovery set vazio');
      error.code = 'market_discovery_store_invalid';
      throw error;
    }
    if (new Set(selected).size !== selected.length) {
      const error = new Error('market_discovery_store_invalid: discovery set com duplicatas');
      error.code = 'market_discovery_store_invalid';
      throw error;
    }
    const id = deterministicId('mds', [tenant, vertical, version]);
    const existing = backing.sets.get(id) || {};
    const payload = {
      id,
      tenant_key: tenant,
      vertical,
      run_id: runId ? String(runId) : null,
      discovery_set_version: version,
      state: String(set?.state || 'SELECTED'),
      selected_candidates: selected,
      selection_rationale: jsonArray(set?.selectionRationale),
      selection_policy: jsonObject(set?.selectionPolicy),
      metadata: jsonObject(set?.metadata),
    };
    backing.sets.set(id, {
      holdout_candidate_id: null,
      holdout_selected_at: null,
      holdout_selection_basis: null,
      holdout_preregistered: false,
      opened_at: null,
      deep_research_run_id: null,
      created_at: new Date().toISOString(),
      ...existing,
      ...payload,
    });
    return clone(backing.sets.get(id));
  }

  async function getDiscoverySet({ tenantId, setId }) {
    const row = backing.sets.get(required(setId, 'setId'));
    if (!row || row.tenant_key !== required(tenantId, 'tenantId')) return null;
    return clone(row);
  }

  async function getLatestDiscoverySet({ tenantId, vertical }) {
    const tenant = required(tenantId, 'tenantId');
    const verticalId = required(vertical, 'vertical');
    const matches = [...backing.sets.values()]
      .filter((row) => row.tenant_key === tenant && row.vertical === verticalId);
    matches.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return clone(matches[0] || null);
  }

  async function updateDiscoverySet({ tenantId, setId, patch = {} }) {
    const row = backing.sets.get(required(setId, 'setId'));
    if (!row || row.tenant_key !== required(tenantId, 'tenantId')) {
      const error = new Error(`market_discovery_store_invalid: discovery set inexistente: ${setId}`);
      error.code = 'market_discovery_store_invalid';
      throw error;
    }
    if (patch.state) row.state = String(patch.state);
    if (patch.holdoutCandidateId !== undefined) row.holdout_candidate_id = optionalString(patch.holdoutCandidateId);
    if (patch.holdoutSelectedAt !== undefined) row.holdout_selected_at = patch.holdoutSelectedAt || null;
    if (patch.holdoutSelectionBasis !== undefined) row.holdout_selection_basis = patch.holdoutSelectionBasis || null;
    if (patch.holdoutPreregistered !== undefined) row.holdout_preregistered = patch.holdoutPreregistered === true;
    if (patch.openedAt !== undefined) row.opened_at = patch.openedAt || null;
    if (patch.deepResearchRunId !== undefined) row.deep_research_run_id = optionalString(patch.deepResearchRunId);
    if (patch.metadata) row.metadata = { ...jsonObject(row.metadata, {}), ...jsonObject(patch.metadata, {}) };
    return clone(row);
  }

  return {
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

module.exports = { createMarketDiscoveryMemoryStore, deterministicId };
