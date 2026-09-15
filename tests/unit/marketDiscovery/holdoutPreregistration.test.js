'use strict';

/**
 * Holdout: pré-registro ANTES de qualquer pesquisa profunda; leakage → FAIL.
 * Semântica consistente com `evaluateHoldout` do benchmarkSufficiencyEngine.
 */

const {
  createHoldoutPreregistration,
  evaluateHoldoutLeakage,
  HOLDOUT_SET_STATES,
  LEAKAGE_REASONS,
} = require('../../../api/services/marketDiscovery/holdoutPreregistration');
const { createMarketDiscoveryMemoryStore } = require('../../helpers/marketDiscoveryMemoryStore');

const TENANT = 'system';
const EVIDENCE = { url: 'https://h.example.com/', evidenceRef: 'ev-h', contentHash: 'sha256:h' };

async function buildFixture({ now = '2026-09-15T12:00:00.000Z' } = {}) {
  const store = createMarketDiscoveryMemoryStore();
  await store.upsertCandidate({
    tenantId: TENANT,
    candidate: {
      vertical: 'fitness',
      candidateKey: 'holdout-candidate',
      name: 'Holdout Candidate',
      state: 'ACCEPTED',
      sourceEvidence: [EVIDENCE],
    },
  });
  await store.upsertCandidate({
    tenantId: TENANT,
    candidate: {
      vertical: 'fitness',
      candidateKey: 'discovery-member',
      name: 'Discovery Member',
      state: 'ACCEPTED',
      sourceEvidence: [EVIDENCE],
    },
  });
  const set = await store.recordDiscoverySet({
    tenantId: TENANT,
    set: {
      vertical: 'fitness',
      discoverySetVersion: 'fitness-v1',
      selectedCandidates: ['discovery-member'],
      selectionRationale: [{ candidateKey: 'discovery-member', score: 90, breakdown: [] }],
      selectionPolicy: { size: 1 },
    },
  });
  const holdouts = createHoldoutPreregistration({ store, now: () => now });
  return { store, set, holdouts, now };
}

