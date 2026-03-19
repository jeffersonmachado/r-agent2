'use strict';

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(() => ({})),
}));

jest.mock('../../api/db/models', () => ({
  AccessMembership: jest.fn(() => mockAccessMembership),
  AccessSubject: jest.fn(() => ({})),
}));

jest.mock('../../api/services/vertical/billingOrchestrationService', () => ({
  updateBillingStatus: jest.fn(async ({ membershipId, toStatus }) => ({ id: membershipId, billing_status: toStatus })),
  blockMembership: jest.fn(async ({ membershipId }) => ({ id: membershipId, billing_status: 'blocked' })),
  reactivateMembership: jest.fn(async ({ membershipId }) => ({ id: membershipId, billing_status: 'active' })),
  computeEffectiveBillingStatus: jest.fn((m) => m.billing_status),
  isAccessAllowedByBilling: jest.fn((m) => m.billing_status === 'active'),
}));

jest.mock('../../api/services/vertical/customerJourneyEngine', () => ({
  emitJourneyEvent: jest.fn(async () => ({ id: 'vje-1' })),
}));

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: jest.fn(async () => ({})),
}));

const mockAccessMembership = {
  findOne: jest.fn(),
  findAll: jest.fn(),
  update: jest.fn(),
};

const { blockMembership, reactivateMembership } = require('../../api/services/vertical/billingOrchestrationService');
const { emitJourneyEvent, emitJourneyEvent: mockEmitJourneyEvent } = require('../../api/services/vertical/customerJourneyEngine');
const { getSequelize } = require('../../api/db/sequelize');
const { AccessMembership: mockAccessMembershipFactory, AccessSubject: mockAccessSubjectFactory } = require('../../api/db/models');
const { blockMembership: mockBlockMembership, reactivateMembership: mockReactivateMembership } = require('../../api/services/vertical/billingOrchestrationService');
const {
  getMembershipDetail,
  listFitnessMemberships,
  startGracePeriod,
  endGracePeriodWithBlock,
  processMembershipRenewal,
  getMembershipAccessStatus,
  sendWelcome,
  detectChurnRisk,
} = require('../../api/services/vertical/fitnessMembershipService');

