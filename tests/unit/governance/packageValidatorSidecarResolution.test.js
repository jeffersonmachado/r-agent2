'use strict';

/**
 * Resolução do sidecar de manifesto do `package-validator`.
 *
 * Defeito fechado (medido 2026-10-04): a lista de candidatos incluía o resultado
 * do `replace` MESMO quando o padrão não casava — e nesse caso o `replace`
 * devolve o PRÓPRIO caminho do ZIP. Como o ZIP existe no disco, ele era
 * escolhido como "manifest" e o validador fazia `JSON.parse` dos BYTES do ZIP:
 *
 *   [package-validator] error=artifact_manifest_invalid:
 *     /.../dist/r-agent2-20261004-105840.zip:Unexpected token 'P', "PK"
 *   → package_validation_failed (2 gaps CRÍTICOS em platform-readiness)
 *   → "candidato não selou" (SEAL_EXIT=1 no ciclo de selagem)
 *
 * Um sidecar AUSENTE tem de ser reportado como ausente — nunca virar tentativa
 * de parse do ZIP.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveArtifactForValidation } = require('../../../governance/package-validator');

const ZIP_BYTES = 'PK\u0003\u0004binario-de-zip-fake';
let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-validator-sidecar-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeZip(name, sidecar = null) {
  const zipPath = path.join(tmpDir, name);
  fs.writeFileSync(zipPath, ZIP_BYTES);
  if (sidecar) {
    const sidecarPath = path.join(tmpDir, name.replace(/\.zip$/i, '.manifest.json'));
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar));
  }
  return zipPath;
}

describe('package-validator — resolução do sidecar de manifesto', () => {
  test('ZIP SEM sidecar não derruba o validador (era o crash "Unexpected token PK")', () => {
    const zipPath = makeZip('r-agent2-20261004-105840.zip');

    const resolved = resolveArtifactForValidation({ zipPath });

    expect(resolved.manifest).toBeNull();
    // O caminho do sidecar é o `.manifest.json`, NUNCA o próprio ZIP.
    expect(resolved.manifestPath.endsWith('.manifest.json')).toBe(true);
    expect(resolved.manifestPath).not.toBe(zipPath);
  });

  test('ZIP COM sidecar continua resolvendo o manifesto', () => {
    const zipPath = makeZip('r-agent2-20261004-112406.zip', { release: 'r-agent2-20261004-112406' });

    const resolved = resolveArtifactForValidation({ zipPath });

    expect(resolved.manifest).toEqual({ release: 'r-agent2-20261004-112406' });
    expect(resolved.manifestPath.endsWith('.manifest.json')).toBe(true);
  });

  test('payload-centric: X.payload.zip resolve para X.manifest.json', () => {
    const zipPath = path.join(tmpDir, 'r-agent2-20261004-094046.payload.zip');
    fs.writeFileSync(zipPath, ZIP_BYTES);
    fs.writeFileSync(
      path.join(tmpDir, 'r-agent2-20261004-094046.manifest.json'),
      JSON.stringify({ kind: 'payload-centric' }),
    );

    const resolved = resolveArtifactForValidation({ zipPath });

    expect(resolved.manifest).toEqual({ kind: 'payload-centric' });
  });

  test('caminho que já é manifesto é usado como está (comportamento preservado)', () => {
    const manifestPath = path.join(tmpDir, 'r-agent2-20261004-000000.manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ kind: 'manifesto-direto' }));

    const resolved = resolveArtifactForValidation({ zipPath: manifestPath });

    expect(resolved.manifest).toEqual({ kind: 'manifesto-direto' });
    expect(resolved.manifestPath).toBe(manifestPath);
  });

  test('sidecar presente mas NÃO-JSON falha de forma explícita (não silencia)', () => {
    const zipPath = makeZip('r-agent2-20261004-999999.zip');
    fs.writeFileSync(path.join(tmpDir, 'r-agent2-20261004-999999.manifest.json'), ZIP_BYTES);

    expect(() => resolveArtifactForValidation({ zipPath }))
      .toThrow(/artifact_manifest_invalid/);
  });
});
