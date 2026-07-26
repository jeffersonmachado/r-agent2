'use strict';

/**
 * Testes unitários da identificação de cliente de pedidos (orderCustomerService).
 *
 * Regra de negócio: pedido com telefone resolve/cria o cliente (AccessSubject)
 * com customerId determinístico por (tenant, telefone); sem telefone, retorna
 * null e o pedido segue sem vínculo.
 */

describe('orderCustomerService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function loadService({ ensureSubject } = {}) {
    jest.doMock('../../api/modules/access-control/accessControlService', () => ({
      ensureSubject: ensureSubject || jest.fn(async ({ customerId }) => ({ id: `acs-${customerId}` })),
    }));
    // eslint-disable-next-line global-require
    return require('../../api/services/orderCustomerService');
  }

  test('customerId é determinístico por (tenant, telefone)', () => {
    const { resolveCustomerId } = loadService();

    const a = resolveCustomerId('tenant-1', '+55 (11) 99900-0111');
    const b = resolveCustomerId('tenant-1', '5511999000111');
    const outroTenant = resolveCustomerId('tenant-2', '5511999000111');

    expect(a).toMatch(/^cust-[a-f0-9]{16}$/);
    expect(a).toBe(b); // formatação diferente, mesmo telefone
    expect(outroTenant).not.toBe(a); // isolamento por tenant
  });

  test('sem telefone retorna null e não cria subject', async () => {
    const ensureSubject = jest.fn();
    const { ensureOrderCustomer } = loadService({ ensureSubject });

    await expect(ensureOrderCustomer({ tenantId: 'tenant-1', customerPhone: null })).resolves.toBeNull();
    await expect(ensureOrderCustomer({ tenantId: 'tenant-1', customerPhone: '  ' })).resolves.toBeNull();
    expect(ensureSubject).not.toHaveBeenCalled();
  });

  test('com telefone resolve subject com metadados do pedido', async () => {
    const ensureSubject = jest.fn(async ({ customerId }) => ({ id: `acs-${customerId}` }));
    const { ensureOrderCustomer, resolveCustomerId } = loadService({ ensureSubject });

    const out = await ensureOrderCustomer({
      tenantId: 'tenant-1',
      vertical: 'market',
      customerName: 'Maria',
      customerPhone: '+5511999000111',
      source: 'storefront',
    });

    const expectedCustomerId = resolveCustomerId('tenant-1', '+5511999000111');
    expect(out).toEqual({ customerId: expectedCustomerId, subjectId: `acs-${expectedCustomerId}` });
    expect(ensureSubject).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      customerId: expectedCustomerId,
      verticalProfile: 'market',
      metadata: expect.objectContaining({ name: 'Maria', phone: '+5511999000111', source: 'storefront' }),
    }));
  });

  test('sem tenantId lança missing_tenant', async () => {
    const { ensureOrderCustomer } = loadService();
    await expect(ensureOrderCustomer({ customerPhone: '5511999000111' }))
      .rejects.toMatchObject({ code: 'missing_tenant' });
  });
});
