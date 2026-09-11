'use strict';

const { configureRuntimeRoot } = require('../../api/utils/runtimePaths');

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
  tenantId: 'system',
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

// Formato de replay gerado por QA Waves: sem `actions`, com `uiTrace`
// (inclui screenshots base64 que devem ser descartados antes da anonimização).
const REPLAY_WAVE_UITRACE = {
  id: 'wave-replay-1',
  tenantId: 'system',
  replayId: 'wave-replay-1',
  startTime: '2026-07-24T03:29:54.037Z',
  endTime: '2026-07-24T03:32:01.215Z',
  uiTrace: [
    {
      id: 'step-1', index: 1, name: 'Abrir workspace (login automático pousa aqui)',
      action: 'navigate', selector: '{{urls.frontend}}/workspace', input: null,
      success: true, durationMs: 4557, screenshotBefore: 'data:image/png;base64,iVBORw0KGgo=',
    },
    {
      id: 'step-7', index: 7, name: 'Preencher título da tarefa',
      action: 'fill', selector: '.support-details-panel input', input: 'Aula experimental QA',
      success: true, durationMs: 2119, screenshotBefore: 'data:image/png;base64,iVBORw0KGgo=',
    },
    {
      id: 'step-9', index: 9, name: 'Criar tarefa',
      action: 'click', selector: 'button:has-text("Criar tarefa")', input: null,
      success: true, durationMs: 1502,
    },
  ],
  journeySteps: [
    { id: 'step_001', name: 'Usuário abre menu Construtor → Tarefas', expected: { page: '/tasks' } },
  ],
  errors: [],
};

beforeAll(() => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-trainer-test-'));
  configureRuntimeRoot(runtimeRoot);
  const replayDir = path.join(runtimeRoot, 'rpa', 'replay');
  fs.mkdirSync(replayDir, { recursive: true });
  fs.writeFileSync(path.join(replayDir, 'jornada-teste-1.json'), JSON.stringify(REPLAY_WITH_PII));
  fs.writeFileSync(path.join(replayDir, 'wave-replay-1.json'), JSON.stringify(REPLAY_WAVE_UITRACE));
});

afterAll(() => {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  configureRuntimeRoot(null);
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
    const replays = listReplays({ tenantId: 'system' });
    expect(replays).toHaveLength(2);
    expect(replays.find((r) => r.id === 'jornada-teste-1')).toMatchObject({ actions: 4, screens: 2 });
  });

  test('sem tenantId a listagem é fail-closed (vazia)', () => {
    expect(listReplays()).toEqual([]);
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

  test('pipeline: replay de QA Waves (uiTrace) vira roteiro detalhado sem screenshots', async () => {
    const result = await generateTrainingFromReplay({
      tenantId: 'system',
      replayId: 'wave-replay-1',
      journeyKey: 'fitness.agendamento',
    });

    expect(result.steps).toBe(3);

    const [doc] = mockIndexDocument.mock.calls[0];
    // uiTrace normalizado em passos nomeados
    expect(doc.content).toContain('Preencher título da tarefa');
    // valor real do fill mascarado, com exemplo sintético no lugar
    expect(doc.content).not.toContain('Aula experimental QA');
    expect(doc.content).toContain('exemplo sintético');
    // telas derivadas do navigate + expected.page dos passos semanticos
    expect(doc.content).toContain('`/workspace`');
    expect(doc.content).toContain('`/tasks`');
    // screenshots base64 do uiTrace nao entram no roteiro
    expect(doc.content).not.toContain('base64');
  });
});
