'use strict';

/**
 * Regressão N+1 (learning-core/adaptiveService.collectDriftSignals):
 * antes havia 1 findAll no EventLedger (até 2000 linhas) por certificação
 * ativa (até 500 queries). Agora: 1 query única com actor_id IN (...) +
 * janela de tempo, com agrupamento e refinamento da janela por certificação
 * em JS. O formato dos sinais é preservado.
 */

const mockEventFindAll = jest.fn();
const mockCertFindAll = jest.fn();
const mockCompetencyFindAll = jest.fn();
const mockMissionFindAll = jest.fn();

jest.mock('../../api/db/models', () => ({
  EventLedger: () => ({ findAll: (...a) => mockEventFindAll(...a) }),
}));

const CERTS = [
  { id: 'cert-1', agentId: 'a1', skillKey: 'skill-a', status: 'active', issuedAt: new Date(Date.now() - 86400000) },
  { id: 'cert-2', agentId: 'a2', skillKey: 'skill-a', status: 'active', issuedAt: new Date(Date.now() - 86400000) },
  { id: 'cert-3', agentId: 'a3', skillKey: 'skill-b', status: 'active', issuedAt: new Date(Date.now() - 86400000) },
];

jest.mock('../../api/db/models/UserCertification', () => () => ({
  findAll: (...a) => mockCertFindAll(...a),
}));
jest.mock('../../api/db/models/UserCompetency', () => () => ({ findAll: (...a) => mockCompetencyFindAll(...a) }));
jest.mock('../../api/db/models/LearningMission', () => () => ({ findAll: (...a) => mockMissionFindAll(...a) }));
jest.mock('../../api/modules/learning-core/competencyService', () => ({
  getSkillGraphArtifact: () => ({ routeSkillMap: { '/rota-a': 'skill-a', '/rota-b': 'skill-b' } }),
  loadTenantRouteMap: jest.fn(async () => ({})),
}));
jest.mock('../../api/modules/learning-core/certificationService', () => ({ evaluateCertifications: jest.fn() }));
jest.mock('../../api/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { collectSignals } = require('../../api/modules/learning-core/adaptiveService');

const NOW = Date.now();

function ledgerRows() {
  return [
    // a1: 2 erros em /rota-a (skill-a) → drift
    { actor_id: 'a1', type: 'learning.interaction.error', payload: { route: '/rota-a' }, occurred_at: new Date(NOW - 3600000) },
    { actor_id: 'a1', type: 'learning.interaction.error', payload: { route: '/rota-a' }, occurred_at: new Date(NOW - 3500000) },
    // a1: sucesso não conta
    { actor_id: 'a1', type: 'learning.interaction.api_call', payload: { route: '/rota-a', status: 200 }, occurred_at: new Date(NOW - 3400000) },
    // a2: 1 erro recente + 1 erro ANTES da emissão da certificação → sem drift
    { actor_id: 'a2', type: 'learning.interaction.error', payload: { route: '/rota-a' }, occurred_at: new Date(NOW - 3600000) },
    { actor_id: 'a2', type: 'learning.interaction.error', payload: { route: '/rota-a' }, occurred_at: new Date(NOW - 3 * 86400000) },
    // a3: 2 erros, mas em /rota-a (skill-a) — certificação é de skill-b → sem drift
    { actor_id: 'a3', type: 'learning.interaction.error', payload: { route: '/rota-a' }, occurred_at: new Date(NOW - 3600000) },
    { actor_id: 'a3', type: 'learning.interaction.error', payload: { route: '/rota-a' }, occurred_at: new Date(NOW - 3500000) },
  ];
}

describe('adaptiveService.collectDriftSignals — query única no EventLedger', () => {
  beforeEach(() => {
    // resetMocks global remove implementações — reestabelece aqui.
    mockCertFindAll.mockResolvedValue(CERTS);
    mockCompetencyFindAll.mockResolvedValue([]);
    mockMissionFindAll.mockResolvedValue([]);
    mockEventFindAll.mockImplementation(async (opts) => {
      if (opts && opts.where && opts.where.actor_id) return ledgerRows();
      return []; // scan de unclassified_routes
    });
  });

  it('faz 1 query de drift independente do número de certificações ativas', async () => {
    await collectSignals({ tenantId: 't1' });

    const driftCalls = mockEventFindAll.mock.calls.filter(([arg]) => arg && arg.where && arg.where.actor_id);
    // Antes: 3 queries (1 por certificação). Cada certificação adicional
    // continuaria custando apenas esta 1 query.
    expect(driftCalls).toHaveLength(1);
    expect(driftCalls[0][0].where.tenant_key).toBe('t1');
    expect(driftCalls[0][0].where.source).toBe('learning-core');
  });

  it('preserva a semântica dos sinais (janela por certificação, rota→skill, contagem de erros)', async () => {
    const result = await collectSignals({ tenantId: 't1' });

    const drift = result.signals.filter((s) => s.type === 'certification_drift');
    expect(drift).toHaveLength(1);
    expect(drift[0]).toEqual({
      type: 'certification_drift',
      agentId: 'a1',
      skillKey: 'skill-a',
      certificationId: 'cert-1',
      errorsSinceIssued: 2,
      action: 'reavaliar_certificacao',
    });
  });
});
