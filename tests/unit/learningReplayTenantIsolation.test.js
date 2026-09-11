'use strict';

/**
 * Isolamento de tenant no armazenamento de replay do Learning Core.
 *
 * GAP CONFIRMADO (auditoria 2026-09-11): `journeyTrainerService.listReplays()`
 * varria o diretório global de replays `runtime/rpa/replay` sem nenhum filtro
 * de tenant, e `loadReplay(replayId)` carregava qualquer arquivo pelo id —
 * um ator autorizado no tenant A enumerava e consumia replays do tenant B.
 *
 * Regra: listagem/leitura de replay é SEMPRE escopada por tenant.
 *   - replay com `tenantId` diferente → não listado e não carregável
 *   - replay legado sem `tenantId` → fail-closed (não listado)
 *   - ausência de tenantId no pedido → fail-closed (lista vazia)
 */

const { configureRuntimeRoot } = require('../../api/utils/runtimePaths');

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../api/services/ragService', () => ({
  indexDocument: jest.fn(async (doc) => ({ id: doc.id })),
  deindexDocument: jest.fn(async () => ({ success: true })),
}));

jest.mock('../../api/db/models/LearningMission', () => () => ({
  findOrCreate: jest.fn(async () => [{ id: 'mission-1' }, true]),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

function replayPayload({ id, tenantId, actions = 2 }) {
  const payload = {
    id,
    context: 'rpa',
    startTime: '2026-07-23T10:00:00.000Z',
    screens: [{ screenId: 's1' }],
    actions: Array.from({ length: actions }, (_v, index) => ({
      type: 'click', step: `step-${index}`, success: true,
    })),
    errors: [],
  };
  if (tenantId) payload.tenantId = tenantId;
  return payload;
}

let runtimeRoot;

beforeAll(() => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-replay-isolation-'));
  configureRuntimeRoot(runtimeRoot);

  const baseDir = path.join(runtimeRoot, 'rpa', 'replay');
  fs.mkdirSync(path.join(baseDir, 'tenant-c'), { recursive: true });

  // Layout legado: todos os replays no diretório base. O ÚNICO discriminador
  // aqui é o `tenantId` do payload — exatamente o que a listagem ignorava.
  fs.writeFileSync(
    path.join(baseDir, 'replay-a.json'),
    JSON.stringify(replayPayload({ id: 'replay-a', tenantId: 'tenant-a' })),
  );
  fs.writeFileSync(
    path.join(baseDir, 'replay-b.json'),
    JSON.stringify(replayPayload({ id: 'replay-b', tenantId: 'tenant-b' })),
  );
  // Legado: replay gravado antes do escopo por tenant, sem `tenantId` no payload.
  fs.writeFileSync(
    path.join(baseDir, 'legacy-replay.json'),
    JSON.stringify(replayPayload({ id: 'legacy-replay' })),
  );
  // Layout novo: subdiretório por tenant.
  fs.writeFileSync(
    path.join(baseDir, 'tenant-c', 'replay-c.json'),
    JSON.stringify(replayPayload({ id: 'replay-c', tenantId: 'tenant-c' })),
  );
});

afterAll(() => {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  configureRuntimeRoot(null);
});

const {
  listReplays,
  generateTrainingFromReplay,
} = require('../../api/modules/learning-core/journeyTrainerService');
const manualService = require('../../api/modules/learning-core/manualService');

describe('learning-core — isolamento de tenant nos replays', () => {
  test('lista somente replays do tenant pedido', () => {
    const replays = listReplays({ tenantId: 'tenant-a' });
    expect(replays.map((r) => r.id)).toEqual(['replay-a']);
  });

  test('não enumera replay de outro tenant', () => {
    const replays = listReplays({ tenantId: 'tenant-a' });
    expect(replays.some((r) => r.id === 'replay-b')).toBe(false);
  });

  test('lista replay de subdiretório do próprio tenant', () => {
    const replays = listReplays({ tenantId: 'tenant-c' });
    expect(replays.map((r) => r.id)).toEqual(['replay-c']);
  });

  test('fail-closed: sem tenantId não lista nada', () => {
    expect(listReplays()).toEqual([]);
    expect(listReplays({})).toEqual([]);
  });

  test('não lista replay legado sem tenant declarado', () => {
    const replays = listReplays({ tenantId: 'tenant-a' });
    expect(replays.some((r) => r.id === 'legacy-replay')).toBe(false);
  });

  test('gera treinamento apenas do replay do próprio tenant', async () => {
    await expect(generateTrainingFromReplay({
      tenantId: 'tenant-b',
      replayId: 'replay-a',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('manual: recusa replay de outro tenant', async () => {
    await expect(manualService.generateManualFromReplay({
      tenantId: 'tenant-b',
      replayId: 'replay-a',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('manual: recusa replay legado sem tenant declarado', async () => {
    await expect(manualService.generateManualFromReplay({
      tenantId: 'tenant-b',
      replayId: 'legacy-replay',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
