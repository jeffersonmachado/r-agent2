'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'governance', 'generate-critical-journey-evidence.js');

describe('generate-critical-journey-evidence — reader fail-closed', () => {
  test('trace runtime ausente produz MISSING e exit 1', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'critical-reader-'));
    fs.mkdirSync(path.join(root, 'governance'), { recursive: true });
    fs.writeFileSync(path.join(root, 'governance', '.current-run.json'), JSON.stringify({
      runId: 'run-1',
      sourceFingerprint: 'a'.repeat(64),
    }));

    const result = spawnSync(process.execPath, [SCRIPT, '--root', root], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const report = JSON.parse(fs.readFileSync(
      path.join(root, 'governance', 'critical-journey-evidence.json'),
      'utf8',
    ));

    expect(result.status).toBe(1);
    expect(report).toMatchObject({
      pass: false,
      decision: 'CRITICAL_CAUSAL_EVIDENCE_MISSING',
      causalChain: [],
    });
  });

  test('validator não lê nem agrega relatórios legados incompatíveis', () => {
    const source = fs.readFileSync(SCRIPT, 'utf8');

    expect(source).not.toContain('human-handoff-full-validation.json');
    expect(source).not.toContain('omnichannel-crm-mutations.json');
    expect(source).not.toContain('qa-waves-operational-prod-like-smoke.json');
    expect(source).not.toMatch(/correlationId\s*=\s*replayId/);
    expect(source).not.toMatch(/replay\.status\s*===\s*['"]GO['"]/);
    expect(source).toContain('qa/runtime/critical-causal-journey-trace.json');
  });

  test('validator não cria IDs de evento/correlação', () => {
    const source = fs.readFileSync(SCRIPT, 'utf8');

    expect(source).not.toMatch(/randomUUID|randomBytes|Date\.now\(\).*event|function\s+uid/);
    expect(source).not.toContain('crypto');
    expect(source).toContain('validatorGeneratedEventIds: false');
  });
});
