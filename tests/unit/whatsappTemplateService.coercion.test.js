'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('whatsappTemplateService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete global.fetch;
  });

  test('sendTemplateMessage returns safe fallback when enqueue throws hostile error getter', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('../../api/services/outboundQueueService', () => ({
      enqueueOutbound: jest.fn(async () => {
        throw hostileError;
      }),
    }));

    const svc = require('../../api/services/whatsappTemplateService');
    const out = await svc.sendTemplateMessage('5511999999999', 'boas_vindas', 'pt_BR', [], { tenantId: 'tenant-1' });

    expect(out).toEqual({ success: false, error: '' });
  });

  test('createTemplate returns safe fallback when fetch rejects hostile error getter', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('../../api/utils/config', () => ({
      get: jest.fn((key) => {
        if (key === 'whatsapp.wabaId') return 'waba-1';
        if (key === 'whatsapp.accessToken') return 'token-1';
        return null;
      }),
    }));

    jest.doMock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn() }));

    global.fetch = jest.fn(async () => {
      throw hostileError;
    });

    const svc = require('../../api/services/whatsappTemplateService');

    const out = await svc.createTemplate({
      name: 'template_ok',
      language: 'pt_BR',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Ola' }],
    });

    expect(out).toEqual({ success: false, error: '' });
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/whatsappTemplateService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
