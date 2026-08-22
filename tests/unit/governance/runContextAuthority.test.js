'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rap-run-context-'));
}

function validDimension(overrides = {}) {
  return {
    id: 'RAP-001',
    name: 'Runtime authority',
    score: 10,
    target: 10,
    status: 'VERIFIED',
    requirements: [
      { id: 'same-run', mandatory: true, status: 'PASS' },
    ],
    tests: ['tests/unit/example.test.js'],
    runtimeEvidence: ['governance/example-evidence.json'],
    blockers: [],
    gaps: [],
    ...overrides,
  };
}

function lineage(overrides = {}) {
  return {
    runId: 'rap-release-20260821-120000-aaaaaaaa',
    sourceFingerprint: SHA_A,
    generatedAt: '2026-08-21T15:00:01.000Z',
    artifactType: 'test-artifact',
    artifactVersion: '1.0.0',
    ...overrides,
  };
}

describe('RunContext — immutable source and fail-closed state machine', () => {
  test('legacy startNewRun delegates to the canonical RunContext contract', () => {
    const { startNewRun } = require('../../../governance/shared/run-id');
    const rootDir = tempRoot();
    const run = startNewRun(SHA_A, { rootDir });
    expect(run.status).toBe('CREATED');
    expect(run.sourceFingerprint).toBe(SHA_A);
    expect(run.artifactType).toBe('run-context');
  });

  test('creates a CREATED run with complete lineage metadata', () => {
    const { createRunContext, readRunContext, RUN_STATES } = require('../../../governance/shared/run-context');
    const rootDir = tempRoot();
    const run = createRunContext({
      rootDir,
      sourceFingerprint: SHA_A,
      runId: 'rap-release-20260821-120000-aaaaaaaa',
      now: () => new Date('2026-08-21T15:00:00.000Z'),
    });

    expect(run.status).toBe(RUN_STATES.CREATED);
    expect(run.artifactType).toBe('run-context');
    expect(run.artifactVersion).toBeTruthy();
    expect(readRunContext(rootDir)).toEqual(run);
  });

  test('source freeze starts the run and records the governed stage', () => {
    const { createRunContext, assertSourceFreeze, RUN_STATES } = require('../../../governance/shared/run-context');
    const rootDir = tempRoot();
    createRunContext({
      rootDir,
      sourceFingerprint: SHA_A,
      runId: 'rap-release-20260821-120000-aaaaaaaa',
    });

    const run = assertSourceFreeze({
      rootDir,
      stage: 'unit-tests',
      computeSourceFingerprint: () => SHA_A,
    });

    expect(run.status).toBe(RUN_STATES.RUNNING);
    expect(run.lastGovernedStage).toBe('unit-tests');
  });

  test('source drift invalidates the persisted run and throws RUN_SOURCE_DRIFT', () => {
    const { createRunContext, assertSourceFreeze, readRunContext, RUN_STATES } = require('../../../governance/shared/run-context');
    const rootDir = tempRoot();
    createRunContext({
      rootDir,
      sourceFingerprint: SHA_A,
      runId: 'rap-release-20260821-120000-aaaaaaaa',
    });

    expect(() => assertSourceFreeze({
      rootDir,
      stage: 'final-governance',
      computeSourceFingerprint: () => SHA_B,
    })).toThrow(/RUN_SOURCE_DRIFT/);

    const invalidated = readRunContext(rootDir);
    expect(invalidated.status).toBe(RUN_STATES.INVALIDATED);
    expect(invalidated.invalidation.reason).toBe('RUN_SOURCE_DRIFT');
    expect(invalidated.invalidation.actualSourceFingerprint).toBe(SHA_B);
  });

  test('illegal state transition is rejected', () => {
    const { createRunContext, transitionRunContext } = require('../../../governance/shared/run-context');
    const rootDir = tempRoot();
    createRunContext({
      rootDir,
      sourceFingerprint: SHA_A,
      runId: 'rap-release-20260821-120000-aaaaaaaa',
    });

    expect(() => transitionRunContext({ rootDir, toStatus: 'VERIFIED' }))
      .toThrow(/INVALID_RUN_TRANSITION/);
  });
});

describe('Artifact lineage — every governed artifact belongs to the frozen run', () => {
  const runContext = {
    ...lineage({ artifactType: 'run-context' }),
    status: 'RUNNING',
    startedAt: '2026-08-21T15:00:00.000Z',
  };

  test.each(['runId', 'sourceFingerprint', 'generatedAt', 'artifactType', 'artifactVersion'])(
    'missing %s is INVALID_ARTIFACT',
    (field) => {
      const { validateArtifactLineage } = require('../../../governance/shared/artifact-lineage');
      const artifact = lineage();
      delete artifact[field];
      const result = validateArtifactLineage(artifact, runContext);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_ARTIFACT');
    },
  );

  test('foreign run and source mismatch are rejected', () => {
    const { validateArtifactLineage } = require('../../../governance/shared/artifact-lineage');
    expect(validateArtifactLineage(lineage({ runId: 'foreign' }), runContext).code)
      .toBe('FOREIGN_RUN_ARTIFACT');
    expect(validateArtifactLineage(lineage({ sourceFingerprint: SHA_B }), runContext).code)
      .toBe('ARTIFACT_SOURCE_MISMATCH');
  });

  test('legacy validateArtifactRun cannot allow missing runId', () => {
    const { validateArtifactRun } = require('../../../governance/shared/run-id');
    expect(validateArtifactRun({}, { allowMissing: true, currentRun: runContext })).toEqual(
      expect.objectContaining({ valid: false, status: 'NO_RUN_ID' }),
    );
  });
});

describe('Master scorecard authority — same run and all mandatory requirements', () => {
  const runContext = {
    ...lineage({ artifactType: 'run-context' }),
    status: 'RUNNING',
    startedAt: '2026-08-21T15:00:00.000Z',
  };

  function scorecard(overrides = {}) {
    return {
      ...lineage({ artifactType: 'rap-master-scorecard' }),
      schema: 'rap-master-scorecard/v2',
      dimensions: [validDimension()],
      blockers: [],
      gaps: [],
      ...overrides,
    };
  }

  test('valid 10/10 scorecard is PASS', () => {
    const { evaluateMasterScorecard } = require('../../../governance/shared/certification-authority');
    expect(evaluateMasterScorecard(scorecard(), runContext).status).toBe('PASS');
  });

  test('below-10, missing requirements, open blocker and foreign run are fatal', () => {
    const { evaluateMasterScorecard } = require('../../../governance/shared/certification-authority');
    expect(evaluateMasterScorecard(scorecard({ dimensions: [validDimension({ score: 9 })] }), runContext).status).toBe('FAIL');
    expect(evaluateMasterScorecard(scorecard({ dimensions: [validDimension({ requirements: [] })] }), runContext).status).toBe('FAIL');
    expect(evaluateMasterScorecard(scorecard({ dimensions: [validDimension({ blockers: [{ id: 'b1', status: 'OPEN' }] })] }), runContext).status).toBe('FAIL');
    expect(evaluateMasterScorecard(scorecard({ runId: 'foreign' }), runContext).reason).toMatch(/FOREIGN_RUN_ARTIFACT/);
  });
});
