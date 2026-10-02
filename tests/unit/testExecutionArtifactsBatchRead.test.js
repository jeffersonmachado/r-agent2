'use strict';

/**
 * Regressão do defeito de N+1 em `listExecutionArtifacts`.
 *
 * Medição que originou este teste (2026-10-02, corpus real de 1.225 manifestos):
 *   ANTES: 12.686 ms  — 2 SELECTs por manifesto (~2.450 idas ao banco)
 *   DEPOIS:    858 ms — 1 query em lote (14,8x)
 *
 * O endpoint alimenta o painel de artefatos de `/rpa-replays`, que o carrega no
 * mount. Sob a carga do QA Mesh, o custo antigo segurava conexões do pool por
 * ~12 s e derrubava requisições de OUTRAS telas (ex.: "Erro ao carregar
 * tickets"), o que produzia falha rotativa de cenário não-bloqueante no mesh.
 *
 * O teste é ESTRUTURAL: conta as leituras no store. Se alguém reintroduzir o
 * laço por manifesto, `verify`/`readJson` voltam a ser chamados e o teste falha.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Contadores acessíveis ao factory do mock (prefixo `mock` é obrigatório para
// o hoisting do Jest permitir a referência).
const mockReadCounters = { list: 0, listWithContent: 0, verify: 0, readJson: 0, readBuffer: 0 };

jest.mock('../../lib/artifactStore', () => {
  const actual = jest.requireActual('../../lib/artifactStore');
  const counted = (store, name) => {
    if (typeof store[name] !== 'function') return undefined;
    return (...args) => {
      mockReadCounters[name] = (mockReadCounters[name] || 0) + 1;
      return store[name](...args);
    };
  };
  return {
    ...actual,
    createArtifactStore: (options = {}) => {
      const store = actual.createArtifactStore(options);
      return Object.freeze({
        ...store,
        list: counted(store, 'list'),
        listWithContent: counted(store, 'listWithContent'),
        verify: counted(store, 'verify'),
        readJson: counted(store, 'readJson'),
        readBuffer: counted(store, 'readBuffer'),
      });
    },
  };
});

const { configureRuntimeRoot } = require('../../api/utils/runtimePaths');
const {
  persistExecutionArtifacts,
  resetStoreForTests,
  listExecutionManifests,
  getExecutionManifest,
} = require('../../api/services/rpaArtifactPersistence');
const { listExecutionArtifacts } = require('../../api/services/testExecutionService');

const MANIFEST_COUNT = 12;

describe('listExecutionArtifacts — leitura em lote (sem N+1)', () => {
  let tmpRoot;
  let previousNodeEnv;

  beforeEach(async () => {
    previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-artifacts-batch-'));
    configureRuntimeRoot(tmpRoot);
    process.env.ARTIFACT_STORE_BACKEND = 'filesystem';
    resetStoreForTests();

    for (let i = 0; i < MANIFEST_COUNT; i += 1) {
      await persistExecutionArtifacts({
        recording: { id: `rec-batch-${i}`, name: `Rec ${i}`, steps: [{ type: 'navigate', url: '/x' }] },
        recordingId: `rec-batch-${i}`,
        executionId: `rpa-batch-${String(i).padStart(4, '0')}`,
        results: { success: true, steps: [], errors: [], screenshots: [] },
        tenantKey: 'system',
        status: 'completed',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
    }
  });

  afterEach(() => {
    process.env.NODE_ENV = previousNodeEnv;
    delete process.env.ARTIFACT_STORE_BACKEND;
    configureRuntimeRoot(null);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('faz UMA leitura em lote e nenhuma leitura por manifesto', async () => {
    for (const key of Object.keys(mockReadCounters)) mockReadCounters[key] = 0;

    const items = await listExecutionArtifacts('system');

    expect(items).toHaveLength(MANIFEST_COUNT);
    // O caminho em lote é usado uma única vez...
    expect(mockReadCounters.listWithContent).toBe(1);
    // ...e o laço por manifesto (verify + readJson) NÃO é exercido.
    expect(mockReadCounters.verify).toBe(0);
    expect(mockReadCounters.readJson).toBe(0);
    expect(mockReadCounters.readBuffer).toBe(0);
    // `list` (metadados) também não é mais necessário para a listagem.
    expect(mockReadCounters.list).toBe(0);
  });

  it('preserva o formato dos itens devolvidos à UI', async () => {
    const items = await listExecutionArtifacts('system');
    const sample = items[0];

    expect(Object.keys(sample).sort()).toEqual([
      'executionId',
      'finishedAt',
      'hasRecording',
      'hasReplay',
      'hasTrace',
      'persistedAt',
      'recordingId',
      'screenshots',
      'startedAt',
      'status',
    ]);
    expect(sample.executionId).toMatch(/^rpa-batch-/);
    expect(typeof sample.hasRecording).toBe('boolean');
    expect(typeof sample.hasTrace).toBe('boolean');
    expect(typeof sample.hasReplay).toBe('boolean');
    expect(typeof sample.screenshots).toBe('number');
  });

  it('preserva a ordenação canônica (mais recentes primeiro) do caminho individual', async () => {
    // Ordem esperada derivada do caminho INDIVIDUAL (listExecutionManifests +
    // getExecutionManifest), que é o comportamento de referência. O lote precisa
    // reproduzi-la exatamente.
    const manifests = await listExecutionManifests('system');
    const expected = [];
    for (const meta of manifests) {
      const manifest = await getExecutionManifest(meta.refId, 'system');
      if (!manifest) continue;
      expected.push(manifest.executionId || meta.refId);
    }
    expect(expected.length).toBe(MANIFEST_COUNT);

    const items = await listExecutionArtifacts('system');
    expect(items.map((item) => item.executionId)).toEqual(expected);
  });
});
