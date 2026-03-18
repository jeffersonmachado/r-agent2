'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('onboardingService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function setupBaseMocks({ queueThrows = null } = {}) {
    const tenant = {
      id: 'tenant-1',
      createdAt: '2026-03-18T10:00:00.000Z',
      settings: {},
    };

    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(() => tenant),
      updateTenant: jest.fn(() => ({ success: true })),
    }));

    const createQueue = queueThrows
      ? jest.fn(() => { throw queueThrows; })
      : jest.fn(() => ({ success: true, queue: { id: 'q-1', name: 'Geral' } }));

    jest.doMock('../../api/services/queueService', () => ({ createQueue }));

    jest.doMock('../../api/services/authService', () => ({
      createAgent: jest.fn(() => ({ success: true })),
    }));

    jest.doMock('../../api/services/quickRepliesService', () => ({
      createQuickReply: jest.fn(() => ({ success: true, quickReply: { id: 'qr-1' } })),
    }));

    jest.doMock('../../api/services/flowTemplateMarketplaceService', () => ({
      getTemplate: jest.fn(() => ({
        name: 'Template A',
        description: 'desc',
        icon: 'x',
        tags: ['base'],
        flow: { nodes: [] },
      })),
      createTemplate: jest.fn(async (payload) => ({ success: true, template: { id: payload.id } })),
    }));

    return { createQueue };
  }

  test('createInitialTemplates tolera segment hostil sem estourar', async () => {
    setupBaseMocks();
    const { createInitialTemplates } = require('../../api/services/onboardingService');

    const hostileSegment = { toString() { throw new Error('boom-segment'); } };

    const out = await createInitialTemplates('tenant-1', { segment: hostileSegment });

    expect(out.success).toBe(true);
    expect(out.created).toEqual(expect.objectContaining({
      queues: expect.any(Array),
      quickReplies: expect.any(Array),
      templates: expect.any(Array),
    }));
  });

  test('createInitialTemplates tolera err.message hostil no createQueue', async () => {
    const hostileErr = {};
    Object.defineProperty(hostileErr, 'message', {
      get() {
        throw new Error('boom-message-getter');
      },
    });

    setupBaseMocks({ queueThrows: hostileErr });
    const { createInitialTemplates } = require('../../api/services/onboardingService');

    const out = await createInitialTemplates('tenant-1', { segment: 'geral' });
    expect(out.success).toBe(true);
  });

  test('createInitialTemplates tolera err.message e toString hostis no createQueue', async () => {
    const hostileErr = {
      get message() {
        throw new Error('boom-message-getter');
      },
      toString() {
        throw new Error('boom-toString');
      },
    };

    setupBaseMocks({ queueThrows: hostileErr });
    const { createInitialTemplates } = require('../../api/services/onboardingService');

    const out = await createInitialTemplates('tenant-1', { segment: 'geral' });
    expect(out.success).toBe(true);
  });

  test('completeOnboarding segue fluxo mesmo com onboarding parcial', async () => {
    const tenant = {
      id: 'tenant-1',
      createdAt: '2026-03-18T10:00:00.000Z',
      settings: { onboarding: { completed: false, templatesCreated: true } },
    };

    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(() => tenant),
      updateTenant: jest.fn(() => ({ success: true })),
    }));

    jest.doMock('../../api/services/queueService', () => ({ createQueue: jest.fn() }));
    jest.doMock('../../api/services/authService', () => ({ createAgent: jest.fn() }));
    jest.doMock('../../api/services/flowTemplateMarketplaceService', () => ({
      getTemplate: jest.fn(),
      createTemplate: jest.fn(),
    }));

    const { completeOnboarding } = require('../../api/services/onboardingService');
    const out = await completeOnboarding('tenant-1');
    expect(out.success).toBe(true);
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/onboardingService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
