describe('whatsAppIvrRoutes handler', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      requireTenant: jest.fn(() => 'tenant-1'),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      crypto: require('crypto'),
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('retorna false para rota não tratada', async () => {
    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async () => ({ ok: true, value: {} })),
      upsertSetting: jest.fn(async () => ({ ok: true, value: {} })),
    }));

    const { handleWhatsAppIvrRoutes } = require('../../api/modules/whatsapp-ivr/handleWhatsAppIvrRoutes');
    const deps = makeDeps();
    const req = {};
    const res = {};

    const handled = await handleWhatsAppIvrRoutes({
      req,
      res,
      method: 'GET',
      pathname: '/not-found',
      deps,
    });

    expect(handled).toBe(false);
    expect(deps.sendJson).not.toHaveBeenCalled();
    expect(deps.badRequest).not.toHaveBeenCalled();
  });

  test('GET /whatsapp/ivr retorna 401 quando não autenticado', async () => {
    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async () => ({ ok: true, value: {} })),
      upsertSetting: jest.fn(async () => ({ ok: true, value: {} })),
    }));

    const { handleWhatsAppIvrRoutes } = require('../../api/modules/whatsapp-ivr/handleWhatsAppIvrRoutes');
    const req = {};
    const res = {};
    const deps = makeDeps({
      requireAuth: jest.fn(() => ({ valid: false, error: 'invalid_token' })),
    });

    const handled = await handleWhatsAppIvrRoutes({
      req,
      res,
      method: 'GET',
      pathname: '/whatsapp/ivr',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, {
      error: 'unauthorized',
      message: 'invalid_token',
    });
  });

  test('GET /whatsapp/ivr retorna configuração normalizada', async () => {
    const getSetting = jest.fn(async () => ({
      ok: true,
      value: {
        enabled: true,
        departments: [{ id: 'd-1', name: 'Comercial', queue: 'comercial' }],
        rules: [{ id: 'r-1', keyword: 'vendas', departmentId: 'd-1', priority: 1, enabled: true }],
      },
    }));

    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting,
      upsertSetting: jest.fn(async () => ({ ok: true, value: {} })),
    }));

    const { handleWhatsAppIvrRoutes } = require('../../api/modules/whatsapp-ivr/handleWhatsAppIvrRoutes');
    const req = {};
    const res = {};
    const deps = makeDeps();

    const handled = await handleWhatsAppIvrRoutes({
      req,
      res,
      method: 'GET',
      pathname: '/whatsapp/ivr',
      deps,
    });

    expect(handled).toBe(true);
    expect(getSetting).toHaveBeenCalledWith({ tenantId: 'tenant-1', key: 'whatsapp_ivr' });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      value: {
        enabled: true,
        departments: [{ id: 'd-1', name: 'Comercial', queue: 'comercial' }],
        rules: [{ id: 'r-1', keyword: 'vendas', departmentId: 'd-1', priority: 1, enabled: true }],
      },
    });
  });

  test('POST /whatsapp/ivr valida Content-Type', async () => {
    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async () => ({ ok: true, value: {} })),
      upsertSetting: jest.fn(async () => ({ ok: true, value: {} })),
    }));

    const { handleWhatsAppIvrRoutes } = require('../../api/modules/whatsapp-ivr/handleWhatsAppIvrRoutes');
    const req = {};
    const res = {};
    const deps = makeDeps({
      hasJsonContentType: jest.fn(() => false),
    });

    const handled = await handleWhatsAppIvrRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/whatsapp/ivr',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Content-Type deve ser application/json');
  });

  test('POST /whatsapp/ivr/department exige name e queue', async () => {
    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async () => ({ ok: true, value: {} })),
      upsertSetting: jest.fn(async () => ({ ok: true, value: {} })),
    }));

    const { handleWhatsAppIvrRoutes } = require('../../api/modules/whatsapp-ivr/handleWhatsAppIvrRoutes');
    const req = {};
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ name: 'Financeiro' })),
    });

    const handled = await handleWhatsAppIvrRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/whatsapp/ivr/department',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'name e queue são obrigatórios');
  });

  test('POST /whatsapp/ivr/rule salva regra e retorna 200', async () => {
    const getSetting = jest.fn(async () => ({
      ok: true,
      value: {
        enabled: true,
        departments: [{ id: 'd-1', name: 'Comercial', queue: 'comercial', enabled: true }],
        rules: [],
      },
    }));

    const upsertSetting = jest.fn(async ({ value }) => ({
      ok: true,
      value,
    }));

    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting,
      upsertSetting,
    }));

    const { handleWhatsAppIvrRoutes } = require('../../api/modules/whatsapp-ivr/handleWhatsAppIvrRoutes');
    const req = {};
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        id: 'rule-1',
        keyword: 'vendas',
        departmentId: 'd-1',
        priority: 10,
        enabled: true,
      })),
    });

    const handled = await handleWhatsAppIvrRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/whatsapp/ivr/rule',
      deps,
    });

    expect(handled).toBe(true);
    expect(upsertSetting).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      key: 'whatsapp_ivr',
      value: {
        enabled: true,
        departments: [{ id: 'd-1', name: 'Comercial', queue: 'comercial', enabled: true }],
        rules: [{ id: 'rule-1', keyword: 'vendas', departmentId: 'd-1', priority: 10, enabled: true }],
      },
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      rule: {
        id: 'rule-1',
        keyword: 'vendas',
        departmentId: 'd-1',
        priority: 10,
        enabled: true,
      },
      value: {
        enabled: true,
        departments: [{ id: 'd-1', name: 'Comercial', queue: 'comercial', enabled: true }],
        rules: [{ id: 'rule-1', keyword: 'vendas', departmentId: 'd-1', priority: 10, enabled: true }],
      },
    });
  });
});
