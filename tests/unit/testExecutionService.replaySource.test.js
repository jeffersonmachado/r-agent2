'use strict';

const { configureRuntimeRoot } = require('../../api/utils/runtimePaths');

/**
 * Regressão — filtro `source` na listagem de replays QA Waves.
 *
 * Falha observada (2026-07-31, rodada E2E Playwright):
 * a página /dev/rpa-replays?source=qa-waves (link gerado pela QaWavesPage e
 * usado pelo E2E qa-waves-replay.spec.ts) listava ZERO replays mesmo com
 * execuções QA Waves concluídas, porque o artefato de replay gravava
 * `source: scenario.source` (origem do catálogo de cenários, ex.: 'seed' ou
 * ausente) em vez da origem de produto do replay ('qa-waves').
 *
 * Comportamento correto esperado:
 * 1. Artefatos novos são gravados com source='qa-waves' (write path).
 * 2. Artefatos legados sem campo source, mas com type='qa_wave_rpa_replay',
 *    casam com o filtro source=qa-waves (read path / derivação).
 * 3. Replays de outras origens continuam fora do filtro.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../api/services/qaWavesScenarioService', () => ({
  runScenarioExecution: jest.fn(),
}));
jest.mock('../../api/services/qaWavesService', () => ({
  getExecutionStatus: jest.fn(),
}));
jest.mock('../../api/services/qaMeshService', () => ({
  getQueuedExecutionStatus: jest.fn(),
}));
jest.mock('../../api/services/rpaService', () => ({
  executeRecording: jest.fn(),
  getExecutionStatus: jest.fn(),
  cancelExecution: jest.fn(),
  listRecordings: jest.fn(),
  startManualRecording: jest.fn(),
  stopManualRecording: jest.fn(),
  getRecordingStatus: jest.fn(),
}));

describe('testExecutionService.listReplayFiles — filtro source de replays QA Waves', () => {
  let runtimeRoot;
  let replayDir;
  let listReplayFiles;

  beforeEach(() => {
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-source-'));
    replayDir = path.join(runtimeRoot, 'rpa', 'replay');
    fs.mkdirSync(replayDir, { recursive: true });
    configureRuntimeRoot(runtimeRoot);
    jest.resetModules();
    ({ listReplayFiles } = require('../../api/services/testExecutionService'));
  });

  afterEach(() => {
    configureRuntimeRoot(null);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });

  function writeReplay(name, payload) {
    fs.writeFileSync(path.join(replayDir, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  test('artefato legado qa_wave_rpa_replay sem campo source casa com filtro source=qa-waves', () => {
    writeReplay('qa_wave_replay_legacy_abc.json', {
      id: 'qa_wave_replay_legacy_abc',
      replayId: 'qa_wave_replay_legacy_abc',
      type: 'qa_wave_rpa_replay',
      executionId: 'meshq-legacy-1',
      status: 'success',
      // campo `source` propositalmente ausente: artefatos gravados antes da
      // correção não o incluíam (writeReplayArtifact usava scenario.source).
    });

    const result = listReplayFiles({ source: 'qa-waves' });
    const ids = result.files.map((file) => file.replayId);
    expect(ids).toContain('qa_wave_replay_legacy_abc');
  });

  test('artefato com source=qa-waves explícito casa; replay de outra origem não casa', () => {
    writeReplay('qa_wave_replay_new_def.json', {
      replayId: 'qa_wave_replay_new_def',
      type: 'qa_wave_rpa_replay',
      source: 'qa-waves',
      status: 'success',
    });
    writeReplay('manual_recording_replay.json', {
      replayId: 'manual_recording_replay',
      status: 'success',
    });

    const result = listReplayFiles({ source: 'qa-waves' });
    const ids = result.files.map((file) => file.replayId);
    expect(ids).toContain('qa_wave_replay_new_def');
    expect(ids).not.toContain('manual_recording_replay');
  });

  test('artefato com source de catálogo de cenário (ex.: seed) não casa com source=qa-waves', () => {
    // Garante que a origem de catálogo (scenario.source: 'seed', 'manual',
    // 'ai_inferred') nunca é confundida com a origem de produto do replay.
    writeReplay('qa_wave_replay_catalog_ghi.json', {
      replayId: 'qa_wave_replay_catalog_ghi',
      type: 'qa_wave_rpa_replay',
      source: 'seed',
      status: 'success',
    });

    const result = listReplayFiles({ source: 'qa-waves' });
    const ids = result.files.map((file) => file.replayId);
    expect(ids).not.toContain('qa_wave_replay_catalog_ghi');
  });
});

describe('qaWavesExecutionService.writeReplayArtifact — origem de produto no artefato', () => {
  let runtimeRoot;
  let writeReplayArtifact;

  beforeEach(() => {
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-write-'));
    configureRuntimeRoot(runtimeRoot);
    // O mesh registry real (qa-mesh/meshRegistry.json) é artefato de runtime
    // gitignored — ausente em clones limpos (CI). O teste provê um registry
    // fixture autocontido via QA_MESH_REGISTRY_PATH.
    const registryPath = path.join(runtimeRoot, 'meshRegistry.json');
    fs.writeFileSync(
      registryPath,
      `${JSON.stringify([{ id: 'support-inbox-nota-ui', adapter: 'rpa' }], null, 2)}\n`,
      'utf8',
    );
    process.env.QA_MESH_REGISTRY_PATH = registryPath;
    jest.resetModules();
    ({ writeReplayArtifact } = require('../../api/services/qaWavesExecutionService'));
  });

  afterEach(() => {
    configureRuntimeRoot(null);
    delete process.env.QA_MESH_REGISTRY_PATH;
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });

  test('artefato gravado carrega source=qa-waves e preserva origem do cenário em tags.source', () => {
    const { path: artifactPath, payload } = writeReplayArtifact({
      executionId: 'meshq-write-1',
      replayId: 'qa_wave_replay_write_1',
      scenario: {
        id: 'support-inbox-nota-ui',
        waveId: 'wave-support-inbox-nota',
        journeyId: 'support_ticket_flow',
        source: 'seed',
        journeySteps: [],
        semanticSteps: [],
      },
      seed: null,
      platformScenarioIds: ['support-inbox-nota-ui'],
    });

    expect(payload.source).toBe('qa-waves');
    expect(payload.tags.source).toBe('seed');

    const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    expect(persisted.source).toBe('qa-waves');
  });
});
