'use strict';

/**
 * Store de pesquisa de benchmarks EM MEMÓRIA — exclusivo de TESTES.
 *
 * Ele existe para que a POLÍTICA (ordem de discovery, holdout, evidência
 * obrigatória) possa ser exercitada sem banco, sem que produção tenha qualquer
 * fallback em memória. O contrato é o MESMO de
 * `api/services/benchmark/benchmarkResearchStore.js` (Postgres) — e é verificado
 * pelo teste de paridade de contrato.
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

function createBenchmarkResearchMemoryStore() {
  const state = {
    runs: new Map(), subjects: new Map(), sources: new Map(), evidence: new Map(),
    findings: new Map(), inspections: new Map(),
  };

  function required(value, field) {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      const error = new Error(`benchmark_research_store_invalid: ${field} é obrigatório`);
      error.code = 'benchmark_research_store_invalid';
      throw error;
    }
    return normalized;
  }

  async function getRun({ tenantId, vertical, researchVersion = null }) {
    const tenant = required(tenantId, 'tenantId');
    const verticalId = required(vertical, 'vertical');
    const matches = [...state.runs.values()]
      .filter((row) => row.tenant_key === tenant && row.vertical === verticalId
        && (!researchVersion || row.research_version === String(researchVersion)));
    matches.sort((a, b) => String(b.registered_at).localeCompare(String(a.registered_at)));
    return clone(matches[0] || null);
  }

  /** TODOS os runs de `(tenant, vertical)` em ordem cronológica ASC (FITNESS-ABS-14). */
  async function listRuns({ tenantId, vertical }) {
    const tenant = required(tenantId, 'tenantId');
    const verticalId = required(vertical, 'vertical');
    const matches = [...state.runs.values()]
      .filter((row) => row.tenant_key === tenant && row.vertical === verticalId);
    matches.sort((a, b) => String(a.registered_at).localeCompare(String(b.registered_at)));
    return clone(matches);
  }

  async function openRun({ tenantId, vertical, researchVersion, benchmarkIds = [], holdoutBenchmarkId = null, registeredAt = null, metadata = {} }) {
    const tenant = required(tenantId, 'tenantId');
    const verticalId = required(vertical, 'vertical');
    const version = required(researchVersion, 'researchVersion');
    const ids = (Array.isArray(benchmarkIds) ? benchmarkIds : []).map((id) => String(id ?? '').trim()).filter(Boolean);
    if (ids.length === 0) throw new Error('benchmark_research_store_invalid: discovery set vazio');
    if (new Set(ids).size !== ids.length) throw new Error('benchmark_research_store_invalid: discovery set com duplicatas');

    const id = deterministicId('brr', [tenant, verticalId, version]);
    if (state.runs.has(id)) return clone(state.runs.get(id));

    const row = {
      id,
      tenant_key: tenant,
      vertical: verticalId,
      research_version: version,
      state: 'RESEARCH_DISCOVERY_OPEN',
      holdout_benchmark_id: holdoutBenchmarkId ? String(holdoutBenchmarkId) : null,
      saturation_reached: false,
      registered_at: registeredAt || new Date().toISOString(),
      discovery_set: ids,
      metadata: metadata || {},
    };
    state.runs.set(id, row);
    for (const [index, benchmarkId] of ids.entries()) {
      const subjectId = deterministicId('brs', [tenant, id, benchmarkId]);
      if (!state.subjects.has(subjectId)) {
        state.subjects.set(subjectId, {
          id: subjectId,
          tenant_key: tenant,
          run_id: id,
          benchmark_id: benchmarkId,
          discovery_order: index + 1,
          analyzed_at: null,
          research_version: null,
          findings_inventory: null,
          market_archetype_mapping: null,
        });
      }
    }
    return clone(row);
  }

  async function updateRunState({ tenantId, runId, state: nextState = null, saturationReached = null }) {
    const row = state.runs.get(required(runId, 'runId'));
    if (!row || row.tenant_key !== required(tenantId, 'tenantId')) {
      throw new Error(`benchmark_research_store_invalid: run inexistente: ${runId}`);
    }
    if (nextState) row.state = String(nextState);
    if (saturationReached !== null) row.saturation_reached = saturationReached === true;
    return clone(row);
  }

  async function listSubjects({ tenantId, runId }) {
    return [...state.subjects.values()]
      .filter((row) => row.tenant_key === tenantId && row.run_id === runId)
      .sort((a, b) => a.discovery_order - b.discovery_order)
      .map(clone);
  }

  async function getSubject({ tenantId, runId, benchmarkId }) {
    const matches = [...state.subjects.values()].filter((row) => row.tenant_key === tenantId
      && row.run_id === runId && row.benchmark_id === benchmarkId);
    return clone(matches[0] || null);
  }

  async function markSubjectAnalyzed({ tenantId, runId, benchmarkId, analyzedAt, researchVersion, findingsInventory, marketArchetypeMapping }) {
    const row = [...state.subjects.values()].find((s) => s.tenant_key === tenantId
      && s.run_id === runId && s.benchmark_id === benchmarkId);
    if (!row) throw new Error(`benchmark_research_store_invalid: benchmark fora do discovery set: ${benchmarkId}`);
    row.analyzed_at = analyzedAt || new Date().toISOString();
    row.research_version = researchVersion;
    row.findings_inventory = Array.isArray(findingsInventory) ? findingsInventory : [];
    row.market_archetype_mapping = marketArchetypeMapping || null;
    return clone(row);
  }

  async function upsertSource({ tenantId, runId, benchmarkId, source }) {
    const tenant = required(tenantId, 'tenantId');
    const url = required(source?.url, 'source.url');
    const id = deterministicId('brsrc', [tenant, runId, benchmarkId, url]);
    const existing = state.sources.get(id);
    const payload = {
      tier: Number.isFinite(Number(source?.tier)) ? Number(source.tier) : null,
      specificity: source?.specificity ? String(source.specificity) : null,
      http_status: Number.isFinite(Number(source?.httpStatus)) ? Number(source.httpStatus) : null,
      verified: source?.verified === true,
      verification_state: String(source?.verificationState || 'UNVERIFIED'),
      verified_at: source?.verified === true ? new Date().toISOString() : null,
    };
    if (existing) {
      Object.assign(existing, payload);
      return clone(existing);
    }
    const row = { id, tenant_key: tenant, run_id: runId, benchmark_id: benchmarkId, url, ...payload };
    state.sources.set(id, row);
    return clone(row);
  }

  async function updateSubjectResearchState({ tenantId, runId, benchmarkId, patch = {} }) {
    const tenant = required(tenantId, 'tenantId');
    const subjectId = deterministicId('brs', [tenant, required(runId, 'runId'), required(benchmarkId, 'benchmarkId')]);
    const row = state.subjects.get(subjectId);
    if (!row) {
      const error = new Error(`benchmark_research_store_invalid: benchmark fora do discovery set: ${benchmarkId}`);
      error.code = 'benchmark_research_store_invalid';
      throw error;
    }
    const metadata = { ...(row.metadata || {}) };
    if (patch.axes) metadata.researchAxes = { ...(metadata.researchAxes || {}), ...patch.axes };
    if (patch.inspections) metadata.inspections = { ...(metadata.inspections || {}), ...patch.inspections };
    if (patch.extraction) metadata.extraction = { ...(metadata.extraction || {}), ...patch.extraction };
    if (patch.metadata) Object.assign(metadata, patch.metadata);
    row.metadata = metadata;
    return clone(row);
  }

  async function listSources({ tenantId, runId, benchmarkId = null }) {
    return [...state.sources.values()]
      .filter((row) => row.tenant_key === tenantId && row.run_id === runId
        && (!benchmarkId || row.benchmark_id === benchmarkId))
      .map(clone);
  }

  async function appendEvidence({ tenantId, runId, benchmarkId, sourceId = null, evidenceRef, contentHash = null, httpStatus = null, capturedAt = null, metadata = {} }) {
    const tenant = required(tenantId, 'tenantId');
    const ref = required(evidenceRef, 'evidenceRef');
    const id = deterministicId('bre', [tenant, runId, benchmarkId, ref]);
    if (state.evidence.has(id)) return clone(state.evidence.get(id));
    const row = {
      id,
      tenant_key: tenant,
      run_id: runId,
      benchmark_id: benchmarkId,
      source_id: sourceId || null,
      evidence_ref: ref,
      content_hash: contentHash || null,
      http_status: Number.isFinite(Number(httpStatus)) ? Number(httpStatus) : null,
      captured_at: capturedAt || new Date().toISOString(),
      metadata: metadata || {},
    };
    state.evidence.set(id, row);
    return clone(row);
  }

  async function listEvidence({ tenantId, runId, benchmarkId = null }) {
    return [...state.evidence.values()]
      .filter((row) => row.tenant_key === tenantId && row.run_id === runId
        && (!benchmarkId || row.benchmark_id === benchmarkId))
      .map(clone);
  }

  async function insertFinding({ tenantId, runId, benchmarkId, kind, externalName = null, canonicalId = null, classification = null, archetype = null, verified = false, verificationState = 'UNVERIFIED', sourceId = null, evidenceId = null, recordedAt = null, metadata = {} }) {
    const tenant = required(tenantId, 'tenantId');
    const findingKind = required(kind, 'kind');
    const id = deterministicId('brf', [tenant, runId, benchmarkId, findingKind, externalName || '', canonicalId || '', evidenceId || '']);
    if (state.findings.has(id)) return clone(state.findings.get(id));
    const row = {
      id,
      tenant_key: tenant,
      run_id: runId,
      benchmark_id: benchmarkId,
      kind: findingKind,
      external_name: externalName || null,
      canonical_id: canonicalId || null,
      classification: classification || null,
      archetype: archetype || null,
      verified: verified === true,
      verification_state: String(verificationState),
      source_id: sourceId || null,
      evidence_id: evidenceId || null,
      recorded_at: recordedAt || new Date().toISOString(),
      metadata: metadata || {},
    };
    state.findings.set(id, row);
    return clone(row);
  }

  async function listFindings({ tenantId, runId, benchmarkId = null }) {
    return [...state.findings.values()]
      .filter((row) => row.tenant_key === tenantId && row.run_id === runId
        && (!benchmarkId || row.benchmark_id === benchmarkId))
      .map(clone);
  }

  async function retireFinding({ tenantId, findingId, state: nextState, metadata = {} }) {
    const tenant = required(tenantId, 'tenantId');
    const id = required(findingId, 'findingId');
    const row = state.findings.get(id);
    if (!row || row.tenant_key !== tenant) {
      const error = new Error(`benchmark_research_store_invalid: achado inexistente: ${id}`);
      error.code = 'benchmark_research_store_invalid';
      throw error;
    }
    if (['SUPERSEDED', 'REJECTED', 'STALE_SEMANTICS'].includes(String(row.verification_state))) {
      return { row: clone(row), retired: false, alreadyRetired: true };
    }
    row.metadata = {
      ...(row.metadata || {}),
      previousVerificationState: row.verification_state,
      retiredAt: new Date().toISOString(),
      ...(metadata || {}),
    };
    row.verification_state = String(nextState);
    return { row: clone(row), retired: true, alreadyRetired: false };
  }

  async function correctRetirement({ tenantId, findingId, expectedReprocessRunId, state: nextState, metadata = {}, correctionReason }) {
    const tenant = required(tenantId, 'tenantId');
    const id = required(findingId, 'findingId');
    const runRef = required(expectedReprocessRunId, 'expectedReprocessRunId');
    const reason = required(correctionReason, 'correctionReason');
    const row = state.findings.get(id);
    if (!row || row.tenant_key !== tenant) {
      const error = new Error(`benchmark_research_store_invalid: achado inexistente: ${id}`);
      error.code = 'benchmark_research_store_invalid';
      throw error;
    }
    const current = row.metadata || {};
    if (!['SUPERSEDED', 'REJECTED', 'STALE_SEMANTICS'].includes(String(row.verification_state))) {
      const error = new Error(`benchmark_research_store_invalid: achado ${id} não está aposentado — correção exige estado aposentado`);
      error.code = 'benchmark_research_store_invalid';
      throw error;
    }
    if (String(current.reprocessRunId || '') !== runRef) {
      const error = new Error(`benchmark_research_store_invalid: aposento de ${id} pertence a outro run — correção recusada`);
      error.code = 'benchmark_research_store_invalid';
      throw error;
    }
    row.metadata = {
      ...current,
      ...(metadata || {}),
      retirementCorrection: {
        from: row.verification_state,
        fromReason: current.supersededReason || null,
        to: String(nextState),
        toReason: (metadata || {}).supersededReason || null,
        reason,
        correctedAt: new Date().toISOString(),
      },
    };
    row.verification_state = String(nextState);
    return { row: clone(row), corrected: true };
  }

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
    const tenant = required(tenantId, 'tenantId');
    const run = required(runId, 'runId');
    const benchmark = required(benchmarkId, 'benchmarkId');
    const sourceUrl = required(url, 'url');
    const hash = required(contentHash, 'contentHash');

    const id = deterministicId('brsi', [tenant, run, benchmark, sourceId || sourceUrl, hash]);
    const payload = {
      tenant_key: tenant,
      run_id: run,
      subject_id: subjectId ? String(subjectId) : deterministicId('brs', [tenant, run, benchmark]),
      benchmark_id: benchmark,
      source_id: sourceId ? String(sourceId) : null,
      url: sourceUrl,
      content_hash: hash,
      retrieved_at: retrievedAt || new Date().toISOString(),
      inspected_at: inspectedAt || new Date().toISOString(),
      document_type: documentType ? String(documentType) : null,
      provider: provider ? String(provider) : null,
      documentation_status: String(documentationStatus),
      api_status: String(apiStatus),
      capability_axis_status: String(axisStatuses.CAPABILITY_AXIS || 'NOT_RESEARCHED'),
      journey_axis_status: String(axisStatuses.JOURNEY_AXIS || 'NOT_RESEARCHED'),
      business_rule_axis_status: String(axisStatuses.BUSINESS_RULE_AXIS || 'NOT_RESEARCHED'),
      errors: Array.isArray(errors) ? errors : [],
      metadata: metadata || {},
    };
    const existing = state.inspections.get(id);
    if (existing) {
      Object.assign(existing, payload);
      return clone(existing);
    }
    const row = { id, ...payload };
    state.inspections.set(id, row);
    return clone(row);
  }

  async function listSourceInspections({ tenantId, runId, benchmarkId = null }) {
    return [...state.inspections.values()]
      .filter((row) => row.tenant_key === tenantId && row.run_id === runId
        && (!benchmarkId || row.benchmark_id === benchmarkId))
      .map(clone);
  }

  /**
   * Mesmo contrato do store Postgres (`listAnalyzedBenchmarkIds`): ids de
   * benchmarks já analisados na vertical, em qualquer run.
   */
  async function listAnalyzedBenchmarkIds({ tenantId, vertical }) {
    const runIds = [...state.runs.values()]
      .filter((row) => row.tenant_key === tenantId && row.vertical === vertical)
      .map((row) => row.id);
    const ids = new Set();
    for (const row of state.subjects.values()) {
      if (row.tenant_key === tenantId && runIds.includes(row.run_id) && row.analyzed_at) {
        ids.add(String(row.benchmark_id));
      }
    }
    return [...ids].sort();
  }

  return {
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
    retireFinding,
    correctRetirement,
    upsertSourceInspection,
    listSourceInspections,
    listAnalyzedBenchmarkIds,
  };
}

module.exports = { createBenchmarkResearchMemoryStore, deterministicId };
