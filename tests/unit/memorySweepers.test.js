'use strict';

describe('authService - sweeper de sessões expiradas', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('remove sessões com expiresAt no passado e preserva válidas', () => {
    const authService = require('../../api/services/authService');
    const { sessions, sweepExpiredSessions } = authService._internal;

    const now = new Date();
    sessions.set('token-expired', {
      token: 'token-expired',
      agentId: 'agent-1',
      expiresAt: new Date(now.getTime() - 60 * 1000).toISOString(),
      lastActivityAt: now.toISOString(),
    });
    sessions.set('token-valid', {
      token: 'token-valid',
      agentId: 'agent-1',
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      lastActivityAt: now.toISOString(),
    });

    const removed = sweepExpiredSessions(now);

    expect(removed).toBe(1);
    expect(sessions.has('token-expired')).toBe(false);
    expect(sessions.has('token-valid')).toBe(true);

    sessions.clear();
  });

  test('ignora entradas com expiresAt inválido', () => {
    const authService = require('../../api/services/authService');
    const { sessions, sweepExpiredSessions } = authService._internal;

    sessions.set('token-broken', {
      token: 'token-broken',
      agentId: 'agent-1',
      expiresAt: 'not-a-date',
    });

    const removed = sweepExpiredSessions(new Date());

    expect(removed).toBe(0);
    expect(sessions.has('token-broken')).toBe(true);

    sessions.clear();
  });
});

describe('bulkMessagingService - evicção de campanhas concluídas', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('remove campanhas completed há mais de 24h e preserva recentes/ativas', () => {
    const { _internal } = require('../../api/services/bulkMessagingService');
    const { campaigns, activeSenders, sweepCompletedCampaigns, COMPLETED_CAMPAIGN_TTL_MS } = _internal;

    const now = Date.now();
    campaigns.set('c-old', {
      id: 'c-old',
      status: 'completed',
      completedAt: new Date(now - COMPLETED_CAMPAIGN_TTL_MS - 1000).toISOString(),
    });
    campaigns.set('c-recent', {
      id: 'c-recent',
      status: 'completed',
      completedAt: new Date(now - 1000).toISOString(),
    });
    campaigns.set('c-sending', {
      id: 'c-sending',
      status: 'sending',
      completedAt: null,
      updatedAt: new Date(now - COMPLETED_CAMPAIGN_TTL_MS - 1000).toISOString(),
    });

    const removed = sweepCompletedCampaigns(now);

    expect(removed).toBe(1);
    expect(campaigns.has('c-old')).toBe(false);
    expect(campaigns.has('c-recent')).toBe(true);
    expect(campaigns.has('c-sending')).toBe(true);
    expect(activeSenders.size).toBe(0);

    campaigns.clear();
  });

  test('não evicta campanha completed com pacing ativo', () => {
    const { _internal } = require('../../api/services/bulkMessagingService');
    const { campaigns, activeSenders, sweepCompletedCampaigns, COMPLETED_CAMPAIGN_TTL_MS } = _internal;

    const now = Date.now();
    campaigns.set('c-pacing', {
      id: 'c-pacing',
      status: 'completed',
      completedAt: new Date(now - COMPLETED_CAMPAIGN_TTL_MS - 1000).toISOString(),
    });
    activeSenders.set('c-pacing', setTimeout(() => {}, 60000));

    const removed = sweepCompletedCampaigns(now);

    expect(removed).toBe(0);
    expect(campaigns.has('c-pacing')).toBe(true);

    clearTimeout(activeSenders.get('c-pacing'));
    activeSenders.clear();
    campaigns.clear();
  });
});

describe('channelHealthService - prune de caches em memória', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('prune remove entradas com mais de 24h de lastAlertAt e waQualityCache', () => {
    const { _internal } = require('../../api/services/channelHealthService');
    const { pruneInMemoryCaches, lastAlertAt, waQualityCache } = _internal;

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    lastAlertAt.set('tenant-a:whatsapp:fail_rate', now - DAY - 1000);
    lastAlertAt.set('tenant-b:whatsapp:fail_rate', now - 1000);
    waQualityCache.set('acc-old', { atMs: now - DAY - 1000, qualityRating: 'GREEN' });
    waQualityCache.set('acc-fresh', { atMs: now - 1000, qualityRating: 'GREEN' });

    pruneInMemoryCaches(now);

    expect(lastAlertAt.has('tenant-a:whatsapp:fail_rate')).toBe(false);
    expect(lastAlertAt.has('tenant-b:whatsapp:fail_rate')).toBe(true);
    expect(waQualityCache.has('acc-old')).toBe(false);
    expect(waQualityCache.has('acc-fresh')).toBe(true);
  });
});
