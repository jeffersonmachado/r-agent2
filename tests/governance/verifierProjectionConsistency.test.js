'use strict';

/**
 * Testes do gate final_status_projection_consistency do verify-payload-governance
 * (BLOCKER 2 — release r-agent2-20260905-163709: canônica 78/78 GO empacotada
 * com docs stale 76/78 IN_PROGRESS NO_GO).
 *
 * Cada teste constrói a fixture completa de release (payload zip real) e
 * adultera UM aspecto das projeções embutidas; o gate deve reprovar com
 * FINAL_STATUS_PROJECTION_STALE.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildReleaseFixture, makeFixtureDir } = require('../../tests/helpers/releaseEnvelopeFixture');

const VERIFIER = path.join(__dirname, '..', '..', 'scripts', 'verify-payload-governance.js');

function runVerifier(fixture, extraArgs = []) {
  const result = spawnSync(process.execPath, [
    VERIFIER,
    '--payload', fixture.payloadPath,
    '--manifest', fixture.manifestPath,
    '--envelope-governance', fixture.envelopeGovDir,
    '--signatures', fixture.signaturesDir,
    '--verifier', fixture.verifierDir,
    ...extraArgs,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return {
    exitCode: result.status,
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
  };
}

function gateStatus(output, gateId) {
  const line = output.split('\n').find((l) => l.includes(gateId));
  if (!line) return null;
  if (line.includes('FAIL')) return 'FAIL';
  if (line.includes('PASS')) return 'PASS';
  return null;
}

const GATE = 'final_status_projection_consistency';

describe('verify-payload-governance — final_status_projection_consistency', () => {
  it('PASS: projeções do payload consistentes com a canônica embutida', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir);
    const result = runVerifier(fixture);
    expect(result.output).toContain('PAYLOAD_GOVERNANCE_VERIFIED');
    expect(result.exitCode).toBe(0);
    expect(gateStatus(result.output, GATE)).toBe('PASS');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('FAIL: RAP_MASTER_SCORECARD.md adulterado 78→76 (stale score)', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, { projectionScorecardMdAt10: 76 });
    const result = runVerifier(fixture);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('PAYLOAD_GOVERNANCE_NO_GO');
    expect(gateStatus(result.output, GATE)).toBe('FAIL');
    expect(result.output).toContain('FINAL_STATUS_PROJECTION_STALE');
    expect(result.output).toContain('STALE_SCORE');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('FAIL: PLATFORM_STATUS.md adulterado GO→NO_GO (stale decision)', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, { projectionStatusDecision: 'NO_GO:STALE' });
    const result = runVerifier(fixture);
    expect(result.exitCode).toBe(1);
    expect(gateStatus(result.output, GATE)).toBe('FAIL');
    expect(result.output).toContain('FINAL_STATUS_PROJECTION_STALE');
    expect(result.output).toContain('STALE_DECISION');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('FAIL: latest.json do payload com finalDecision divergente', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, { projectionDecision: 'NO_GO:STALE' });
    const result = runVerifier(fixture);
    expect(result.exitCode).toBe(1);
    expect(gateStatus(result.output, GATE)).toBe('FAIL');
    expect(result.output).toContain('FINAL_STATUS_PROJECTION_STALE');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('FAIL: projeções com runId de outro run (cross-run)', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, { projectionRunId: 'rap-governed-19990101000000000-foreign' });
    const result = runVerifier(fixture);
    expect(result.exitCode).toBe(1);
    expect(gateStatus(result.output, GATE)).toBe('FAIL');
    expect(result.output).toContain('STALE_RUN_ID');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('FAIL: projeções com sourceFingerprint divergente', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, { projectionSourceFingerprint: 'f'.repeat(64) });
    const result = runVerifier(fixture);
    expect(result.exitCode).toBe(1);
    expect(gateStatus(result.output, GATE)).toBe('FAIL');
    expect(result.output).toContain('STALE_SOURCE_FINGERPRINT');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('FAIL: projeções ausentes no payload (MISSING_PROJECTION)', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, { omitPayloadProjections: true });
    const result = runVerifier(fixture);
    expect(result.exitCode).toBe(1);
    expect(gateStatus(result.output, GATE)).toBe('FAIL');
    expect(result.output).toContain('MISSING_PROJECTION');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('candidato DELIVERED: projeções DEFERRED verdadeiras passam no modo --candidate', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, {
      payloadDecision: 'PASS_WITH_DEFERRED_PACKAGE_GATE',
      scorecardBelow10: ['RAP-055', 'RAP-056'],
    });
    const result = runVerifier(fixture, ['--candidate']);
    expect(result.exitCode).toBe(0);
    expect(gateStatus(result.output, GATE)).toBe('PASS');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
