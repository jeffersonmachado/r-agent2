'use strict';

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(() => ({})),
}));

jest.mock('../../api/db/models', () => ({
  AccessMembership: jest.fn(() => mockAccessMembership),
  VerticalSessionBundle: jest.fn(() => mockSessionBundle),
}));

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: jest.fn(async () => ({ id: 'ledger-1' })),
}));

const mockAccessMembership = {
  findOne: jest.fn(),
  findAll: jest.fn(),
  update: jest.fn(),
};

const mockSessionBundle = {
  findOne: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const { appendEventV1 } = require('../../api/services/eventLedgerService');
const { getSequelize } = require('../../api/db/sequelize');
const { AccessMembership: mockAccessMembershipFactory, VerticalSessionBundle: mockSessionBundleFactory } = require('../../api/db/models');
const {
  updateBillingStatus,
  blockMembership,
  reactivateMembership,
  computeEffectiveBillingStatus,
  isAccessAllowedByBilling,
  createSessionBundle,
  consumeSession,
  getActiveBundle,
  getSessionBalance,
} = require('../../api/services/vertical/billingOrchestrationService');

describe('billingOrchestrationService', () => {
  const tenantId = 'tenant-a';
  const membershipId = 'mem-1';

  beforeEach(() => {
    // resetMocks: true wipes all implementations — restore them here
    getSequelize.mockReturnValue({});
    mockAccessMembershipFactory.mockReturnValue(mockAccessMembership);
    mockSessionBundleFactory.mockReturnValue(mockSessionBundle);
    appendEventV1.mockResolvedValue({ id: 'ledger-1' });
  });

  describe('updateBillingStatus', () => {
    it('transiciona de active para blocked', async () => {
      const rowMock = {
        billing_status: 'active',
        id: membershipId,
        update: jest.fn(async (data) => ({ ...rowMock, ...data })),
      };
      mockAccessMembership.findOne.mockResolvedValueOnce(rowMock);

      const result = await updateBillingStatus({ tenantId, membershipId, toStatus: 'blocked', reason: 'overdue' });

      expect(rowMock.update).toHaveBeenCalledWith(expect.objectContaining({ billing_status: 'blocked' }));
      expect(appendEventV1).toHaveBeenCalledWith(expect.objectContaining({ type: 'MembershipBillingStatusChanged' }));
    });

    it('rejeita transição inválida (active → cancelled_invalid)', async () => {
      const rowMock = { billing_status: 'active', id: membershipId, update: jest.fn() };
      mockAccessMembership.findOne.mockResolvedValueOnce(rowMock);

      await expect(
        updateBillingStatus({ tenantId, membershipId, toStatus: 'nao_existe' }),
      ).rejects.toMatchObject({ code: 'invalid_billing_transition' });
    });

    it('rejeita quando membership não existe', async () => {
      mockAccessMembership.findOne.mockResolvedValueOnce(null);

      await expect(
        updateBillingStatus({ tenantId, membershipId: 'nao-existe', toStatus: 'blocked' }),
      ).rejects.toMatchObject({ code: 'membership_not_found' });
    });

    it('lança erro quando DB indisponível', async () => {
      const { getSequelize } = require('../../api/db/sequelize');
      getSequelize.mockReturnValueOnce(null);

      await expect(
        updateBillingStatus({ tenantId, membershipId, toStatus: 'blocked' }),
      ).rejects.toMatchObject({ code: 'db_unavailable' });
    });

    it('transiciona de grace_period para delinquent', async () => {
      const rowMock = {
        billing_status: 'grace_period',
        id: membershipId,
        update: jest.fn(async (data) => ({ ...rowMock, ...data })),
      };
      mockAccessMembership.findOne.mockResolvedValueOnce(rowMock);

      await updateBillingStatus({ tenantId, membershipId, toStatus: 'delinquent' });

      expect(rowMock.update).toHaveBeenCalledWith(expect.objectContaining({ billing_status: 'delinquent' }));
    });
  });

  describe('computeEffectiveBillingStatus', () => {
    it('retorna grace_period quando grace_until no futuro', () => {
      const future = new Date(Date.now() + 3600000).toISOString();
      const membership = { billing_status: 'delinquent', grace_until: future };
      expect(computeEffectiveBillingStatus(membership)).toBe('grace_period');
    });

    it('retorna billing_status original quando grace_until expirou', () => {
      const past = new Date(Date.now() - 3600000).toISOString();
      const membership = { billing_status: 'delinquent', grace_until: past };
      expect(computeEffectiveBillingStatus(membership)).toBe('delinquent');
    });

    it('retorna billing_status quando sem grace_until', () => {
      expect(computeEffectiveBillingStatus({ billing_status: 'active' })).toBe('active');
    });
  });

  describe('isAccessAllowedByBilling', () => {
    it.each([
      ['active', true],
      ['grace_period', true],
      ['trial', true],
      ['visitor', true],
      ['delinquent', false],
      ['blocked', false],
      ['cancelled', false],
    ])('status "%s" → allowed=%s', (status, expected) => {
      expect(isAccessAllowedByBilling({ billing_status: status })).toBe(expected);
    });

    it('grace_until futuro permite acesso mesmo para delinquent', () => {
      const future = new Date(Date.now() + 3600000).toISOString();
      expect(isAccessAllowedByBilling({ billing_status: 'delinquent', grace_until: future })).toBe(true);
    });
  });

  describe('consumeSession', () => {
    it('decrementa used_sessions com idempotência', async () => {
      const bundleMock = {
        id: 'bundle-1',
        total_sessions: 10,
        used_sessions: 3,
        status: 'active',
        billing_status: 'active',
        update: jest.fn(async (data) => ({ ...bundleMock, ...data })),
      };
      mockSessionBundle.findOne.mockResolvedValueOnce(bundleMock);

      const result = await consumeSession({ tenantId, bundleId: 'bundle-1', correlationId: 'corr-1' });

      expect(bundleMock.update).toHaveBeenCalledWith(
        expect.objectContaining({ used_sessions: 4 }),
      );
      expect(appendEventV1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SessionBundleConsumed' }),
      );
    });

    it('marca bundle como exhausted quando todas sessões consumidas', async () => {
      const bundleMock = {
        id: 'bundle-1',
        total_sessions: 5,
        used_sessions: 4,
        status: 'active',
        billing_status: 'active',
        update: jest.fn(async (data) => ({ ...bundleMock, ...data })),
      };
      mockSessionBundle.findOne.mockResolvedValueOnce(bundleMock);

      await consumeSession({ tenantId, bundleId: 'bundle-1', correlationId: 'corr-exhaust' });

      expect(bundleMock.update).toHaveBeenCalledWith(
        expect.objectContaining({ used_sessions: 5, status: 'exhausted' }),
      );
    });

    it('bundle inexistente lança bundle_not_found', async () => {
      mockSessionBundle.findOne.mockResolvedValueOnce(null);

      await expect(
        consumeSession({ tenantId, bundleId: 'nao-existe', correlationId: 'corr-1' }),
      ).rejects.toMatchObject({ code: 'session_bundle_not_found' });
    });

    it('bundle exhausted lança bundle_exhausted', async () => {
      mockSessionBundle.findOne.mockResolvedValueOnce({
        id: 'bundle-exhausted',
        total_sessions: 5,
        used_sessions: 5,
        status: 'exhausted',
        update: jest.fn(),
      });

      await expect(
        consumeSession({ tenantId, bundleId: 'bundle-exhausted', correlationId: 'corr-1' }),
      ).rejects.toMatchObject({ code: 'session_bundle_exhausted' });
    });
  });
});
