'use strict';

/**
 * Vertical Beauty → Workspace: insight de no_show no Customer 360 e
 * Next Best Action "Recuperar agendamento perdido".
 */

const recentNoShowsByPhone = jest.fn();

function loadModules({ entityPhone = '5511998887766', noShows = [] } = {}) {
  jest.resetModules();
  recentNoShowsByPhone.mockReset().mockResolvedValue(noShows);

  const insightRows = [];
  jest.doMock('../../api/db/models', () => ({
    WorkspaceInsight: () => ({
      findOne: jest.fn(async () => null),
      findAll: jest.fn(async () => insightRows),
      create: jest.fn(async (data) => ({ id: `ins-${insightRows.length}`, ...data, toJSON() { return this; } })),
    }),
    WorkspaceEntity: () => ({
      findOne: jest.fn(async () => (entityPhone ? { phone: entityPhone } : null)),
    }),
    WorkspaceAction: () => ({
      findAll: jest.fn(async () => []),
      create: jest.fn(async (data) => data),
    }),
    WorkspaceEntityLink: () => ({
      findOne: jest.fn(async () => ({ source_id: 'conv-1', toJSON() { return this; } })),
    }),
  }));
  jest.doMock('../../api/services/nlpService', () => ({ analyzeText: jest.fn(async () => null) }));
  jest.doMock('../../api/services/vertical/noShowSignalService', () => ({ recentNoShowsByPhone }));

  // eslint-disable-next-line global-require
  const WorkspaceInsightService = require('../../api/services/workspace/WorkspaceInsightService');
  // eslint-disable-next-line global-require
  const WorkspaceActionService = require('../../api/services/workspace/WorkspaceActionService');

  const timelineService = { getEntityTimeline: jest.fn(async () => ({ items: [], total: 0 })) };
  const insightService = new WorkspaceInsightService({ timelineService });
  const actionService = new WorkspaceActionService({ insightService });
  return { insightService, actionService };
}

const oneNoShow = [{
  scheduleId: 'sched-1',
  subjectId: 'subj-1',
  occurredAt: new Date(Date.now() - 2 * 864e5).toISOString(),
  payload: {},
}];

describe('Workspace — insight de no_show (vertical beauty)', () => {
  test('falta recente vira insight no_show com descrição outcome-first', async () => {
    const { insightService } = loadModules({ noShows: oneNoShow });
    const result = await insightService.generateInsights('entity-1', { tenantId: 'tenant-a' });

    const noShow = result.items.find((item) => item.type === 'no_show');
    expect(noShow).toBeDefined();
    expect(noShow.description).toMatch(/Cliente faltou ao agendamento de .+ e ainda nao reagendou\./);
    expect(noShow.severity).toBe('high');
    expect(noShow.evidence).toEqual(['sched-1']);
    expect(recentNoShowsByPhone).toHaveBeenCalledWith({ tenantId: 'tenant-a', phone: '5511998887766' });
  });

  test('múltiplas faltas resumem contagem no insight', async () => {
    const { insightService } = loadModules({
      noShows: [oneNoShow[0], { ...oneNoShow[0], scheduleId: 'sched-2', occurredAt: new Date(Date.now() - 9 * 864e5).toISOString() }],
    });
    const result = await insightService.generateInsights('entity-1', { tenantId: 'tenant-a' });

    const noShow = result.items.find((item) => item.type === 'no_show');
    expect(noShow.description).toMatch(/2 faltas em agendamentos nos ultimos 45 dias/);
  });

  test('sem faltas, sem telefone ou falha do sinal → nenhum insight de no_show (fail-soft)', async () => {
    const semFaltas = await loadModules({ noShows: [] }).insightService.generateInsights('entity-1', { tenantId: 'tenant-a' });
    expect(semFaltas.items.filter((i) => i.type === 'no_show')).toHaveLength(0);

    const semTelefone = await loadModules({ entityPhone: null, noShows: oneNoShow }).insightService.generateInsights('entity-1', { tenantId: 'tenant-a' });
    expect(semTelefone.items.filter((i) => i.type === 'no_show')).toHaveLength(0);

    const mods = loadModules({ noShows: oneNoShow });
    recentNoShowsByPhone.mockRejectedValue(new Error('db down'));
    const falhou = await mods.insightService.generateInsights('entity-1', { tenantId: 'tenant-a' });
    expect(falhou.items.filter((i) => i.type === 'no_show')).toHaveLength(0);
  });

  test('NBA para no_show: recuperar agendamento perdido com envio de mensagem e deep-link', async () => {
    const { actionService } = loadModules({ noShows: oneNoShow });
    const nba = await actionService.suggestNextBestAction({ tenantId: 'tenant-a', entityId: 'entity-1', classification: 'PRODUCTION' });

    expect(nba.type).toBe('followup');
    expect(nba.label).toBe('Recuperar agendamento perdido');
    expect(nba.reason).toMatch(/faltou a um agendamento recente/);
    expect(nba.expectedOutcome).toMatch(/Reagendar o atendimento/);
    expect(nba.risk).toBe('medium');
    expect(nba.confidence).toBeGreaterThan(0);
    expect(nba.action).toMatchObject({ kind: 'send_message', conversationId: 'conv-1' });
    expect(nba.sourceInsight.type).toBe('no_show');
  });
});
