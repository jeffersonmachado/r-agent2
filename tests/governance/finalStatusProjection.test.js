'use strict';

/**
 * Testes do gate de projection consistency (FINAL_STATUS_PROJECTION_STALE).
 * Usa diretórios-fixture temporários; não toca nos artefatos reais do repo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkProjectionConsistency } = require('../../scripts/governance/validate-final-status-projection');

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

  writeJson(root, 'governance/final-readiness-report.json', { finalDecision: decision });
  writeJson(root, 'governance/final-governance-report.json', { finalDecision: decision });
  writeJson(root, 'governance/rap-master-scorecard.json', { overallStatus: 'VERIFIED', summary: { totalDimensions: 78 } });
  writeJson(root, 'docs/governance/_platform-status-source.json', { finalDecision: overrides.sourceJson ?? decision });
  writeJson(root, 'dev/platform-readiness/latest.json', { finalDecision: overrides.latestJson ?? decision });
  writeText(root, 'docs/governance/ENTERPRISE_READINESS.md', `# Readiness\n- Decision: ${overrides.readinessMd ?? decision}\n`);
  writeText(root, 'docs/governance/PLATFORM_STATUS.md', `# Status\n- Readiness decision: ${overrides.statusMd ?? decision}\n`);
  writeText(root, 'docs/architecture/RAP_MASTER_SCORECARD.md', `# Scorecard\n- Overall status: **${overrides.scorecardMd ?? 'VERIFIED'}**\n`);
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

  it('estado real do repositório está consistente', () => {
    const result = checkProjectionConsistency(path.resolve(__dirname, '..', '..'));
    expect(result.issues).toEqual([]);
    expect(result.status).toBe('PASS');
  });
});
