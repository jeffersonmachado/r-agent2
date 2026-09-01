'use strict';

/**
 * Regressão do scanner de tokens proibidos do verifier de release
 * (scripts/verify-enterprise-governance-v2.sh :: contains_forbidden_tokens).
 *
 * Bug real (release r-agent2-20260901-090004): o relatório de
 * experience-segregation contém a chave de termo "go_no_go"; o grep
 * uppercased por substring casava NO_GO dentro de GO_NO_GO e bloqueava
 * um artefato legítimo PASS. O scanner passou a exigir fronteiras
 * não-identifier para NO_GO/PENDING.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const VERIFIER = path.join(ROOT, 'scripts', 'verify-enterprise-governance-v2.sh');

function extractScanner() {
  const source = fs.readFileSync(VERIFIER, 'utf8');
  const match = source.match(/contains_forbidden_tokens\(\) \{[\s\S]*?\n\}/);
  if (!match) throw new Error('contains_forbidden_tokens não encontrada no verifier');
  return match[0];
}

function scan(content) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-tokens-')), 'sample.json');
  fs.writeFileSync(tmp, content);
  const script = `${extractScanner()}\ncontains_forbidden_tokens "$1"\n`;
  try {
    execFileSync('bash', ['-c', script, 'bash', tmp], { stdio: 'pipe' });
    return true; // exit 0 → token proibido encontrado
  } catch {
    return false; // exit != 0 → limpo
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

describe('verify-enterprise-governance-v2 contains_forbidden_tokens', () => {
  test.each([
    ['decisão NO_GO real', '{"decision":"NO_GO"}', true],
    ['NO_GO com sufixo de reason', '{"status":"NO_GO:AUTONOMOUS_READY_GO"}', true],
    ['placeholder true', '{"placeholder":true}', true],
    ['transitional true', '{"transitional":true}', true],
    ['status PENDING', '{"status":"PENDING"}', true],
    ['NO_GO minúsculo', '{"decision":"no_go"}', true],
  ])('bloqueia: %s', (_label, content, expected) => {
    expect(scan(content)).toBe(expected);
  });

  test.each([
    ['chave de termo go_no_go', '{"forbiddenTerms":["go_no_go","replay"]}', false],
    ['estado deferido DELIVERED_PENDING_SCORECARD', '{"finalDecision":"DELIVERED_PENDING_SCORECARD"}', false],
    ['contador pendingCount', '{"pendingCount":3}', false],
    ['GO limpo', '{"decision":"AUTONOMOUS_READY_GO"}', false],
    ['PASS_WITH_DEFERRED_PACKAGE_GATE', '{"decision":"PASS_WITH_DEFERRED_PACKAGE_GATE"}', false],
  ])('não bloqueia (falso positivo): %s', (_label, content, expected) => {
    expect(scan(content)).toBe(expected);
  });
});
