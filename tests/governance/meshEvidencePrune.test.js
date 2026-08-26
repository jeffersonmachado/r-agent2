'use strict';

/**
 * Regressão: pruneOldEvidence não pode destruir o diretório de evidência
 * (replays/evidências) de uma execução canônica do QA Mesh.
 *
 * Falha observada (2026-08-24): a retenção cega por contagem mantinha apenas
 * os 5 diretórios de evidência mais recentes, sem distinguir execuções
 * canônicas. O replay do cenário business-core-biz-whatsapp-connections
 * (criticality high) foi podado do disco, restando apenas o registro no
 * meshHistory — a evidência de funcionamento da feature desapareceu.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { pruneOldEvidence } = require('../../qa-mesh/meshRunner');

function writeEvidenceDir(dir, name, { canonical = false } = {}) {
  const full = path.join(dir, name);
  fs.mkdirSync(full, { recursive: true });
  fs.writeFileSync(path.join(full, 'summary.json'), JSON.stringify({
    executionId: name,
    isCanonicalExecution: canonical,
  }));
  fs.mkdirSync(path.join(full, 'replays'), { recursive: true });
  fs.writeFileSync(path.join(full, 'replays', 'scenario.json'), '{}');
}

describe('meshRunner.pruneOldEvidence', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-evidence-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('preserva evidência canônica mesmo fora da janela de retenção', () => {
    for (let i = 0; i < 6; i += 1) {
      writeEvidenceDir(dir, `mesh-2026-08-25T1${i}-00-00-000Z`, { canonical: false });
    }
    writeEvidenceDir(dir, 'mesh-2026-08-24T20-45-33-754Z', { canonical: true });

    pruneOldEvidence({ evidenceDir: dir, maxDirs: 5 });

    const remaining = fs.readdirSync(dir).sort();
    // não-canônicos: apenas os 5 mais recentes
    expect(remaining.filter((d) => !d.includes('T20-45'))).toHaveLength(5);
    // canônico preservado: é a evidência de cobertura da release
    expect(remaining).toContain('mesh-2026-08-24T20-45-33-754Z');
  });

  test('poda canônicos excedentes além da janela (retenção também limitada)', () => {
    for (let i = 0; i < 7; i += 1) {
      writeEvidenceDir(dir, `mesh-2026-08-2${i}T10-00-00-000Z`, { canonical: true });
    }

    pruneOldEvidence({ evidenceDir: dir, maxDirs: 5 });

    const remaining = fs.readdirSync(dir).sort();
    expect(remaining).toHaveLength(5);
    expect(remaining).toContain('mesh-2026-08-26T10-00-00-000Z');
    expect(remaining).not.toContain('mesh-2026-08-20T10-00-00-000Z');
  });

  test('diretório sem summary.json legível é tratado como não-canônico', () => {
    for (let i = 0; i < 6; i += 1) {
      writeEvidenceDir(dir, `mesh-2026-08-25T1${i}-00-00-000Z`, { canonical: false });
    }
    const broken = path.join(dir, 'mesh-2026-08-24T09-00-00-000Z');
    fs.mkdirSync(broken, { recursive: true });
    fs.writeFileSync(path.join(broken, 'summary.json'), 'not-json{');

    expect(() => pruneOldEvidence({ evidenceDir: dir, maxDirs: 5 })).not.toThrow();
    expect(fs.existsSync(broken)).toBe(false);
  });

  test('não remove nada dentro da janela', () => {
    writeEvidenceDir(dir, 'mesh-2026-08-26T10-00-00-000Z', { canonical: true });
    writeEvidenceDir(dir, 'mesh-2026-08-26T11-00-00-000Z', { canonical: false });

    pruneOldEvidence({ evidenceDir: dir, maxDirs: 5 });

    expect(fs.readdirSync(dir)).toHaveLength(2);
  });
});