describe('fitnessMembershipService', () => {
  const tenantId = 'tenant-a';
  const membershipId = 'mem-1';
  const subjectId = 'sub-1';

  beforeEach(() => {
    // resetMocks: true wipes all implementations — restore them here
    getSequelize.mockReturnValue({});
    mockAccessMembershipFactory.mockReturnValue(mockAccessMembership);
    mockAccessSubjectFactory.mockReturnValue({});
    mockEmitJourneyEvent.mockResolvedValue({ id: 'vje-1' });
    mockBlockMembership.mockResolvedValue({ id: membershipId, billing_status: 'blocked' });
    mockReactivateMembership.mockResolvedValue({ id: membershipId, billing_status: 'active' });
    // Also restore billingOrchestrationService mocks used by startGracePeriod/etc
    const { updateBillingStatus, computeEffectiveBillingStatus, isAccessAllowedByBilling } = require('../../api/services/vertical/billingOrchestrationService');
    updateBillingStatus.mockImplementation(async ({ membershipId: mId, toStatus }) => ({ id: mId, billing_status: toStatus }));
    computeEffectiveBillingStatus.mockImplementation((m) => m.billing_status);
    isAccessAllowedByBilling.mockImplementation((m) => m.billing_status === 'active');

    const rowBase = {
      id: membershipId,
      tenant_key: tenantId,
      subject_id: subjectId,
      vertical: 'fitness',
      billing_status: 'active',
      status: 'active',
      grace_until: null,
    };
    mockAccessMembership.findOne.mockResolvedValue({
      ...rowBase,
      toJSON: () => rowBase,
      update: jest.fn(async (data) => ({ ...rowBase, ...data, toJSON: () => ({ ...rowBase, ...data }) })),
    });
    mockAccessMembership.findAll.mockResolvedValue([]);
  });

  describe('getMembershipDetail', () => {
    it('retorna membership com effectiveBillingStatus', async () => {
      const result = await getMembershipDetail({ tenantId, membershipId });
      expect(result).not.toBeNull();
      expect(result.effectiveBillingStatus).toBeDefined();
      expect(result.accessAllowed).toBeDefined();
    });

    it('retorna null quando membership não encontrada', async () => {
      mockAccessMembership.findOne.mockResolvedValueOnce(null);
      const result = await getMembershipDetail({ tenantId, membershipId: 'nao-existe' });
      expect(result).toBeNull();
    });

    it('retorna null quando DB indisponível', async () => {
      const { getSequelize } = require('../../api/db/sequelize');
      getSequelize.mockReturnValueOnce(null);

      const result = await getMembershipDetail({ tenantId, membershipId });
      expect(result).toBeNull();
    });
  });

  describe('listFitnessMemberships', () => {
    it('lista memberships com filtro de billingStatus', async () => {
      mockAccessMembership.findAll.mockResolvedValueOnce([
        { id: 'mem-1', billing_status: 'active', toJSON: () => ({ id: 'mem-1', billing_status: 'active' }) },
      ]);

      const result = await listFitnessMemberships({ tenantId, billingStatus: 'active' });
      expect(result.items).toHaveLength(1);
      expect(mockAccessMembership.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ billing_status: 'active' }) }),
      );
    });
  });

  describe('startGracePeriod', () => {
    it('chama updateBillingStatus com grace_period e grace_until', async () => {
      const { updateBillingStatus } = require('../../api/services/vertical/billingOrchestrationService');
      updateBillingStatus.mockResolvedValueOnce({ id: membershipId, billing_status: 'grace_period' });

      const result = await startGracePeriod({ tenantId, membershipId, graceDays: 7 });

      expect(updateBillingStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          membershipId,
          toStatus: 'delinquent',
          extraFields: expect.objectContaining({ grace_until: expect.any(String) }),
        }),
      );
    });
  });

  describe('endGracePeriodWithBlock', () => {
    it('chama blockMembership quando período de graça termina', async () => {
      await endGracePeriodWithBlock({ tenantId, membershipId, reason: 'grace_expired' });
      expect(blockMembership).toHaveBeenCalledWith(expect.objectContaining({ tenantId, membershipId }));
    });
  });

  describe('processMembershipRenewal', () => {
    it('chama reactivateMembership e atualiza renewal_at', async () => {
      await processMembershipRenewal({ tenantId, membershipId, renewalDate: new Date() });
      expect(reactivateMembership).toHaveBeenCalledWith(expect.objectContaining({ tenantId, membershipId }));
    });
  });

  describe('getMembershipAccessStatus', () => {
    it('retorna accessAllowed e billing details', async () => {
      const result = await getMembershipAccessStatus({ tenantId, membershipId });
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('reasonCode');
      expect(result).toHaveProperty('membership');
    });
  });

  describe('sendWelcome', () => {
    it('emite journey event de welcome_sent', async () => {
      await sendWelcome({ tenantId, subjectId, customerId: 'cust-1', membershipId });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'welcome_sent', vertical: 'fitness' }),
      );
    });
  });

  describe('detectChurnRisk', () => {
    it('retorna score e sinaliza risco para usuário inativo 40+ dias', async () => {
      const result = await detectChurnRisk({
        tenantId,
        membershipId,
        subjectId,
        daysSinceLastVisit: 45,
        frequency30d: 0,
        billingStatus: 'active',
      });
      expect(result).toBeDefined();
      expect(result.score).toBeGreaterThan(0);
      expect(result.isChurnRisk).toBe(true);
    });

    it('score baixo para usuário com alta frequência', async () => {
      const result = await detectChurnRisk({
        tenantId,
        membershipId,
        subjectId,
        daysSinceLastVisit: 2,
        frequency30d: 12,
        billingStatus: 'active',
      });
      expect(result.score).toBeLessThan(0.4);
    });
  });
});
