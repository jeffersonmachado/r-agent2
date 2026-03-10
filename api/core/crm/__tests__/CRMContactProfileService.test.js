'use strict';

const mockFindOne = jest.fn();
const mockListContactTimeline = jest.fn();
const mockGetContactRelationships = jest.fn();
const mockListContactOpportunities = jest.fn();

jest.mock('../../../db/sequelize', () => ({
  getSequelize: jest.fn(() => ({ ok: true })),
}));

jest.mock('../../../db/models', () => ({
  CrmContact: () => ({ findOne: (...args) => mockFindOne(...args) }),
}));

jest.mock('../CRMEventService', () => ({
  listContactTimeline: (...args) => mockListContactTimeline(...args),
}));

jest.mock('../CRMRelationshipService', () => ({
  getContactRelationships: (...args) => mockGetContactRelationships(...args),
}));

jest.mock('../CRMOpportunityBridgeService', () => ({
  listContactOpportunities: (...args) => mockListContactOpportunities(...args),
}));

const service = require('../CRMContactProfileService');
const { getSequelize } = require('../../../db/sequelize');

describe('CRMContactProfileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSequelize.mockReturnValue({ ok: true });
  });

  test('retorna contact_not_found quando contato não existe', async () => {
    mockFindOne.mockResolvedValueOnce(null);

    const out = await service.getContactOperationalProfile({
      tenantId: 'tenant-1',
      contactId: 'contact-missing',
      timelineLimit: 10,
    });

    expect(out).toEqual({ ok: false, error: 'contact_not_found' });
  });

  test('agrega contato, relationships, oportunidades e timeline', async () => {
    mockFindOne.mockResolvedValueOnce({
      toJSON: () => ({ id: 'contact-1', tenant_key: 'tenant-1', name: 'Ana' }),
    });
    mockListContactTimeline.mockResolvedValueOnce({ ok: true, items: [{ id: 'evt-1' }], total: 1, limit: 20, offset: 0 });
    mockGetContactRelationships.mockResolvedValueOnce({
      ok: true,
      relationships: {
        contactId: 'contact-1',
        opportunitiesCount: 2,
        revenueOpportunitiesCount: 1,
      },
    });
    mockListContactOpportunities.mockResolvedValueOnce({
      ok: true,
      items: [{ id: 'opp-1', title: 'Plano anual' }],
    });

    const out = await service.getContactOperationalProfile({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      timelineLimit: 20,
    });

    expect(out.ok).toBe(true);
    expect(out.profile.contact).toEqual(expect.objectContaining({ id: 'contact-1' }));
    expect(out.profile.relationships).toEqual(expect.objectContaining({ opportunitiesCount: 2 }));
    expect(out.profile.opportunities).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'opp-1' })]));
    expect(out.timeline.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'evt-1' })]));
    expect(mockListContactTimeline).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', contactId: 'contact-1', limit: 20 }));
  });
});
