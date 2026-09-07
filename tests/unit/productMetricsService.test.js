'use strict';

/**
 * Testes unitários do productMetricsService (P4.13).
 *
 * Cobre: TTFR (inbound→outbound por conversa, avg/mediana/p90), TTFV
 * (onboarding → primeira resposta real), cliques por tarefa/superfície
 * (agregado de sessões do interaction tracker), profundidade de navegação
 * e isolamento por tenant nas queries.
 */

const { getSequelize } = require('../../api/db/sequelize');
const { ChannelMessage } = require('../../api/db/models');
const getUserInteractionSessionModel = require('../../api/db/models/UserInteractionSession');
const onboardingService = require('../../api/services/onboardingService');
const logger = require('../../api/utils/logger');

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(),
}));

jest.mock('../../api/db/models', () => ({
  ChannelMessage: jest.fn(),
}));

jest.mock('../../api/db/models/UserInteractionSession', () => jest.fn());

jest.mock('../../api/services/onboardingService', () => ({
  getOnboardingStatus: jest.fn(),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const service = require('../../api/services/productMetricsService');

function messageModel(overrides = {}) {
  return {
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function sessionModel(overrides = {}) {
  return {
    findAll: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('services/productMetricsService', () => {
  let messages;
  let sessions;

  beforeEach(() => {
    messages = messageModel();
    sessions = sessionModel();
    ChannelMessage.mockReturnValue(messages);
    getUserInteractionSessionModel.mockReturnValue(sessions);
    getSequelize.mockReturnValue({});
    onboardingService.getOnboardingStatus.mockResolvedValue(null);
  });

  it('sem banco: persistence_required', async () => {
    getSequelize.mockReturnValue(null);
    await expect(service.getProductMetricsSummary({ tenantId: 't1' }))
      .rejects.toThrow(/persistence_required/);
  });

  it('sem tenantId: erro explícito', async () => {
    await expect(service.getProductMetricsSummary({}))
      .rejects.toThrow(/tenantId/);
  });

  describe('TTFR (timeToFirstResponse)', () => {
    it('calcula avg/mediana/p90 por conversa (primeira inbound → primeira outbound)', async () => {
      messages.findAll.mockResolvedValue([
        // conversa c1: 10:00 → 10:02 (120s)
        { conversation_id: 'c1', direction: 'in', createdAt: '2026-09-01T10:00:00Z' },
        { conversation_id: 'c1', direction: 'in', createdAt: '2026-09-01T10:01:00Z' },
        { conversation_id: 'c1', direction: 'out', createdAt: '2026-09-01T10:02:00Z' },
        // conversa c2: 11:00 → 11:10 (600s)
        { conversation_id: 'c2', direction: 'in', createdAt: '2026-09-01T11:00:00Z' },
        { conversation_id: 'c2', direction: 'out', createdAt: '2026-09-01T11:10:00Z' },
        // conversa c3: outbound sem inbound não conta
        { conversation_id: 'c3', direction: 'out', createdAt: '2026-09-01T12:00:00Z' },
      ]);

      const summary = await service.getProductMetricsSummary({ tenantId: 't1', windowDays: 30 });

      expect(summary.timeToFirstResponse).toEqual({
        avgSeconds: 360,
        medianSeconds: 600,
        p90Seconds: 600,
        conversations: 2,
      });
    });

    it('query é isolada por tenant e respeita a janela', async () => {
      await service.getProductMetricsSummary({ tenantId: 'tenant-x', windowDays: 7 });

      const where = messages.findAll.mock.calls[0][0].where;
      expect(where.tenant_key).toBe('tenant-x');
      const since = where.createdAt[Object.getOwnPropertySymbols(where.createdAt)[0]];
      expect(Date.now() - since.getTime()).toBeGreaterThan(6 * 24 * 3600 * 1000);
      expect(Date.now() - since.getTime()).toBeLessThan(8 * 24 * 3600 * 1000);
    });

    it('sem conversas respondidas: métricas nulas, sem quebrar', async () => {
      const summary = await service.getProductMetricsSummary({ tenantId: 't1' });
      expect(summary.timeToFirstResponse.avgSeconds).toBeNull();
      expect(summary.timeToFirstResponse.conversations).toBe(0);
    });
  });

  describe('TTFV (timeToFirstValue)', () => {
    it('onboarding → primeira mensagem outbound', async () => {
      onboardingService.getOnboardingStatus.mockResolvedValue({
        startedAt: '2026-09-01T08:00:00Z',
        completedAt: '2026-09-01T09:00:00Z',
      });
      messages.findOne.mockResolvedValue({ createdAt: '2026-09-01T12:00:00Z' });

      const summary = await service.getProductMetricsSummary({ tenantId: 't1' });

      expect(summary.timeToFirstValue.available).toBe(true);
      expect(summary.timeToFirstValue.seconds).toBe(4 * 3600);
      expect(summary.timeToFirstValue.onboarding.timeToCompleteSeconds).toBe(3600);
    });

    it('tenant que nunca respondeu: available=false', async () => {
      onboardingService.getOnboardingStatus.mockResolvedValue({
        startedAt: '2026-09-01T08:00:00Z',
        completedAt: null,
      });

      const summary = await service.getProductMetricsSummary({ tenantId: 't1' });

      expect(summary.timeToFirstValue.available).toBe(false);
      expect(summary.timeToFirstValue.seconds).toBeNull();
    });
  });

  describe('interação (cliques por tarefa + profundidade de navegação)', () => {
    it('agrega cliques por superfície central e cliques por tarefa concluída', async () => {
      sessions.findAll.mockResolvedValue([
        {
          routesVisited: ['/inbox', '/workspace'],
          eventCount: 30,
          summary: {
            clicksByRoute: { '/inbox': 10, '/workspace': 4, '/dev/qa-waves': 99 },
            taskCompletionClicksByRoute: { '/inbox': 2, '/workspace': 1 },
          },
        },
        {
          routesVisited: ['/inbox'],
          eventCount: 10,
          summary: {
            clicksByRoute: { '/inbox': 5 },
            taskCompletionClicksByRoute: { '/inbox': 1 },
          },
        },
      ]);

      const summary = await service.getProductMetricsSummary({ tenantId: 't1' });

      const inbox = summary.clicksPerCoreSurface.find((s) => s.surface === 'Inbox');
      expect(inbox).toEqual({
        surface: 'Inbox',
        sessions: 2,
        clicks: 15,
        avgClicksPerSession: 7.5,
        taskCompletions: 3,
        avgClicksPerCompletedTask: 5,
      });
      const workspace = summary.clicksPerCoreSurface.find((s) => s.surface === 'Workspace');
      expect(workspace.avgClicksPerCompletedTask).toBe(4);
      // Superfície DEVELOPMENT nunca aparece nas métricas de produto
      expect(summary.clicksPerCoreSurface.find((s) => s.surface === '/dev/qa-waves')).toBeUndefined();
      expect(JSON.stringify(summary.clicksPerCoreSurface)).not.toContain('/dev/');
    });

    it('profundidade de navegação: rotas distintas e eventos por sessão + top rotas', async () => {
      sessions.findAll.mockResolvedValue([
        { routesVisited: ['/inbox', '/workspace', '/agenda'], eventCount: 40, summary: {} },
        { routesVisited: ['/inbox'], eventCount: 8, summary: {} },
      ]);

      const summary = await service.getProductMetricsSummary({ tenantId: 't1' });

      expect(summary.navigation.sessions).toBe(2);
      expect(summary.navigation.avgRoutesPerSession).toBe(2);
      expect(summary.navigation.avgEventsPerSession).toBe(24);
      expect(summary.navigation.topRoutes[0]).toEqual({ route: '/inbox', sessions: 2 });
    });

    it('sessão sem summary (agregado antigo) não quebra o cálculo', async () => {
      sessions.findAll.mockResolvedValue([
        { routesVisited: ['/crm'], eventCount: 3, summary: null },
      ]);

      const summary = await service.getProductMetricsSummary({ tenantId: 't1' });

      expect(summary.navigation.sessions).toBe(1);
      expect(summary.clicksPerCoreSurface).toEqual([]);
    });
  });

  it('falha parcial em uma fonte não derruba o sumário (warn + nulls)', async () => {
    messages.findAll.mockRejectedValue(new Error('scan falhou'));

    const summary = await service.getProductMetricsSummary({ tenantId: 't1' });

    expect(summary.ok).toBe(true);
    expect(summary.timeToFirstResponse.avgSeconds).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });
});
