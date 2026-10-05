'use strict';

/**
 * Retomada de `--from consolidate` com estado de release perdido.
 *
 * Defeito fechado (medido 2026-10-05): a fase `final` grava
 * `$LOG_DIR/release.env` (linha 1 = RELEASE_ID) em `/tmp/seal-release`. Um reboot
 * limpa `/tmp`; ao retomar de `--from consolidate` o passo de aprovação de deploy
 * lia o arquivo em silêncio (`[ -f ... ] && var=...`), `release_name` ficava vazio
 * e o gate acusava
 * `artifact_missing:no_zip_with_audit_passed_and_go_no_go_go` — CULPANDO o
 * artefato, embora `dist/release/<release>.approval.json` estivesse presente e
 * válido (`goNoGo=GO`, `approvedForDeploy=true`). O ciclo ficou inretomável sem
 * intervenção manual.
 *
 * Este teste extrai a função REAL do orquestrador (não duplica a lógica) e prova:
 *   1. `release.env` presente é a fonte primária (linha 1);
 *   2. `release.env` ausente com UM envelope é resolvido do envelope — a retomada
 *      sobrevive ao reboot;
 *   3. zero envelopes => falha (nada para derivar);
 *   4. dois envelopes => falha (ambiguidade nunca é resolvida por adivinhação);
 *   5. o gate de aprovação continua exigindo `goNoGo=GO` E `approvedForDeploy=true`.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'seal-release.sh');

function readScript() {
  return fs.readFileSync(SCRIPT, 'utf8');
}

function extractResolver() {
  const match = readScript().match(/resolve_release_name\(\) \{[\s\S]*?\n\}/);
  if (!match) {
    throw new Error('resolve_release_name() nao encontrada em scripts/governance/seal-release.sh');
  }
  return match[0];
}

/**
 * Executa a resolução REAL em um projeto temporário: `dist/release/` com os
 * manifests informados e, opcionalmente, o `release.env` da fase `final`.
 */
function probe({ envLines, manifests }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-resolve-'));
  try {
    const logDir = path.join(dir, 'logs');
    const releaseDir = path.join(dir, 'dist', 'release');
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(releaseDir, { recursive: true });

    if (envLines) {
      fs.writeFileSync(path.join(logDir, 'release.env'), `${envLines.join('\n')}\n`);
    }
    for (const name of manifests) {
      fs.writeFileSync(path.join(releaseDir, name), '{}');
    }

    const script = [
      'set -u',
      `LOG_DIR=${JSON.stringify(logDir)}`,
      extractResolver(),
      'if NOME="$(resolve_release_name)"; then printf "OK:%s\\n" "$NOME"; else echo FAIL; fi',
    ].join('\n');

    return execFileSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8' }).trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('retomada do seal — resolução do nome do release sem estado em /tmp', () => {
  test('release.env presente é a fonte primária (linha 1)', () => {
    const out = probe({
      envLines: ['r-agent2-20261004-130942', '5add308a192abfacc75d549f482cf2fdb17e16a0', '7effd0'],
      manifests: ['r-agent2-20261003-999999.manifest.json'],
    });

    expect(out).toBe('OK:r-agent2-20261004-130942');
  });

  test('release.env ausente (reboot limpou /tmp) resolve do envelope único', () => {
    const out = probe({
      envLines: null,
      manifests: ['r-agent2-20261004-130942.manifest.json'],
    });

    // Antes do patch isto era vazio -> erro enganoso culpando o artefato.
    expect(out).toBe('OK:r-agent2-20261004-130942');
  });

  test('sem release.env e sem envelope: falha (nada para derivar)', () => {
    const out = probe({ envLines: null, manifests: [] });

    expect(out).toBe('FAIL');
  });

  test('sem release.env com dois envelopes: falha (ambiguidade não é adivinhada)', () => {
    const out = probe({
      envLines: null,
      manifests: [
        'r-agent2-20261004-130942.manifest.json',
        'r-agent2-20261003-999999.manifest.json',
      ],
    });

    expect(out).toBe('FAIL');
  });

  test('o gate de aprovação continua fail-closed (goNoGo=GO E approvedForDeploy=true)', () => {
    const source = readScript();

    expect(source).toMatch(/a\.goNoGo === 'GO' && a\.approvedForDeploy === true/);
    // O padrão que produzia a falha enganosa (leitura silenciosa -> nome vazio)
    // não pode voltar.
    expect(source).not.toMatch(/\[ -f "\$LOG_DIR\/release\.env" \] && release_name=/);
  });

  test('o passo de aprovação usa o resolvedor e falha com diagnóstico explícito', () => {
    const source = readScript();
    const step = source.slice(source.indexOf('aprovação de deploy do artefato selado'));

    expect(step).toMatch(/release_name="\$\(resolve_release_name \|\| true\)"/);
    expect(step).toMatch(/estado do release indisponível: release\.env ausente e dist\/release sem envelope único/);
  });
});
