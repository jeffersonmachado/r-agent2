/**
 * Testes unitários do OutboundQueueService (Fase 1 - retry/backoff)
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('OutboundQueueService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('computeBackoffSeconds cresce (com cap) conforme tentativas', () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    jest.doMock('../../api/services/whatsappService', () => ({ sendTextMessage: jest.fn() }));
    jest.doMock('../../api/services/instagramService', () => ({ sendInstagramMessage: jest.fn(), sendInstagramMedia: jest.fn() }));

    // eslint-disable-next-line global-require
    const { _computeBackoffSeconds } = require('../../api/services/outboundQueueService');

    const a0 = _computeBackoffSeconds(0);
    const a1 = _computeBackoffSeconds(1);
    const a2 = _computeBackoffSeconds(2);
    const a6 = _computeBackoffSeconds(6);

    expect(a0).toBeGreaterThanOrEqual(2);
    expect(a1).toBeGreaterThanOrEqual(a0);
    expect(a2).toBeGreaterThanOrEqual(a1);
    expect(a6).toBeLessThanOrEqual(305); // cap 300 + jitter
  });
});