describe('holdoutPreregistration — pré-registro antes da pesquisa profunda', () => {
  test('pré-registro persiste selectedAt, selectionBasis e preregistered=true', async () => {
    const { store, set, holdouts, now } = await buildFixture();

    const updated = await holdouts.preregisterHoldout({
      tenantId: TENANT,
      setId: set.id,
      candidateKey: 'holdout-candidate',
      selectionBasis: { reason: 'arquétipo não coberto pelo set', distance: 4 },
    });

    expect(updated.state).toBe(HOLDOUT_SET_STATES.HOLDOUT_PREREGISTERED);
    expect(updated.holdout_candidate_id).toBe('holdout-candidate');
    expect(updated.holdout_selected_at).toBe(now);
    expect(updated.holdout_preregistered).toBe(true);
    expect(updated.holdout_selection_basis).toEqual(expect.objectContaining({ reason: expect.any(String) }));

    const persisted = await store.getDiscoverySet({ tenantId: TENANT, setId: set.id });
    expect(persisted.holdout_preregistered).toBe(true);
  });

  test('abrir pesquisa profunda SEM pré-registro é FAIL (holdout_not_preregistered)', async () => {
    const { store, set, holdouts } = await buildFixture();

    await expect(holdouts.openForDeepResearch({ tenantId: TENANT, setId: set.id }))
      .rejects.toMatchObject({ code: 'market_discovery_holdout_invalid' });

    const persisted = await store.getDiscoverySet({ tenantId: TENANT, setId: set.id });
    expect(persisted.state).toBe(HOLDOUT_SET_STATES.LEAKAGE_DETECTED);
    expect(persisted.metadata.holdoutLeakage.violations).toEqual([
      { reason: LEAKAGE_REASONS.NOT_PREREGISTERED },
    ]);
  });

  test('LEAKAGE: pesquisa profunda no holdout ANTES do pré-registro → FAIL', async () => {
    const { store, set, holdouts } = await buildFixture();
    const candidate = await store.getCandidate({ tenantId: TENANT, vertical: 'fitness', candidateKey: 'holdout-candidate' });

    // A pesquisa profunda "aconteceu" ANTES do holdout ser reservado.
    await store.markDeepResearchStarted({
      tenantId: TENANT,
      candidateId: candidate.id,
      startedAt: '2026-09-15T11:00:00.000Z',
    });

    await expect(holdouts.preregisterHoldout({
      tenantId: TENANT,
      setId: set.id,
      candidateKey: 'holdout-candidate',
      selectionBasis: { reason: 'tardio' },
    })).rejects.toMatchObject({ code: 'market_discovery_holdout_invalid' });

    const persisted = await store.getDiscoverySet({ tenantId: TENANT, setId: set.id });
    expect(persisted.state).toBe(HOLDOUT_SET_STATES.LEAKAGE_DETECTED);
    const reasons = persisted.metadata.holdoutLeakage.violations.map((v) => v.reason);
    expect(reasons).toContain(LEAKAGE_REASONS.ANALYZED_BEFORE_PREREGISTRATION);
  });

  test('leakage no MESMO INSTANTE do pré-registro também é FAIL', () => {
    const verdict = evaluateHoldoutLeakage({
      holdout: { candidateId: 'x', selectedAt: '2026-09-15T12:00:00.000Z', preregistered: true },
      candidate: { candidateKey: 'x', deep_research_at: '2026-09-15T12:00:00.000Z' },
    });
    expect(verdict.status).toBe('FAIL');
    expect(verdict.violations.map((v) => v.reason)).toContain(LEAKAGE_REASONS.SAME_INSTANT);
  });

  test('holdout que faz parte do discovery set é recusado (usado como discovery)', async () => {
    const { set, holdouts } = await buildFixture();
    await expect(holdouts.preregisterHoldout({
      tenantId: TENANT,
      setId: set.id,
      candidateKey: 'discovery-member',
      selectionBasis: { reason: 'inválido' },
    })).rejects.toMatchObject({ code: 'market_discovery_holdout_invalid' });
  });

  test('holdout sem evidência (não ACCEPTED) não pode ser pré-registrado', async () => {
    const { store, set, holdouts } = await buildFixture();
    await store.upsertCandidate({
      tenantId: TENANT,
      candidate: { vertical: 'fitness', candidateKey: 'sem-prova', name: 'Sem Prova', sourceEvidence: [] },
    });
    await expect(holdouts.preregisterHoldout({
      tenantId: TENANT,
      setId: set.id,
      candidateKey: 'sem-prova',
      selectionBasis: { reason: 'inválido' },
    })).rejects.toMatchObject({ code: 'market_discovery_holdout_invalid' });
  });

  test('trocar o holdout depois do pré-registro é recusado', async () => {
    const { store, set, holdouts } = await buildFixture();
    await store.upsertCandidate({
      tenantId: TENANT,
      candidate: { vertical: 'fitness', candidateKey: 'outro', name: 'Outro', state: 'ACCEPTED', sourceEvidence: [EVIDENCE] },
    });
    await holdouts.preregisterHoldout({
      tenantId: TENANT, setId: set.id, candidateKey: 'holdout-candidate', selectionBasis: { reason: 'original' },
    });
    await expect(holdouts.preregisterHoldout({
      tenantId: TENANT, setId: set.id, candidateKey: 'outro', selectionBasis: { reason: 'troca' },
    })).rejects.toMatchObject({ code: 'market_discovery_holdout_invalid' });
  });

  test('fluxo íntegro: pré-registro → abertura para pesquisa profunda', async () => {
    const { store, set, holdouts } = await buildFixture();
    await holdouts.preregisterHoldout({
      tenantId: TENANT, setId: set.id, candidateKey: 'holdout-candidate', selectionBasis: { reason: 'distância máxima' },
    });
    const opened = await holdouts.openForDeepResearch({ tenantId: TENANT, setId: set.id, deepResearchRunId: 'brr-123' });
    expect(opened.state).toBe(HOLDOUT_SET_STATES.OPENED_FOR_RESEARCH);
    expect(opened.deep_research_run_id).toBe('brr-123');
    const persisted = await store.getDiscoverySet({ tenantId: TENANT, setId: set.id });
    expect(persisted.opened_at).toBe('2026-09-15T12:00:00.000Z');
  });

  test('markDeepResearchStarted é idempotente: a PRIMEIRA abertura é a que conta', async () => {
    const { store } = await buildFixture();
    const candidate = await store.getCandidate({ tenantId: TENANT, vertical: 'fitness', candidateKey: 'holdout-candidate' });
    await store.markDeepResearchStarted({ tenantId: TENANT, candidateId: candidate.id, startedAt: '2026-09-15T10:00:00.000Z' });
    const second = await store.markDeepResearchStarted({ tenantId: TENANT, candidateId: candidate.id, startedAt: '2026-09-15T13:00:00.000Z' });
    expect(second.deep_research_at).toBe('2026-09-15T10:00:00.000Z');
  });
});
