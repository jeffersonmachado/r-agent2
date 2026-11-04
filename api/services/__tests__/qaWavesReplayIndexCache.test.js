'use strict';

/**
 * Regressão do índice de artefatos de replay de QA Waves.
 *
 * Defeito medido em produção: `buildReplayArtifactsIndex` recebia sempre um conjunto de
 * `executionId`s (portanto o cache nunca era usado) e, dentro de `extractReplayArtifactMeta`,
 * o cache por arquivo era limpo a CADA inserção (`replayArtifactMetaCache.clear()`), retendo
 * apenas a última entrada. Resultado: toda requisição varria o diretório inteiro e fazia
 * `JSON.parse` integral de cada arquivo sem `executionId` — 553 de 828 arquivos, 3.49 GB de
 * parse por chamada (53-85 s medidos em `GET /api/qa-waves/executions`).
 *
 * O que este arquivo prova:
 *  1. arquivo sem `executionId` NUNCA é lido por inteiro (nem parseado);
 *  2. a segunda chamada não varre o diretório de novo (cache real, não clear-on-write);
 *  3. o índice em cache é POR TENANT (não vaza replay de outro tenant).
 */

const { configureRuntimeRoot } = require('../../utils/runtimePaths');

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../qaMeshService', () => ({
  getAllExecutions: jest.fn(),
  getMeshHistory: jest.fn(),
}));

describe('qaWavesExecutionService — índice de replays (cache e custo de I/O)', () => {
  let runtimeRoot;
  let replayDir;
  let qaMeshService;
  let qaWavesExecutionService;

  const EXEC_ID = 'exec-real-1';
  const gordo = 'x'.repeat(256 * 1024);

  function escreverArtefato(nome, payload) {
    fs.writeFileSync(path.join(replayDir, nome), JSON.stringify(payload), 'utf8');
  }

  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-waves-replay-'));
    configureRuntimeRoot(runtimeRoot);
    replayDir = path.join(runtimeRoot, 'rpa', 'replay');
    fs.mkdirSync(replayDir, { recursive: true });

    // Artefato real de QA Waves (executionId no topo, como o produtor escreve).
    escreverArtefato('qa_wave_replay_1.json', {
      id: 'qa_wave_replay_1',
      replayId: 'replay-1',
      type: 'qa_wave_rpa_replay',
      executionId: EXEC_ID,
      tenantId: 'system',
      status: 'finished',
      journeyId: 'leads',
      steps: [],
    });

    // Gravações RPA: NÃO têm executionId. Antes do fix eram integralmente parseadas.
    for (let i = 0; i < 5; i += 1) {
      escreverArtefato(`login-flow-${i}.json`, {
        id: `login-flow-${i}`,
        recordingId: `login-flow-${i}`,
        context: 'rpa',
        steps: [gordo],
      });
    }

    jest.isolateModules(() => {
      qaMeshService = require('../qaMeshService');
      qaWavesExecutionService = require('../qaWavesExecutionService');
    });

    qaMeshService.getAllExecutions.mockReturnValue([
      { executionId: EXEC_ID, tenantId: 'system', createdAt: '2026-07-30T20:00:00.000Z', payload: { executionOrigin: 'qa_waves_real' } },
    ]);
    qaMeshService.getMeshHistory.mockReturnValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    configureRuntimeRoot(null);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });

  test('arquivo sem executionId não é lido por inteiro nem parseado', () => {
    const readFileSync = jest.spyOn(fs, 'readFileSync');

    const result = qaWavesExecutionService.listWaveExecutions(20, 'system');

    expect(result).toHaveLength(1);
    expect(result[0].executionId).toBe(EXEC_ID);
    expect(result[0].replayArtifacts).toEqual([
      expect.objectContaining({ replayId: 'replay-1', journeyId: 'leads', status: 'finished' }),
    ]);

    const leiturasIntegrais = readFileSync.mock.calls
      .map(([alvo]) => String(alvo))
      .filter((alvo) => /login-flow-\d+\.json$/.test(alvo));
    expect(leiturasIntegrais).toEqual([]);
  });

  test('a segunda chamada não varre o diretório novamente (cache efetivo)', () => {
    qaWavesExecutionService.listWaveExecutions(20, 'system');

    const readdirSync = jest.spyOn(fs, 'readdirSync');
    const result = qaWavesExecutionService.listWaveExecutions(20, 'system');

    expect(result.map((item) => item.executionId)).toEqual([EXEC_ID]);
    const varredurasDoReplay = readdirSync.mock.calls
      .map(([alvo]) => String(alvo))
      .filter((alvo) => alvo === replayDir);
    expect(varredurasDoReplay).toEqual([]);
  });

  test('o índice em cache não vaza artefato de outro tenant', () => {
    // Popula o cache com o tenant `tenant-a` (replay com tenantId próprio).
    escreverArtefato('qa_wave_replay_a.json', {
      id: 'qa_wave_replay_a',
      replayId: 'replay-a',
      executionId: 'exec-a',
      tenantId: 'tenant-a',
      status: 'finished',
    });
    qaMeshService.getAllExecutions.mockReturnValue([
      { executionId: 'exec-a', tenantId: 'tenant-a', createdAt: '2026-07-30T20:00:00.000Z', payload: { executionOrigin: 'qa_waves_real', tenantId: 'tenant-a' } },
    ]);
    expect(qaWavesExecutionService.listWaveExecutions(20, 'tenant-a')).toHaveLength(1);

    // tenant-b consulta as MESMAS execuções: nada de replay do tenant-a pode aparecer.
    qaMeshService.getAllExecutions.mockReturnValue([
      { executionId: 'exec-a', tenantId: 'tenant-b', createdAt: '2026-07-30T20:00:00.000Z', payload: { executionOrigin: 'qa_waves_real', tenantId: 'tenant-b' } },
    ]);
    const resultado = qaWavesExecutionService.listWaveExecutions(20, 'tenant-b');

    expect(resultado).toHaveLength(1);
    expect(resultado[0].replayArtifacts).toEqual([]);
  });
});
