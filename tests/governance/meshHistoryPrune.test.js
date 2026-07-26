'use strict';

/**
 * Regressão: prune do histórico do QA Mesh não pode destruir evidência
 * canônica de cobertura.
 *
 * Falha observada (2026-07-26): o scheduler executa runs "critical"
 * (10 cenários) a cada ~15-30 min; pruneOldHistory mantinha apenas os 5
 * arquivos mais recentes, sem distinguir execuções canônicas. O arquivo da
 * última execução canônica (51 cenários) foi podado e o coverage gate
 * bloqueante oscilou GO → NO_GO sem nenhuma mudança de código
 * (technicalCoverage 74.1 → 72).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { pruneOldHistory } = require('../../qa-mesh/meshRunner');

function writeHistoryFile(dir, name, { canonical = false } = {}) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify({
    executionId: name.replace(/\.json$/, ''),
    isCanonicalExecution: canonical,
    results: [],
  }));
}

describe('meshRunner.pruneOldHistory', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-history-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('preserva execuções canônicas mesmo fora da janela de retenção', () => {
    // 6 runs não-canônicos recentes (scheduler) + 1 run canônico mais antigo
    for (let i = 0; i < 6; i += 1) {
      writeHistoryFile(dir, `mesh-2026-07-26T1${i}-00-00-000Z.json`, { canonical: false });
    }
    writeHistoryFile(dir, 'mesh-2026-07-25T21-51-45-664Z.json', { canonical: true });

    pruneOldHistory({ historyDir: dir, maxFiles: 5 });

    const remaining = fs.readdirSync(dir).sort();
    // não-canônicos: apenas os 5 mais recentes
    expect(remaining.filter((f) => !f.includes('T21-51'))).toHaveLength(5);
    // canônico preservado: é a evidência de cobertura da release
    expect(remaining).toContain('mesh-2026-07-25T21-51-45-664Z.json');
  });

  test('poda canônicos excedentes além da janela (retenção também limitada)', () => {
    for (let i = 0; i < 7; i += 1) {
      writeHistoryFile(dir, `mesh-2026-07-2${i}T10-00-00-000Z.json`, { canonical: true });
    }

    pruneOldHistory({ historyDir: dir, maxFiles: 5 });

    const remaining = fs.readdirSync(dir).sort();
    expect(remaining).toHaveLength(5);
    // mantém os MAIS recentes
    expect(remaining).toContain('mesh-2026-07-26T10-00-00-000Z.json');
    expect(remaining).not.toContain('mesh-2026-07-20T10-00-00-000Z.json');
  });

  test('arquivo ilegível é tratado como não-canônico (poda normal)', () => {
    for (let i = 0; i < 6; i += 1) {
      writeHistoryFile(dir, `mesh-2026-07-26T1${i}-00-00-000Z.json`, { canonical: false });
    }
    fs.writeFileSync(path.join(dir, 'mesh-2026-07-25T09-00-00-000Z.json'), 'not-json{');

    expect(() => pruneOldHistory({ historyDir: dir, maxFiles: 5 })).not.toThrow();
    expect(fs.existsSync(path.join(dir, 'mesh-2026-07-25T09-00-00-000Z.json'))).toBe(false);
  });

  test('não remove nada dentro da janela', () => {
    writeHistoryFile(dir, 'mesh-2026-07-26T10-00-00-000Z.json', { canonical: true });
    writeHistoryFile(dir, 'mesh-2026-07-26T11-00-00-000Z.json', { canonical: false });

    pruneOldHistory({ historyDir: dir, maxFiles: 5 });

    expect(fs.readdirSync(dir)).toHaveLength(2);
  });
});
