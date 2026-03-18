'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('ticketTagService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('recordTagActionBestEffort tolerates hostile err.message getter from DB create rejection', async () => {
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
      TicketTag: () => ({ create }),
    }));

    const logger = require('../../api/utils/logger');
    const svc = require('../../api/services/ticketTagService');

    expect(() => {
      svc.recordTagActionBestEffort({
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        tag: 'vip',
        action: 'add',
      });
    }).not.toThrow();

    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(create).toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      '[TicketTag] Falha ao registrar ticket_tag (ignorado)',
      { error: '' }
    );
  });

  test('recordTagActionBestEffort ignores hostile tag toString without throwing', async () => {
    const create = jest.fn(() => Promise.resolve());

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({})),
    }));
    jest.doMock('../../api/db/models', () => ({
      TicketTag: () => ({ create }),
    }));

    const hostileTag = {
      toString() {
        throw new Error('poisoned tag toString');
      },
    };

    const svc = require('../../api/services/ticketTagService');

    expect(() => {
      svc.recordTagActionBestEffort({
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        tag: hostileTag,
        action: 'add',
      });
    }).not.toThrow();

    jest.runOnlyPendingTimers();
    await Promise.resolve();

    expect(create).not.toHaveBeenCalled();
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/ticketTagService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
