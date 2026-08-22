'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');

function source(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('Certification path integrity', () => {
  test('two-pass release não materializa resultados de verificação hardcoded', () => {
    const script = source('scripts/two-pass-release.sh');
    const forbidden = [
      /"verifierPassed"\s*:\s*true/,
      /"selfProofStatus"\s*:\s*"PASS"/,
      /"envelopeValidated"\s*:\s*true/,
      /"payloadValidated"\s*:\s*true/,
      /"packageValidationOk"\s*:\s*true/,
      /"packageIntegrityPass"\s*:\s*true/,
      /"finalDecision"\s*:\s*"GO"/,
    ];

    for (const pattern of forbidden) {
      expect(script).not.toMatch(pattern);
    }
  });

  test('empacotamento exclui apenas reports/ gerado da raiz, não scripts/reports source', () => {
    const script = source('scripts/generate-zip.sh');
    expect(script).toContain("'/reports/'");
    expect(script).not.toMatch(/^\s*'reports\/'\s*$/m);
    expect(script).not.toContain("'(^|/)reports/'");
  });
});
