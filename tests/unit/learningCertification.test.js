'use strict';

const mockCertFindOne = jest.fn();
const mockCertFindAll = jest.fn();
const mockCertCreate = jest.fn();

jest.mock('../../api/db/models/UserCertification', () => () => ({
  findOne: (...args) => mockCertFindOne(...args),
  findAll: (...args) => mockCertFindAll(...args),
  create: (...args) => mockCertCreate(...args),
}));

const mockGetCompetencies = jest.fn();
const mockLoadLedgerEvents = jest.fn();
const mockLoadTenantRouteMap = jest.fn();
const mockGetSkillGraphArtifact = jest.fn();

jest.mock('../../api/modules/learning-core/competencyService', () => ({
  getCompetencies: (...args) => mockGetCompetencies(...args),
  loadLedgerEvents: (...args) => mockLoadLedgerEvents(...args),
  loadTenantRouteMap: (...args) => mockLoadTenantRouteMap(...args),
  getSkillGraphArtifact: (...args) => mockGetSkillGraphArtifact(...args),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { evaluateCertifications, listCertifications } = require('../../api/modules/learning-core/certificationService');

const CERTIFIABLE_COMPETENCY = {
  skillKey: 'tickets',
  score: 0.9,
  components: { precision: 0.95, coverage: 0.8, tempo: 0.7, autonomia: 0.9, consistencia: 0.8 },
  evidenceRefs: ['evt-1'],
  eventCount: 30,
};

function setupCertifiable() {
  mockGetCompetencies.mockResolvedValue({
    competencies: [CERTIFIABLE_COMPETENCY],
    profile: null,
  });
  mockLoadLedgerEvents.mockResolvedValue([]);
  mockLoadTenantRouteMap.mockResolvedValue({});
  mockGetSkillGraphArtifact.mockReturnValue({ routeSkillMap: { '/inbox': 'tickets' } });
}

describe('learning certificationService — evaluateCertifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCertFindAll.mockResolvedValue([]);
  });

  it('emite certificação quando a skill é certificável e não há ativa', async () => {
    setupCertifiable();
    mockCertFindOne.mockResolvedValue(null);
    mockCertCreate.mockImplementation(async (values) => ({ id: 'cert-1', ...values }));

    const result = await evaluateCertifications({ tenantId: 't1', agentId: 'a1' });

    expect(mockCertCreate).toHaveBeenCalledTimes(1);
    const created = mockCertCreate.mock.calls[0][0];
    expect(created.skillKey).toBe('tickets');
    expect(created.status).toBe('active');
    expect(created.assessmentSnapshot.criteria.precisao).toBe(0.95);
    expect(created.assessmentSnapshot.thresholds).toBeDefined();
    expect(created.evidenceRefs).toEqual(['evt-1']);
    expect(result.issued).toHaveLength(1);
    expect(result.revoked).toHaveLength(0);
  });

  it('não emite duplicata quando já existe certificação ativa', async () => {
    setupCertifiable();
    mockCertFindOne.mockResolvedValue({ id: 'cert-1', status: 'active' });

    const result = await evaluateCertifications({ tenantId: 't1', agentId: 'a1' });

    expect(mockCertCreate).not.toHaveBeenCalled();
    expect(result.issued).toHaveLength(0);
  });

  it('revoga certificação ativa quando a skill deixa de ser certificável (drift)', async () => {
    mockGetCompetencies.mockResolvedValue({
      competencies: [{
        ...CERTIFIABLE_COMPETENCY,
        components: { ...CERTIFIABLE_COMPETENCY.components, precision: 0.5 },
      }],
      profile: null,
    });
    mockLoadLedgerEvents.mockResolvedValue([]);
    mockLoadTenantRouteMap.mockResolvedValue({});
    mockGetSkillGraphArtifact.mockReturnValue({ routeSkillMap: { '/inbox': 'tickets' } });

    const update = jest.fn(async () => {});
    mockCertFindOne.mockResolvedValue({ id: 'cert-1', status: 'active', update });

    const result = await evaluateCertifications({ tenantId: 't1', agentId: 'a1' });

    expect(update).toHaveBeenCalledTimes(1);
    const revokedWith = update.mock.calls[0][0];
    expect(revokedWith.status).toBe('revoked');
    expect(revokedWith.revokeReason).toContain('drift:');
    expect(result.revoked).toHaveLength(1);
  });

  it('sem competências não emite nem revoga nada', async () => {
    mockGetCompetencies.mockResolvedValue({ competencies: [], profile: null });
    mockLoadLedgerEvents.mockResolvedValue([]);
    mockLoadTenantRouteMap.mockResolvedValue({});
    mockGetSkillGraphArtifact.mockReturnValue(null);

    const result = await evaluateCertifications({ tenantId: 't1', agentId: 'a1' });

    expect(mockCertFindOne).not.toHaveBeenCalled();
    expect(result.issued).toHaveLength(0);
    expect(result.revoked).toHaveLength(0);
  });
});

describe('learning certificationService — listCertifications', () => {
  it('serializa o histórico (ativas e revogadas)', async () => {
    mockCertFindAll.mockResolvedValue([
      {
        id: 'c1', skillKey: 'tickets', level: 'operacional', status: 'active',
        assessmentSnapshot: { criteria: {} }, evidenceRefs: ['evt-1'],
        issuedAt: '2026-07-23T10:00:00Z', revokedAt: null, revokeReason: null,
      },
      {
        id: 'c2', skillKey: 'crm', level: 'operacional', status: 'revoked',
        assessmentSnapshot: { criteria: {} }, evidenceRefs: [],
        issuedAt: '2026-07-20T10:00:00Z', revokedAt: '2026-07-22T10:00:00Z', revokeReason: 'drift:precision',
      },
    ]);

    const result = await listCertifications({ tenantId: 't1', agentId: 'a1' });

    expect(result).toHaveLength(2);
    expect(result[0].skillKey).toBe('tickets');
    expect(result[1].status).toBe('revoked');
    expect(result[1].revokeReason).toBe('drift:precision');
  });
});
