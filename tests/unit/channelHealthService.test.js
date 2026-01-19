/**
 * Testes unitários: ChannelHealthService (regras básicas de status).
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('ChannelHealthService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('computeStatus marca unhealthy quando não há conta ativa', () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent: jest.fn() }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/channelHealthService');
    const out = svc._internal.computeStatus({
      failRate: 0,
      outboundPending: 0,
      hasActiveAccount: false,
      totalOut: 0,
      minSamples: 20,
      failRateThreshold: 0.15,
    });
    expect(out.status).toBe('unhealthy');
  });

  test('computeStatus marca degraded em backlog alto', () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent: jest.fn() }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/channelHealthService');
    const out = svc._internal.computeStatus({
      failRate: 0,
      outboundPending: 250,
      hasActiveAccount: true,
      totalOut: 0,
      minSamples: 20,
      failRateThreshold: 0.15,
    });
    expect(out.status).toBe('degraded');
  });

  test('computeStatus marca degraded/unhealthy por taxa de falha', () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent: jest.fn() }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/channelHealthService');

    const degraded = svc._internal.computeStatus({
      failRate: 0.2,
      outboundPending: 0,
      hasActiveAccount: true,
      totalOut: 30,
      minSamples: 20,
      failRateThreshold: 0.15,
    });
    expect(degraded.status).toBe('degraded');

    const unhealthy = svc._internal.computeStatus({
      failRate: 0.6,
      outboundPending: 0,
      hasActiveAccount: true,
      totalOut: 30,
      minSamples: 20,
      failRateThreshold: 0.15,
    });
    expect(unhealthy.status).toBe('unhealthy');
  });
});

