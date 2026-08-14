'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { signReplayArtifact } = require('../../lib/replayIntegrity');
const {
  buildQaWavesEnterpriseGovernance,
} = require('../../tools/system/lib/qa-waves-enterprise-governance-bridge');

const JOURNEYS = ['support_ticket_flow', 'fitness_customer_checkin', 'booking_flow'];

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildFixture(root, { sourceGeneratedAt, scheduledGeneratedAt } = {}) {
  const now = Date.now();
  const sourceAt = sourceGeneratedAt || new Date(now - 60_000).toISOString();
  const scheduledAt = scheduledGeneratedAt || new Date(now - 30_000).toISOString();
  const governance = { goNoGo: 'GO', isOperational: true, blockers: [] };
  const flows = JOURNEYS.map((journeyId) => ({
    journeyId,
    replay: signReplayArtifact({ journeyId, steps: [] }, {
      governance,
      generatedAt: sourceAt,
      signedAt: sourceAt,
      tenantId: 'system',
    }),
    governance,
    strictGovernance: { blockers: [] },
    audit: { blockers: [] },
  }));
  const prodLike = {
    generatedAt: sourceAt,
    status: 'GO',
    productionReadiness: { decision: 'GO' },
    environment: {
      mode: 'prod_like_real_stack',
      usedFixtureServer: false,
      backend: 'real_stack',
      database: 'real',
      tenantIsolated: true,
    },
    flows,
  };
  const prodLikePath = path.join(root, 'qa', 'smoke', 'prod-like', 'qa-waves-operational-prod-like-smoke.json');
  const scheduledPath = path.join(root, 'qa', 'smoke', 'qa-waves-scheduled-operational-smoke.json');
  writeJson(prodLikePath, prodLike);
  const scheduled = {
    generatedAt: scheduledAt,
    sourceGeneratedAt: sourceAt,
    status: 'GO',
    governanceStatus: 'GO',
    scheduledMode: { id: 'nightly_full_replay', realStack: true },
    releaseEvidenceEligible: true,
    blockers: [],
    evidencePath: prodLikePath,
    evidenceSha256: fileHash(prodLikePath),
    flows: flows.map((flow) => ({
      journeyId: flow.journeyId,
      goNoGo: 'GO',
      replayHash: flow.replay.replayHash,
      replayChecksum: flow.replay.replayChecksum,
      governanceSignature: flow.replay.governanceSignature,
      integrityValid: true,
      failedResidualSteps: [],
      missingEvidence: [],
    })),
  };
  writeJson(scheduledPath, scheduled);
  return { prodLikePath, scheduledPath, scheduled, scheduledAt };
}

describe('QA Waves scheduled evidence binding', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-waves-scheduled-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('accepts fresh scheduled proof bound to the exact prod-like artifact', () => {
    const fixture = buildFixture(root);
    const report = buildQaWavesEnterpriseGovernance({
      root,
      prodLikePath: fixture.prodLikePath,
      scheduledPath: fixture.scheduledPath,
      now: new Date(fixture.scheduledAt),
    });

    expect(report.status).toBe('GO');
    expect(report.continuousValidationStatus).toEqual(expect.objectContaining({
      healthy: true,
      evidenceValid: true,
      evidenceBound: true,
      reasons: [],
    }));
  });

  test('rejects an existing but unrelated evidence file', () => {
    const fixture = buildFixture(root);
    const unrelatedPath = path.join(root, 'unrelated.json');
    writeJson(unrelatedPath, { generatedAt: fixture.scheduled.sourceGeneratedAt, status: 'GO' });
    fixture.scheduled.evidencePath = unrelatedPath;
    fixture.scheduled.evidenceSha256 = fileHash(unrelatedPath);
    writeJson(fixture.scheduledPath, fixture.scheduled);

    const report = buildQaWavesEnterpriseGovernance({
      root,
      prodLikePath: fixture.prodLikePath,
      scheduledPath: fixture.scheduledPath,
      now: new Date(fixture.scheduledAt),
    });

    expect(report.status).toBe('NO_GO');
    expect(report.continuousValidationStatus.reasons).toContain('scheduled_evidence_path_not_canonical');
  });

  test('rejects wrapper GO produzido por modo leve ou fonte sintética', () => {
    const fixture = buildFixture(root);
    fixture.scheduled.scheduledMode = { id: 'hourly_lightweight', realStack: false };
    fixture.scheduled.releaseEvidenceEligible = false;
    writeJson(fixture.scheduledPath, fixture.scheduled);

    const source = JSON.parse(fs.readFileSync(fixture.prodLikePath, 'utf8'));
    source.environment = {
      mode: 'technical_fixture',
      usedFixtureServer: true,
      backend: 'fixture_http',
      database: 'in_memory',
      tenantIsolated: false,
    };
    writeJson(fixture.prodLikePath, source);
    fixture.scheduled.evidenceSha256 = fileHash(fixture.prodLikePath);
    writeJson(fixture.scheduledPath, fixture.scheduled);

    const report = buildQaWavesEnterpriseGovernance({
      root,
      prodLikePath: fixture.prodLikePath,
      scheduledPath: fixture.scheduledPath,
      now: new Date(fixture.scheduledAt),
    });

    expect(report.status).toBe('NO_GO');
    expect(report.continuousValidationStatus.reasons).toEqual(expect.arrayContaining([
      'scheduled_mode_not_release_eligible',
      'scheduled_source_environment_not_prod_like',
    ]));
  });

  test('rejects a refreshed wrapper around stale prod-like evidence', () => {
    const sourceAt = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const fixture = buildFixture(root, {
      sourceGeneratedAt: sourceAt,
      scheduledGeneratedAt: new Date().toISOString(),
    });

    const report = buildQaWavesEnterpriseGovernance({
      root,
      prodLikePath: fixture.prodLikePath,
      scheduledPath: fixture.scheduledPath,
      now: new Date(),
    });

    expect(report.status).toBe('NO_GO');
    expect(report.continuousValidationStatus.reasons).toContain('scheduled_source_evidence_stale');
  });

  test('rejects copied flow proof that no longer matches the source artifact', () => {
    const fixture = buildFixture(root);
    fixture.scheduled.flows[0].replayHash = '0'.repeat(64);
    writeJson(fixture.scheduledPath, fixture.scheduled);

    const report = buildQaWavesEnterpriseGovernance({
      root,
      prodLikePath: fixture.prodLikePath,
      scheduledPath: fixture.scheduledPath,
      now: new Date(fixture.scheduledAt),
    });

    expect(report.status).toBe('NO_GO');
    expect(report.continuousValidationStatus.reasons)
      .toContain('scheduled_flow_source_mismatch:support_ticket_flow:replayHash');
  });
});
