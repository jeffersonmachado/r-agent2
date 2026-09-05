'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('onboardingService — vertical e connect_channel', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function setupMocks({ tenant = null, channelCount = 0 } = {}) {
    const effectiveTenant = tenant || {
      id: 'tenant-1',
      createdAt: '2026-03-18T10:00:00.000Z',
      settings: {},
    };
    const updateTenant = jest.fn(async () => ({ success: true }));

    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(async () => effectiveTenant),
      updateTenant,
    }));
    jest.doMock('../../api/services/queueService', () => ({
      createQueue: jest.fn(() => ({ success: true, queue: { id: 'q-1' } })),
    }));
    jest.doMock('../../api/services/authService', () => ({
      createAgent: jest.fn(() => ({ success: true })),
    }));
    jest.doMock('../../api/services/quickRepliesService', () => ({
      createQuickReply: jest.fn(() => ({ success: true, quickReply: { id: 'qr-1' } })),
    }));
    const createTemplate = jest.fn(async (payload) => ({ success: true, template: { id: payload.id } }));
    jest.doMock('../../api/services/flowTemplateMarketplaceService', () => ({
      getTemplate: jest.fn(() => ({
        name: 'Template A',
        description: 'desc',
        icon: 'x',
        tags: ['base'],
        flow: { nodes: [] },
      })),
      createTemplate,
    }));

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({})),
    }));
    const count = jest.fn(async () => channelCount);
    jest.doMock('../../api/db/models', () => ({
      ChannelAccount: () => ({ count }),
    }));

    return { updateTenant, createTemplate, channelCountMock: count };
  }

  // ── setTenantVertical ────────────────────────────────────────────────────

  test('setTenantVertical persiste id canônico válido em settings.vertical', async () => {
    const { updateTenant } = setupMocks({
      tenant: { id: 'tenant-1', settings: { onboarding: { completed: false } } },
    });
    const { setTenantVertical } = require('../../api/services/onboardingService');

    const result = await setTenantVertical('tenant-1', 'fitness');

    expect(result).toEqual({ success: true, vertical: 'fitness' });
    expect(updateTenant).toHaveBeenCalledWith('tenant-1', {
      settings: expect.objectContaining({ vertical: 'fitness' }),
    });
  });

  test('setTenantVertical rejeita id fora do registry canônico', async () => {
    const { updateTenant } = setupMocks();
    const { setTenantVertical } = require('../../api/services/onboardingService');

    const result = await setTenantVertical('tenant-1', 'crypto');

    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_vertical');
    expect(updateTenant).not.toHaveBeenCalled();
  });

  test('setTenantVertical aceita todos os ids canônicos de config/verticals.json', async () => {
    setupMocks();
    const { setTenantVertical, CANONICAL_VERTICAL_IDS } = require('../../api/services/onboardingService');

    expect(CANONICAL_VERTICAL_IDS).toEqual(
      expect.arrayContaining(['beauty', 'fitness', 'bakery', 'food', 'services', 'clinic', 'market']),
    );
    for (const id of ['beauty', 'fitness', 'bakery', 'food', 'services', 'clinic', 'market']) {
      // eslint-disable-next-line no-await-in-loop
      const result = await setTenantVertical('tenant-1', id);
      expect(result.success).toBe(true);
    }
  });

  test('setTenantVertical retorna tenant_not_found quando tenant não existe', async () => {
    setupMocks({ tenant: null });
    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(async () => null),
      updateTenant: jest.fn(),
    }));
    const { setTenantVertical } = require('../../api/services/onboardingService');

    const result = await setTenantVertical('tenant-x', 'beauty');

    expect(result).toEqual({ success: false, error: 'tenant_not_found' });
  });

  // ── hasConnectedChannel / connect_channel ────────────────────────────────

  test('hasConnectedChannel é true quando há conta de canal ativa', async () => {
    setupMocks({ channelCount: 2 });
    const { hasConnectedChannel } = require('../../api/services/onboardingService');

    await expect(hasConnectedChannel('tenant-1')).resolves.toBe(true);
  });

  test('hasConnectedChannel é false quando não há conta de canal', async () => {
    setupMocks({ channelCount: 0 });
    const { hasConnectedChannel } = require('../../api/services/onboardingService');

    await expect(hasConnectedChannel('tenant-1')).resolves.toBe(false);
  });

  test('getOnboardingStatus auto-detecta connect_channel com canal conectado', async () => {
    setupMocks({ channelCount: 1 });
    const { getOnboardingStatus } = require('../../api/services/onboardingService');

    const status = await getOnboardingStatus('tenant-1');

    const step = status.steps.find((s) => s.id === 'connect_channel');
    expect(step).toBeTruthy();
    expect(step.category).toBe('recommended');
    expect(step.completed).toBe(true);
  });

  test('getOnboardingStatus mantém connect_channel pendente sem canal', async () => {
    setupMocks({ channelCount: 0 });
    const { getOnboardingStatus } = require('../../api/services/onboardingService');

    const status = await getOnboardingStatus('tenant-1');

    const step = status.steps.find((s) => s.id === 'connect_channel');
    expect(step.completed).toBe(false);
    expect(step.required).toBe(false);
  });

  // ── templates por vertical ───────────────────────────────────────────────

  test('createInitialTemplates usa a vertical persistida como segmento default (fitness→academia)', async () => {
    const { createTemplate } = setupMocks({
      tenant: { id: 'tenant-1', settings: { vertical: 'fitness' } },
    });
    const { createInitialTemplates } = require('../../api/services/onboardingService');

    const out = await createInitialTemplates('tenant-1');

    expect(out.success).toBe(true);
    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ tags: expect.arrayContaining(['segment:academia']) }),
    );
  });

  test('createInitialTemplates mapeia clinic→saude e respeita segment explícito', async () => {
    const { createTemplate } = setupMocks({
      tenant: { id: 'tenant-1', settings: { vertical: 'clinic' } },
    });
    const { createInitialTemplates } = require('../../api/services/onboardingService');

    const out = await createInitialTemplates('tenant-1');
    expect(out.success).toBe(true);
    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ tags: expect.arrayContaining(['segment:saude']) }),
    );

    createTemplate.mockClear();
    await createInitialTemplates('tenant-1', { segment: 'padaria' });
    expect(createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ tags: expect.arrayContaining(['segment:padaria']) }),
    );
  });
});
