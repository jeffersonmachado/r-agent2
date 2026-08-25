'use strict';

/**
 * dbStateStore — DB-first & certification mode (ROOT-002).
 *
 * Prova que:
 *   1. CERTIFICATION_MODE=true ativa o modo sem filesystem fallback.
 *   2. Em certificação com DB indisponível, save/load falham (PERSISTENCE_REQUIRED)
 *      em vez de usar JSON/filesystem como fonte de verdade.
 *   3. Fora de certificação, o JSON export é cache não-autoritativo (saveSyncExport
 *      permanece síncrono para utilitários de dev/CI).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

jest.mock('../../../api/db/sequelize', () => ({
  connect: jest.fn().mockRejectedValue(new Error('db_unavailable')),
  getSequelize: jest.fn().mockReturnValue(null),
  close: jest.fn().mockResolvedValue(),
}));

const dbStateStore = require('../../../qa/state/dbStateStore');

async function withEnv(key, value, fn) {
  const before = process.env[key];
  process.env[key] = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  }
}

describe('dbStateStore — DB-first & certification mode', () => {
  beforeEach(() => { dbStateStore.resetStoreForTests(); });

  test('isCertificationMode responde a CERTIFICATION_MODE=true', () => {
    withEnv('CERTIFICATION_MODE', 'true', () => {
      expect(dbStateStore.isCertificationMode()).toBe(true);
    });
    withEnv('CERTIFICATION_MODE', undefined, () => {
      expect(dbStateStore.isCertificationMode()).toBe(false);
    });
  });

  test('certification mode: DB indisponível → save rejeita PERSISTENCE_REQUIRED', async () => {
    await withEnv('CERTIFICATION_MODE', 'true', async () => {
      await expect(dbStateStore.save('qa/state/x.json', { v: 1 }))
        .rejects.toMatchObject({ code: 'PERSISTENCE_REQUIRED' });
    });
  });

  test('certification mode: load NÃO usa JSON export como fonte de verdade', async () => {
    // Escreve um export JSON "stale" no filesystem; em certificação com DB
    // indisponível, load() deve falhar (PERSISTENCE_REQUIRED), não retornar o cache.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-state-cert-'));
    const stale = path.join(tmp, 'store.json');
    fs.writeFileSync(stale, JSON.stringify({ stale: true }), 'utf8');
    await withEnv('CERTIFICATION_MODE', 'true', async () => {
      await expect(dbStateStore.load(stale, null)).rejects.toMatchObject({ code: 'PERSISTENCE_REQUIRED' });
    });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('dev mode: saveSyncExport continua síncrono (cache dev não-autoritativo)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-state-dev-'));
    const target = path.join(tmp, 'store.json');
    withEnv('CERTIFICATION_MODE', undefined, () => {
      dbStateStore.saveSyncExport(target, { version: 1 });
    });
    expect(fs.existsSync(target)).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('sanitizeRefId normaliza chaves com barra para refId válido (sem /)', () => {
    expect(dbStateStore.sanitizeRefId('qa-mesh/scheduler-state.json')).toBe('qa-mesh-scheduler-state.json');
    expect(dbStateStore.sanitizeRefId('qa/checkpoints/state/current-wave.json')).toBe('qa-checkpoints-state-current-wave.json');
    expect(dbStateStore.sanitizeRefId('')).toBe('unknown');
  });
});
