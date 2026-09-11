'use strict';

/**
 * Manual operacional → índice RAG derivado (Learning Core).
 *
 * GAP CONFIRMADO (auditoria 2026-09-11): `manualService` gravava o manual em
 * disco mas NUNCA o indexava no RAG. O manual recém-gerado era invisível para
 * o Ask AI/Tutor — só o treinamento (`journeyTrainerService`) indexava. Pior:
 * não existia caminho de remoção, então a exclusão de um manual deixaria
 * conteúdo órfão consultável (ou nada, dado que nunca era indexado).
 *
 * Contrato agora exigido:
 *   - geração → manual persistido E indexado com classificação explícita
 *     (OPERATIONAL/PRODUCTION) no escopo do tenant;
 *   - exclusão → documento do RAG removido ANTES de apagar os arquivos;
 *   - falha ao remover do índice → arquivo preservado (índice é derivado e
 *     removível pelo id; apagar a fonte perderia a capacidade de reindexar);
 *   - escopo por tenant → nunca remove manual de outro tenant.
 */

const { configureRuntimeRoot } = require('../../api/utils/runtimePaths');

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const mockIndexDocument = jest.fn(async (doc) => ({ id: doc.id, chunksCreated: 3 }));
const mockDeindexDocument = jest.fn(async () => ({ success: true, chunksRemoved: 3 }));

jest.mock('../../api/services/ragService', () => ({
  indexDocument: (...args) => mockIndexDocument(...args),
  deindexDocument: (...args) => mockDeindexDocument(...args),
}));

let runtimeRoot;

const REPLAY = {
  id: 'replay-manual-rag',
  tenantId: 'academia-a',
  journeyId: 'fitness_active_customer',
  startTime: '2026-07-24T03:29:54.037Z',
  uiTrace: [
    {
      id: 'step-1', index: 1, name: 'Abrir ficha do aluno',
      action: 'navigate', selector: '{{urls.frontend}}/fitness/students/1',
      input: null, success: true, durationMs: 900,
      screenshotAfter: 'data:image/png;base64,iVBORw0KGgo=',
    },
    {
      id: 'step-2', index: 2, name: 'Registrar contato',
      action: 'click', selector: 'button:has-text("Registrar contato")',
      input: null, success: true, durationMs: 500,
    },
  ],
  errors: [],
};

beforeAll(() => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-manual-rag-'));
  configureRuntimeRoot(runtimeRoot);
  const replayDir = path.join(runtimeRoot, 'rpa', 'replay');
  fs.mkdirSync(replayDir, { recursive: true });
  fs.writeFileSync(path.join(replayDir, 'replay-manual-rag.json'), JSON.stringify(REPLAY));
});

afterAll(() => {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  configureRuntimeRoot(null);
});

const manualService = require('../../api/modules/learning-core/manualService');

describe('learning-core — manual indexado no RAG', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIndexDocument.mockResolvedValue({ id: 'manual:x', chunksCreated: 3 });
    mockDeindexDocument.mockResolvedValue({ success: true, chunksRemoved: 3 });
  });

  test('indexa o manual gerado com classificação explícita e escopo do tenant', async () => {
    const metadata = await manualService.generateManualFromReplay({
      tenantId: 'academia-a',
      replayId: 'replay-manual-rag',
      createdBy: 'agent-1',
    });

    expect(mockIndexDocument).toHaveBeenCalledTimes(1);
    const [document, tenantId] = mockIndexDocument.mock.calls[0];

    expect(tenantId).toBe('academia-a');
    expect(document.id).toBe(`manual:${metadata.id}`);
    expect(document.domain).toBe('OPERATIONAL');
    expect(document.classification).toBe('PRODUCTION');
    expect(document.sensitivity).toBe('INTERNAL');
    expect(document.metadata.contentType).toBe('manual');
    expect(document.metadata.sourceType).toBe('replay-derivation');
    expect(document.metadata.journeyKey).toBe('fitness_active_customer');
    // Conteúdo indexado é o próprio manual markdown, sem PII do replay.
    expect(document.content).toContain('Registrar contato');
    expect(metadata.ragDocumentId).toBe(`manual:${metadata.id}`);
  });

  test('exclusão remove o documento do RAG antes de apagar os arquivos', async () => {
    const metadata = await manualService.generateManualFromReplay({
      tenantId: 'academia-a',
      replayId: 'replay-manual-rag',
    });

    const result = await manualService.deleteManual({
      tenantId: 'academia-a',
      manualId: metadata.id,
    });

    expect(mockDeindexDocument).toHaveBeenCalledWith(`manual:${metadata.id}`, 'academia-a');
    expect(result).toMatchObject({ success: true, manualId: metadata.id, deindexed: true });

    const manualDir = path.join(runtimeRoot, 'learning', 'manuals', metadata.id);
    expect(fs.existsSync(manualDir)).toBe(false);
  });

  test('falha no deindex preserva o arquivo (índice é derivado, fonte não se perde)', async () => {
    const metadata = await manualService.generateManualFromReplay({
      tenantId: 'academia-a',
      replayId: 'replay-manual-rag',
    });
    mockDeindexDocument.mockRejectedValueOnce(new Error('rag offline'));

    await expect(manualService.deleteManual({
      tenantId: 'academia-a',
      manualId: metadata.id,
    })).rejects.toMatchObject({ code: 'DEINDEX_FAILED' });

    expect(fs.existsSync(path.join(runtimeRoot, 'learning', 'manuals', metadata.id, 'manual.md'))).toBe(true);
  });

  test('não remove manual de outro tenant e não toca no índice alheio', async () => {
    const metadata = await manualService.generateManualFromReplay({
      tenantId: 'academia-a',
      replayId: 'replay-manual-rag',
    });

    await expect(manualService.deleteManual({
      tenantId: 'academia-b',
      manualId: metadata.id,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(mockDeindexDocument).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(runtimeRoot, 'learning', 'manuals', metadata.id))).toBe(true);
  });
});
