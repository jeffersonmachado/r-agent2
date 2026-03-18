'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('auditService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('logAction tolerates hostile err.message getter in async DB create catch', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    const create = jest.fn(() => Promise.reject(hostileError));

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({})),
    }));
    jest.doMock('../../api/db/models', () => ({
      AuditEvent: () => ({ create }),
      GenerationAudit: () => ({ create: jest.fn() }),
      AuditReport: () => ({ create: jest.fn() }),
    }));

    const logger = require('../../api/utils/logger');
    const svc = require('../../api/services/auditService');

    expect(() => {
      svc.logAction({
        agentId: 'agent-1',
        username: 'ana',
        tenantId: 'tenant-1',
        action: 'ticket_update',
        resource: 'ticket',
        resourceId: 't1',
      });
    }).not.toThrow();

    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(create).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[AuditService] Falha ao persistir audit_event no PostgreSQL',
      { error: '' }
    );
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/auditService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
