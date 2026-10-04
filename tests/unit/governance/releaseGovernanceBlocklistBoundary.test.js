'use strict';

/**
 * Fronteira da blocklist de governança de release.
 *
 * Defeito fechado (medido 2026-10-04): `check_banned_timestamps` casava o
 * timestamp banido como SUBSTRING CRUA. O run governado corrente
 * `rap-governed-20261004112450088-07de12e3` contém `124500` dentro de
 * `112450088`, então o envelope LEGÍTIMO foi reprovado com 12 ocorrências de
 * "Referência antiga detectada: 124500" → `CHECK-DIST-CLEAN: FAIL` →
 * `verify-enterprise-governance-v2.sh FAIL`, bloqueando o passe `final` do
 * `release:seal` (`SEAL_EXIT=1`).
 *
 * A checagem agora exige FRONTEIRA DE DÍGITO. Este teste extrai a função REAL
 * do script (não duplica a lógica) e prova os dois lados: referência legítima ao
 * run corrente NÃO casa; referência a pacote ANTERIOR continua casando.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'verify-enterprise-governance-v2.sh');

function extractBannedTimestampPattern() {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const match = source.match(/banned_timestamp_pattern\(\) \{[\s\S]*?\n\}/);
  if (!match) {
    throw new Error('banned_timestamp_pattern() nao encontrada no verificador');
  }
  return match[0];
}

function runProbe(legitLine, oldLine) {
  const script = [
    'set -u',
    extractBannedTimestampPattern(),
    'PAT="$(banned_timestamp_pattern 124500)"',
    `LEGIT=${JSON.stringify(legitLine)}`,
    `OLD=${JSON.stringify(oldLine)}`,
    'printf \'%s\' "$LEGIT" > /tmp/blocklist-legit.json',
    'printf \'%s\' "$OLD" > /tmp/blocklist-old.json',
    'if grep -qE "$PAT" /tmp/blocklist-legit.json; then echo LEGIT_MATCH; else echo LEGIT_OK; fi',
    'if grep -qE "$PAT" /tmp/blocklist-old.json; then echo OLD_MATCH; else echo OLD_MISS; fi',
    'echo "PATTERN=$PAT"',
  ].join('\n');

  const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
  return {
    legitOk: out.includes('LEGIT_OK'),
    oldMatched: out.includes('OLD_MATCH'),
    pattern: (out.match(/PATTERN=(.*)/) || [])[1] || '',
  };
}

describe('blocklist de release — fronteira de dígito em timestamp banido', () => {
  test('run id legítimo que CONTÉM o timestamp banido NÃO é reprovado', () => {
    const result = runProbe(
      '{"runId":"rap-governed-20261004112450088-07de12e3"}',
      '{"ref":"r-agent2-20261003-124500.manifest.json"}',
    );

    // `112450088` embute `124500`: não é referência a outro artefato.
    expect(result.legitOk).toBe(true);
  });

  test('referência a pacote ANTERIOR continua sendo detectada (gate não afrouxou)', () => {
    const result = runProbe(
      '{"runId":"rap-governed-20261004112450088-07de12e3"}',
      '{"ref":"r-agent2-20261003-124500.manifest.json"}',
    );

    expect(result.oldMatched).toBe(true);
  });

  test('o padrão exige fronteira de dígito (não volta a ser substring crua)', () => {
    const { pattern } = runProbe(
      '{"runId":"rap-governed-20261004112450088-07de12e3"}',
      '{"ref":"r-agent2-20261003-124500.manifest.json"}',
    );

    expect(pattern).toContain('124500');
    expect(pattern).toContain('[^0-9]');
  });

  test('timestamp banido delimitado também casa em nome de arquivo e assinatura', () => {
    const result = runProbe(
      '{"runId":"rap-governed-20261004112450088-07de12e3"}',
      '{"signed":"/opt/dist/release/r-agent2-20261004-124500.payload.zip"}',
    );

    expect(result.legitOk).toBe(true);
    expect(result.oldMatched).toBe(true);
  });
});
