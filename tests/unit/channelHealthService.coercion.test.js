'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('channelHealthService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function buildMocks({ accountRows = [], numericHostile = null } = {}) {
    const hostileNum = numericHostile || { toString() { throw new Error('boom-num'); } };

    const sequelize = {
      query: jest.fn(async (sql) => {
        if (sql.includes('FROM channel_accounts') && sql.includes('GROUP BY type')) {
          return [[{ type: 'whatsapp', total: hostileNum, active: hostileNum }]];
        }
        if (sql.includes('FROM outbound_queue')) {
          return [[{
            channel_type: 'whatsapp',
            pending: hostileNum,
            due_now: hostileNum,
            retrying: hostileNum,
            max_attempts: hostileNum,
            avg_attempts: hostileNum,
            overdue_avg_seconds: hostileNum,
            overdue_max_seconds: hostileNum,
            sending: hostileNum,
            sending_age_avg_seconds: hostileNum,
            sending_age_max_seconds: hostileNum,
            oldest_pending_at: null,
          }]];
        }
        if (sql.includes('FROM channel_messages')) {
          return [[{
            channel_type: 'whatsapp',
            out_total: hostileNum,
            out_failed: hostileNum,
            out_sent: hostileNum,
            out_received: hostileNum,
            in_total: hostileNum,
          }]];
        }
        return [[]];
      }),
    };

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => sequelize),
    }));

    jest.doMock('../../api/db/models', () => ({
      ChannelAccount: jest.fn(() => ({
        sequelize,
        findAll: jest.fn(async () => accountRows),
      })),
      OutboundQueueItem: jest.fn(() => ({ sequelize })),
    }));

    jest.doMock('../../api/services/websocketService', () => ({
      emitEvent: jest.fn(),
    }));

    jest.doMock('../../api/services/auditService', () => ({
      logAction: jest.fn(),
    }));

    jest.doMock('../../api/utils/crypto', () => ({
      decrypt: jest.fn(() => '{}'),
    }));
  }

  test('getChannelHealth tolera valores numericos hostis sem excecao', async () => {
    buildMocks();
    const { getChannelHealth } = require('../../api/services/channelHealthService');

    const out = await getChannelHealth({ tenantId: 'tenant-1' });

    expect(out).toEqual(expect.objectContaining({
      tenantId: 'tenant-1',
      channels: expect.any(Object),
      outboundQueue: expect.any(Object),
    }));

    expect(out.channels.whatsapp.delivery.outTotal).toBe(0);
    expect(out.outboundQueue.totals.pending).toBe(0);
  });

  test('getChannelHealth tolera status/external_id hostis em diagnostico de contas', async () => {
    const hostile = { toString() { throw new Error('boom-status'); } };
    const row = {
      toJSON: () => ({
        id: 'acc-1',
        type: 'whatsapp',
        status: hostile,
        external_id: hostile,
        config_encrypted: null,
        updated_at: new Date('2026-03-18T10:00:00Z'),
      }),
    };

    buildMocks({ accountRows: [row], numericHostile: 0 });
    const { getChannelHealth } = require('../../api/services/channelHealthService');

    const out = await getChannelHealth({ tenantId: 'tenant-1' });

    expect(out.accountDiagnostics).toEqual(expect.objectContaining({
      totalAccounts: 1,
    }));
    expect(out.channels.whatsapp).toEqual(expect.objectContaining({
      status: expect.any(String),
    }));
  });

  test('startChannelHealthMonitor tolera getter hostil em error.message do loop', async () => {
    jest.useFakeTimers();
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    const sequelize = {
      query: jest.fn(async () => {
        throw hostileError;
      }),
    };

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => sequelize),
    }));
    jest.doMock('../../api/db/models', () => ({
      ChannelAccount: jest.fn(() => ({ sequelize, findAll: jest.fn(async () => []) })),
      OutboundQueueItem: jest.fn(() => ({ sequelize })),
    }));
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent: jest.fn() }));
    jest.doMock('../../api/services/auditService', () => ({ logAction: jest.fn() }));
    jest.doMock('../../api/utils/crypto', () => ({ decrypt: jest.fn(() => '{}') }));

    const logger = require('../../api/utils/logger');
    const { startChannelHealthMonitor, stopChannelHealthMonitor } = require('../../api/services/channelHealthService');

    startChannelHealthMonitor({ intervalMs: 5000, windowMinutes: 5, failRateThreshold: 0.2, minSamples: 5, cooldownMs: 1000 });
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();

    expect(logger.warn).toHaveBeenCalledWith(
      '[ChannelHealth] Falha no monitor (ignorado)',
      expect.objectContaining({ error: '' })
    );

    stopChannelHealthMonitor();
    jest.useRealTimers();
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/channelHealthService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
