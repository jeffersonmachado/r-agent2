'use strict';

/**
 * Testes do gate de projection consistency (FINAL_STATUS_PROJECTION_STALE).
 * Usa diretórios-fixture temporários; não toca nos artefatos reais do repo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkProjectionConsistency } = require('../../scripts/governance/validate-final-status-projection');

const RUN_ID = 'rap-governed-20260905000000000-fixtproj';
const SOURCE_FP = 'a'.repeat(64);

function writeJson(root, rel, data) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data));
}

function writeText(root, rel, text) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function buildFixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projection-gate-'));
  const decision = overrides.decision || 'AUTONOMOUS_READY_GO';
  const runId = 'runId' in overrides ? overrides.runId : RUN_ID;
  const fp = 'sourceFingerprint' in overrides ? overrides.sourceFingerprint : SOURCE_FP;

  writeJson(root, 'governance/final-readiness-report.json', { finalDecision: decision, runId, sourceFingerprint: fp });
  writeJson(root, 'governance/final-governance-report.json', { finalDecision: decision, runId, sourceFingerprint: fp });
  writeJson(root, 'governance/rap-master-scorecard.json', {
    overallStatus: 'VERIFIED',
    runId,
    sourceFingerprint: fp,
    summary: { totalDimensions: 78, dimensionsAt10: 78, dimensionsBelow10: 0 },
  });
  writeJson(root, 'docs/governance/_platform-status-source.json', {
    finalDecision: overrides.sourceJson ?? decision,
    runId: 'sourceJsonRunId' in overrides ? overrides.sourceJsonRunId : runId,
    sourceFingerprint: 'sourceJsonFp' in overrides ? overrides.sourceJsonFp : fp,
  });
  writeJson(root, 'dev/platform-readiness/latest.json', {
    finalDecision: overrides.latestJson ?? decision,
    runId: 'latestJsonRunId' in overrides ? overrides.latestJsonRunId : runId,
    sourceFingerprint: 'latestJsonFp' in overrides ? overrides.latestJsonFp : fp,
    productionReadiness: { status: overrides.latestJsonProductionStatus ?? decision },
  });
  writeText(root, 'docs/governance/ENTERPRISE_READINESS.md', [
    '# Readiness',
    `- Decision: ${overrides.readinessMd ?? decision}`,
    `- Production readiness: ${overrides.readinessMdProduction ?? decision}`,
    '',
  ].join('\n'));
  writeText(root, 'docs/governance/PLATFORM_STATUS.md', [
    '# Status',
    `- Readiness decision: ${overrides.statusMd ?? decision}`,
    `- Score: ${overrides.statusMdScore ?? '78/78'}`,
    '',
  ].join('\n'));
  writeText(root, 'docs/architecture/RAP_MASTER_SCORECARD.md', [
    '# Scorecard',
    `- Run ID: ${overrides.scorecardMdRunId ?? runId}`,
    `- Source fingerprint: ${overrides.scorecardMdFp ?? fp}`,
    `- Overall status: **${overrides.scorecardMd ?? 'VERIFIED'}**`,
    `- Dimensions: ${overrides.scorecardMdTotal ?? 78}`,
    `- 10/10: ${overrides.scorecardMdAt10 ?? 78}`,
    `- Below 10: ${overrides.scorecardMdBelow10 ?? 0}`,
    '',
  ].join('\n'));
  return root;
}

describe('final-status-projection gate', () => {
  const roots = [];
  afterEach(() => {
    while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
  });
  const fixture = (overrides) => {
    const root = buildFixture(overrides);
    roots.push(root);
    return root;
  };

  it('PASS quando todas as projeções refletem a decisão canônica', () => {
    const result = checkProjectionConsistency(fixture());
    expect(result.status).toBe('PASS');
    expect(result.code).toBe('FINAL_STATUS_PROJECTION_CONSISTENT');
    expect(result.issues).toHaveLength(0);
    expect(result.projectionsChecked).toBe(5);
  });

  it('PASS quando a canônica não carrega lineage (projeções legadas sem runId)', () => {
    const result = checkProjectionConsistency(fixture({ runId: null, sourceFingerprint: null }));
    expect(result.status).toBe('PASS');
    expect(result.issues).toHaveLength(0);
  });

  it('FAIL quando projeção JSON diverge da decisão canônica', () => {
    const result = checkProjectionConsistency(fixture({ latestJson: 'NO_GO:STALE' }));
    expect(result.status).toBe('FAIL');
    expect(result.code).toBe('FINAL_STATUS_PROJECTION_STALE');
    expect(result.issues.some((i) => i.projection === 'dev/platform-readiness/latest.json')).toBe(true);
  });

  it('FAIL quando PLATFORM_STATUS.md declara decisão divergente', () => {
    const result = checkProjectionConsistency(fixture({ statusMd: 'NO_GO' }));
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => i.projection === 'docs/governance/PLATFORM_STATUS.md')).toBe(true);
  });

  it('FAIL quando ENTERPRISE_READINESS.md declara decisão divergente', () => {
    const result = checkProjectionConsistency(fixture({ readinessMd: 'IN_PROGRESS' }));
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => i.projection === 'docs/governance/ENTERPRISE_READINESS.md')).toBe(true);
  });

  it('FAIL quando scorecard MD diverge do status canônico', () => {
    const result = checkProjectionConsistency(fixture({ scorecardMd: 'IN_PROGRESS' }));
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => i.projection === 'docs/architecture/RAP_MASTER_SCORECARD.md')).toBe(true);
  });

  it('FAIL quando os dois relatórios canônicos divergem entre si', () => {
    const root = fixture();
    writeJson(root, 'governance/final-governance-report.json', { finalDecision: 'NO_GO:INTERNAL' });
    const result = checkProjectionConsistency(root);
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => String(i.issue).includes('canonical_divergence'))).toBe(true);
  });

  it('FAIL quando projeção obrigatória está ausente', () => {
    const root = fixture();
    fs.rmSync(path.join(root, 'dev/platform-readiness/latest.json'));
    const result = checkProjectionConsistency(root);
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => String(i.issue).includes('missing:dev/platform-readiness/latest.json'))).toBe(true);
  });

  // ── Casos adversariais do BLOCKER 2 (release r-agent2-20260905-163709) ─────

  it('FAIL em score mismatch 76/78 com canônica 78/78 (stale_score em MD)', () => {
    const result = checkProjectionConsistency(fixture({ statusMdScore: '76/78' }));
    expect(result.status).toBe('FAIL');
    expect(result.code).toBe('FINAL_STATUS_PROJECTION_STALE');
    expect(result.issues.some((i) => String(i.issue).includes('stale_score') && String(i.issue).includes('76/78'))).toBe(true);
  });

  it('FAIL em score mismatch na linha de sumário do scorecard MD (10/10: 76)', () => {
    const result = checkProjectionConsistency(fixture({ scorecardMdAt10: 76 }));
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => i.projection === 'docs/architecture/RAP_MASTER_SCORECARD.md' && String(i.issue).includes('stale_score'))).toBe(true);
  });

  it('FAIL em divergência de runId na projeção JSON', () => {
    const result = checkProjectionConsistency(fixture({ latestJsonRunId: 'rap-governed-19990101000000000-stale00' }));
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => String(i.issue).includes('stale_run_id'))).toBe(true);
  });

  it('FAIL em divergência de sourceFingerprint na projeção JSON', () => {
    const result = checkProjectionConsistency(fixture({ sourceJsonFp: 'f'.repeat(64) }));
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => String(i.issue).includes('stale_source_fingerprint'))).toBe(true);
  });

  it('FAIL em divergência de runId no scorecard MD', () => {
    const result = checkProjectionConsistency(fixture({ scorecardMdRunId: 'rap-governed-19990101000000000-stale00' }));
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => i.projection === 'docs/architecture/RAP_MASTER_SCORECARD.md' && String(i.issue).includes('stale_run_id'))).toBe(true);
  });

  it('FAIL quando projeção JSON lineageada não carrega runId (missing)', () => {
    const result = checkProjectionConsistency(fixture({ latestJsonRunId: undefined }));
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => String(i.issue).includes('stale_run_id') && String(i.issue).includes('missing'))).toBe(true);
  });

  it('FAIL em stale-decision NO_GO em linha decisória secundária com canônica GO', () => {
    const result = checkProjectionConsistency(fixture({ readinessMdProduction: 'NO_GO:STALE' }));
    expect(result.status).toBe('FAIL');
    expect(result.issues.some((i) => String(i.issue).includes('stale_decision_token'))).toBe(true);
  });

  it('FAIL quando canônica é NO_GO e docs declaram GO', () => {
    const result = checkProjectionConsistency(fixture({
      decision: 'NO_GO:MANDATORY_GATE_BLOCKED',
      statusMd: 'AUTONOMOUS_READY_GO',
      readinessMd: 'AUTONOMOUS_READY_GO',
    }));
    expect(result.status).toBe('FAIL');
    expect(result.code).toBe('FINAL_STATUS_PROJECTION_STALE');
  });

  it('PASS com canônica NO_GO refletida nas projeções (verdade, não promoção)', () => {
    const result = checkProjectionConsistency(fixture({ decision: 'NO_GO:MANDATORY_GATE_BLOCKED' }));
    expect(result.status).toBe('PASS');
    expect(result.issues).toHaveLength(0);
  });

  it('estado real do repositório está consistente', () => {
    const result = checkProjectionConsistency(path.resolve(__dirname, '..', '..'));
    expect(result.issues).toEqual([]);
    expect(result.status).toBe('PASS');
  });
});
