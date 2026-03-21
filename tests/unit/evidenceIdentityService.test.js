'use strict';

const { createEvidenceIdentityService } = require('../../api/services/evidenceIdentityService');

describe('evidenceIdentityService', () => {
  function makeGetter(api) {
    return () => api;
  }

  test('resolve identidade por ticket e membership/customer relacionados', async () => {
    const service = createEvidenceIdentityService({
      queueService: {
        getTicket: jest.fn(() => ({
          id: 't1',
          tenantId: 'tenant1',
          conversationId: 'c1',
          phoneNumber: '+5511999999999',
          context: {
            membershipId: 'mem-1',
            customerId: 'cust-1',
          },
        })),
      },
      ChannelConversation: makeGetter({ findOne: jest.fn(async () => ({ toJSON: () => ({ id: 'c1', external_id: '+5511999999999', contact_id: '5511999999999' }) })) }),
      Ticket: makeGetter({ findOne: jest.fn(async () => null) }),
      AccessMembership: makeGetter({ findOne: jest.fn(async () => ({ toJSON: () => ({ id: 'mem-1', subject_id: 'sub-1', customer_id: 'cust-1' }) })) }),
      AccessSubject: makeGetter({ findOne: jest.fn(async () => ({ toJSON: () => ({ id: 'sub-1', customer_id: 'cust-1', membership_id: 'mem-1' }) })) }),
    });

    const result = await service.resolveIdentity({
      tenantId: 'tenant1',
      ticketId: 't1',
      membershipId: 'mem-1',
    });

    expect(result.ok).toBe(true);
    expect(result.identity).toEqual(expect.objectContaining({
      entityType: 'customer',
      entityId: 'cust-1',
    }));
    expect(result.identity.relatedEntities).toEqual(expect.arrayContaining([
      { type: 'membership', id: 'mem-1' },
      { type: 'subject', id: 'sub-1' },
      { type: 'ticket', id: 't1' },
    ]));
  });

  test('nao força identidade errada quando só há phone/contact de baixa confiança', async () => {
    const service = createEvidenceIdentityService({
      queueService: { getTicket: jest.fn(() => null) },
      ChannelConversation: makeGetter({ findOne: jest.fn(async () => null) }),
      Ticket: makeGetter({ findOne: jest.fn(async () => null) }),
      AccessMembership: makeGetter({ findOne: jest.fn(async () => null) }),
      AccessSubject: makeGetter({ findOne: jest.fn(async () => null) }),
    });

    const result = await service.resolveIdentity({
      tenantId: 'tenant1',
      phone: '5511999999999',
    });

    expect(result.ok).toBe(true);
    expect(result.identity.entityType).toBe('contact');
    expect(result.identity.entityId).toBe('+5511999999999');
    expect(result.identity.confidence).toBeLessThan(0.9);
    expect(result.candidates).toHaveLength(1);
  });
});
