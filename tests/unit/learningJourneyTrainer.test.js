'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockIndexDocument = jest.fn(async (doc) => ({ id: doc.id }));
const mockMissionFindOrCreate = jest.fn();

jest.mock('../../api/services/ragService', () => ({
  indexDocument: (...args) => mockIndexDocument(...args),
}));

jest.mock('../../api/db/models/LearningMission', () => () => ({
  findOrCreate: (...args) => mockMissionFindOrCreate(...args),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

let runtimeRoot;

const REPLAY_WITH_PII = {
  id: 'jornada-teste-1',
  context: 'rpa',
  startTime: '2026-07-23T10:00:00.000Z',
  endTime: '2026-07-23T10:00:30.000Z',
  screens: [{ screenId: 's1' }, { screenId: 's2' }],
  actions: [
    { type: 'navigate', value: { url: 'http://localhost:5173/login' }, step: 'abrir-login', success: true },
    { type: 'fill', selector: 'input[name="email"]', value: 'maria.silva@gmail.com', step: 'preencher-email', success: true },
    { type: 'fill', selector: 'input[type="password"]', value: 'SenhaSecreta123', step: 'preencher-senha', success: true },
    { type: 'click', selector: 'button[type="submit"]', step: 'entrar', success: true },
  ],
  errors: [],
  metadata: { usuario: 'Maria Silva' },
};

beforeAll(() => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-trainer-test-'));
  process.env.RUNTIME_ROOT = runtimeRoot;
  const replayDir = path.join(runtimeRoot, 'rpa', 'replay');
  fs.mkdirSync(replayDir, { recursive: true });
  fs.writeFileSync(path.join(replayDir, 'jornada-teste-1.json'), JSON.stringify(REPLAY_WITH_PII));
});

afterAll(() => {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  delete process.env.RUNTIME_ROOT;
});

const {
  generateTrainingFromReplay,
  listReplays,
  buildTrainingDocument,
} = require('../../api/modules/learning-core/journeyTrainerService');

describe('learning-core journeyTrainerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMissionFindOrCreate.mockResolvedValue([{ id: 'mission-1' }, true]);
  });

  test('lista replays disponiveis no runtime', () => {
    const replays = listReplays();
    expect(replays).toHaveLength(1);
    expect(replays[0]).toMatchObject({ id: 'jornada-teste-1', actions: 4, screens: 2 });
  });

  test('rejeita replayId com path traversal', async () => {
    await expect(generateTrainingFromReplay({
      tenantId: 'system',
      replayId: '../../../etc/passwd',
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  test('replay inexistente retorna NOT_FOUND', async () => {
    await expect(generateTrainingFromReplay({
      tenantId: 'system',
      replayId: 'nao-existe',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('pipeline: replay real vira treinamento com 0 PII e vai para o RAG', async () => {
    const result = await generateTrainingFromReplay({
      tenantId: 'system',
      replayId: 'jornada-teste-1',
      journeyKey: 'login_flow',
    });

    expect(result.trainingId).toBe('training:jornada-teste-1');
    expect(result.missionId).toBe('mission-1');
    expect(result.redactions).toBeGreaterThanOrEqual(3);

    // RAG recebeu documento sem nenhum PII do replay original
    expect(mockIndexDocument).toHaveBeenCalledTimes(1);
    const [doc, tenantId] = mockIndexDocument.mock.calls[0];
    expect(tenantId).toBe('system');
    expect(doc.id).toBe('training:jornada-teste-1');
    expect(doc.metadata.source).toBe('learning-core');
    expect(doc.content).not.toContain('maria.silva@gmail.com');
    expect(doc.content).not.toContain('SenhaSecreta123');
    expect(doc.content).not.toContain('Maria Silva');
    expect(doc.content).toContain('Passo a passo');
    expect(doc.content).toContain('[email]');
    expect(doc.content).toContain('[credencial]');

    // Missão criada disponível para o tenant
    expect(mockMissionFindOrCreate).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenant_id: 'system', replayId: 'jornada-teste-1' },
      defaults: expect.objectContaining({ agentId: null, status: 'available', ragDocumentId: 'training:jornada-teste-1' }),
    }));
  });

  test('buildTrainingDocument gera roteiro com resumo, passos e checklist', () => {
    const doc = buildTrainingDocument({
      replay: {
        id: 'x',
        context: 'rpa',
        startTime: '2026-07-23T10:00:00Z',
        endTime: '2026-07-23T10:01:00Z',
        screens: [{}],
        actions: [{ type: 'click', selector: 'button', step: 'ok', success: true }],
        errors: [],
      },
      stats: { redactions: 0 },
    });
    expect(doc).toContain('## Resumo');
    expect(doc).toContain('## Passo a passo');
    expect(doc).toContain('## Checklist de validação');
    expect(doc).toContain('Duração de referência: 60s');
  });
});
