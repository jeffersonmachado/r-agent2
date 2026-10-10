'use strict';

/**
 * Indexador do RAG — documento sem texto extraído NÃO é indexado.
 *
 * Defeito medido em 2026-10-08: o upload gravava o placeholder
 * ("Sem texto extraído. Indexando metadados do arquivo.") como CONTEÚDO e o
 * indexador o aceitava, criando um "chunk fantasma" que pontuava alto e aparecia
 * como FONTE do copiloto (o `.jpeg` sem OCR foi a 1ª fonte de "Como faço uma
 * matrícula?", score 0.70) — e reapareceu nas fontes de "O que é o RAP?".
 *
 * Aqui a guarda é do INDEXADOR, que é o caminho por onde passam TODAS as
 * entradas (upload, reindex, sync, projeção de jornada, API): se ela só existisse
 * na ingestão, o defeito voltaria pelo próximo caminho.
 *
 * Contrato (nos dois sentidos):
 *  - conteúdo que é só placeholder → `not_applicable_no_text` (estado PRÓPRIO,
 *    não `failed`: não havia conteúdo a indexar), 0 chunks e chunk antigo
 *    removido do vector store;
 *  - conteúdo real → segue o fluxo normal (`indexed` com chunks).
 */

const mockDeindexDocument = jest.fn();
const mockIndexDocument = jest.fn();
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.mock('../../api/services/ragService', () => ({
  deindexDocument: (...args) => mockDeindexDocument(...args),
  indexDocument: (...args) => mockIndexDocument(...args),
}));

jest.mock('../../api/utils/logger', () => mockLogger);

const { reindexDocument } = require('../../api/services/rag/ragDocumentsIndexing');
const { NO_TEXT_PLACEHOLDER } = require('../../api/services/rag/indexableContent');

function buildDoc(content) {
  return {
    id: 'doc-placeholder-1',
    tenantId: 'system',
    title: 'aluno.jpeg',
    content,
    indexed: true,
    indexedAt: '2026-03-02T17:47:04.000Z',
    chunksCount: 1,
    indexStatus: 'indexed',
  };
}

async function run(doc) {
  const cache = new Map([[doc.id, doc]]);
  const persist = jest.fn(async () => {});
  const result = await reindexDocument(doc.id, cache, persist, null);
  return { result, doc, persist };
}

describe('ragDocumentsIndexing — placeholder não vira chunk', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeindexDocument.mockResolvedValue({ success: true, chunksRemoved: 1 });
    mockIndexDocument.mockResolvedValue({ success: true, chunksCreated: 3 });
  });

  test('conteúdo placeholder: não indexa, limpa chunk antigo e marca estado próprio', async () => {
    const { result, doc, persist } = await run(buildDoc(NO_TEXT_PLACEHOLDER));

    expect(mockIndexDocument).not.toHaveBeenCalled();
    expect(mockDeindexDocument).toHaveBeenCalledWith('doc-placeholder-1', 'system');

    expect(result.success).toBe(false);
    expect(result.chunksCreated).toBe(0);
    expect(result.errorCode).toBe('NO_TEXT_EXTRACTED');

    // Estado do pai: não é falha (não havia conteúdo) e o retrieval é
    // fail-closed para quem não está `indexed`.
    expect(doc.indexStatus).toBe('not_applicable_no_text');
    expect(doc.indexStatus).not.toBe('failed');
    expect(doc.indexed).toBe(false);
    expect(doc.indexedAt).toBeNull();
    expect(doc.chunksCount).toBe(0);
    expect(doc.indexErrorCode).toBe('NO_TEXT_EXTRACTED');
    expect(persist).toHaveBeenCalled();
  });

  test('o estado novo não conta como falha de indexação (health não vira ruído)', () => {
    const { isIndexFailure } = require('../../api/services/rag/ragDocumentsState');
    expect(isIndexFailure('not_applicable_no_text')).toBe(false);
    expect(isIndexFailure('failed')).toBe(true);
  });

  test('variação do placeholder (caixa/acento) também é recusada', async () => {
    const { result } = await run(buildDoc('sem texto extraido. indexando metadados do arquivo.'));
    expect(result.errorCode).toBe('NO_TEXT_EXTRACTED');
    expect(mockIndexDocument).not.toHaveBeenCalled();
  });

  test('conteúdo real segue indexando (controle)', async () => {
    const { result, doc } = await run(buildDoc('Plano mensal: matrícula com cadastro, pagamento e acesso liberado.'));

    expect(mockIndexDocument).toHaveBeenCalledTimes(1);
    expect(mockDeindexDocument).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.chunksCreated).toBe(3);
    expect(doc.indexStatus).toBe('indexed');
    expect(doc.chunksCount).toBe(3);
  });

  test('falha ao remover o chunk antigo não autoriza indexar o placeholder', async () => {
    mockDeindexDocument.mockRejectedValue(new Error('rag-service fora do ar'));

    const { result, doc } = await run(buildDoc(NO_TEXT_PLACEHOLDER));

    expect(mockIndexDocument).not.toHaveBeenCalled();
    expect(result.errorCode).toBe('NO_TEXT_EXTRACTED');
    expect(doc.indexStatus).toBe('not_applicable_no_text');
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});
