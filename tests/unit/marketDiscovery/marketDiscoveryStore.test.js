'use strict';

/**
 * Store: ids determinísticos, upserts idempotentes, estado que sobrevive a
 * restart (instância nova sobre o mesmo backing) e FAIL-CLOSED sem Postgres.
 */

const {
  createMarketDiscoveryStore,
  deterministicId,
  ERROR_CODES,
} = require('../../../api/services/marketDiscovery/marketDiscoveryStore');
const { createMarketDiscoveryMemoryStore } = require('../../helpers/marketDiscoveryMemoryStore');

const TENANT = 'system';

describe('marketDiscoveryStore — ids determinísticos e idempotência', () => {
  test('deterministicId é estável e prefixado', () => {
    const a = deterministicId('mdr', [TENANT, 'fitness', 'v1']);
    const b = deterministicId('mdr', [TENANT, 'fitness', 'v1']);
    expect(a).toBe(b);
    expect(a).toMatch(/^mdr-[0-9a-f]{48}$/);
    expect(deterministicId('mdr', [TENANT, 'fitness', 'v2'])).not.toBe(a);
  });

  test('openRun duplo devolve o MESMO run (sem duplicar história)', async () => {
    const store = createMarketDiscoveryMemoryStore();
    const first = await store.openRun({ tenantId: TENANT, vertical: 'fitness', discoveryVersion: 'v1', startedAt: '2026-09-15T00:00:00.000Z' });
    const second = await store.openRun({ tenantId: TENANT, vertical: 'fitness', discoveryVersion: 'v1', startedAt: '2026-09-16T00:00:00.000Z' });
    expect(second.id).toBe(first.id);
    expect(second.started_at).toBe(first.started_at);
    expect((await store.listRuns({ tenantId: TENANT }))).toHaveLength(1);
  });

  test('upsertCandidate repetido não duplica nem reinicia o registro', async () => {
    const store = createMarketDiscoveryMemoryStore();
    const candidate = {
      vertical: 'fitness',
      candidateKey: 'gymnovo',
      name: 'GymNovo',
      state: 'ACCEPTED',
      sourceEvidence: [{ url: 'https://n.example.com/', evidenceRef: 'ev-1' }],
    };
    const first = await store.upsertCandidate({ tenantId: TENANT, candidate });
    const second = await store.upsertCandidate({ tenantId: TENANT, candidate });
    expect(second.id).toBe(first.id);
    expect(await store.listCandidates({ tenantId: TENANT, vertical: 'fitness' })).toHaveLength(1);
  });

  test('tenant_key é obrigatório em toda operação', async () => {
    const store = createMarketDiscoveryMemoryStore();
    await expect(store.openRun({ tenantId: '', vertical: 'fitness', discoveryVersion: 'v1' }))
      .rejects.toMatchObject({ code: 'market_discovery_store_invalid' });
    await expect(store.listCandidates({ tenantId: '  ', vertical: 'fitness' }))
      .rejects.toMatchObject({ code: 'market_discovery_store_invalid' });
  });

  test('recordDiscoverySet rejeita set vazio ou com duplicatas', async () => {
    const store = createMarketDiscoveryMemoryStore();
    await expect(store.recordDiscoverySet({
      tenantId: TENANT,
      set: { vertical: 'fitness', discoverySetVersion: 'v1', selectedCandidates: [] },
    })).rejects.toMatchObject({ code: 'market_discovery_store_invalid' });
    await expect(store.recordDiscoverySet({
      tenantId: TENANT,
      set: { vertical: 'fitness', discoverySetVersion: 'v1', selectedCandidates: ['a', 'a'] },
    })).rejects.toMatchObject({ code: 'market_discovery_store_invalid' });
  });
});

describe('marketDiscoveryStore — persistência entre restarts', () => {
  test('instância nova sobre o mesmo backing enxerga run, arquétipos, candidatos e set', async () => {
    const shared = { runs: new Map(), archetypes: new Map(), candidates: new Map(), sets: new Map() };
    const before = createMarketDiscoveryMemoryStore({ state: shared });

    const run = await before.openRun({ tenantId: TENANT, vertical: 'fitness', discoveryVersion: 'v1', startedAt: '2026-09-15T00:00:00.000Z' });
    await before.upsertArchetype({
      tenantId: TENANT,
      runId: run.id,
      archetype: {
        vertical: 'fitness', archetypeKey: 'financial-billing', name: 'Financeiro',
        state: 'ACCEPTED', sourceEvidence: [{ url: 'https://f.example.com/', evidenceRef: 'ev-f' }],
      },
    });
    await before.upsertCandidate({
      tenantId: TENANT,
      runId: run.id,
      candidate: {
        vertical: 'fitness', candidateKey: 'gymnovo', name: 'GymNovo',
        state: 'ACCEPTED', sourceEvidence: [{ url: 'https://n.example.com/', evidenceRef: 'ev-n' }],
      },
    });
    await before.recordDiscoverySet({
      tenantId: TENANT,
      runId: run.id,
      set: { vertical: 'fitness', discoverySetVersion: 'v1', selectedCandidates: ['gymnovo'], selectionRationale: [{ candidateKey: 'gymnovo', score: 80 }] },
    });

    // RESTART: nova instância, mesmo estado persistido.
    const after = createMarketDiscoveryMemoryStore({ state: shared });
    expect((await after.getRun({ tenantId: TENANT, vertical: 'fitness' })).id).toBe(run.id);
    expect((await after.getArchetype({ tenantId: TENANT, vertical: 'fitness', archetypeKey: 'financial-billing' })).state).toBe('ACCEPTED');
    expect((await after.getCandidate({ tenantId: TENANT, vertical: 'fitness', candidateKey: 'gymnovo' })).state).toBe('ACCEPTED');
    expect((await after.getLatestDiscoverySet({ tenantId: TENANT, vertical: 'fitness' })).selected_candidates).toEqual(['gymnovo']);
  });
});

describe('marketDiscoveryStore — fail-closed sem Postgres', () => {
  test('sem Sequelize inicializado TODA operação falha com persistence_required', async () => {
    // Este arquivo de teste nunca conecta: getSequelize() é null neste worker.
    const store = createMarketDiscoveryStore();
    await expect(store.getRun({ tenantId: TENANT, vertical: 'fitness' }))
      .rejects.toMatchObject({ code: ERROR_CODES.PERSISTENCE_REQUIRED });
    await expect(store.listCandidates({ tenantId: TENANT, vertical: 'fitness' }))
      .rejects.toMatchObject({ code: ERROR_CODES.PERSISTENCE_REQUIRED });
  });

  test('models injetados incompletos também falham fechado', async () => {
    const store = createMarketDiscoveryStore({ models: { run: {} } });
    await expect(store.openRun({ tenantId: TENANT, vertical: 'fitness', discoveryVersion: 'v1' }))
      .rejects.toMatchObject({ code: ERROR_CODES.PERSISTENCE_REQUIRED });
  });
});
