'use strict';

const {
  MASTER_SCORECARD_REGISTRY,
} = require('../../../governance/master-scorecard-registry');
const {
  validateRegistry,
} = require('../../../governance/master-scorecard-engine');

describe('RAP-076 — Governance Persistence & Certification Data Model', () => {
  test('is an applicable, mandatory and validator-backed canonical dimension', () => {
    const dimension = MASTER_SCORECARD_REGISTRY.find((item) => item.id === 'RAP-076');

    expect(dimension).toBeDefined();
    expect(dimension.applicable).toBe(true);
    expect(dimension.name).toBe('Governance Persistence & Certification Data Model');
    expect(dimension.requirements).toHaveLength(11);
    expect(dimension.requirements.every((item) => item.mandatory === true)).toBe(true);
    expect(dimension.traceability.sources).toEqual(expect.arrayContaining([
      'api/db/models/GovernanceRun.js',
      'api/services/governance/certificationService.js',
    ]));
    expect(dimension.traceability.tests).toEqual(expect.arrayContaining([
      'tests/unit/governance/governancePersistenceControlPlane.test.js',
    ]));
  });

  test('canonical registry is contiguous through RAP-078', () => {
    expect(MASTER_SCORECARD_REGISTRY).toHaveLength(78);
    expect(validateRegistry(MASTER_SCORECARD_REGISTRY, { requireCanonicalIds: true })).toEqual([]);
  });
});
