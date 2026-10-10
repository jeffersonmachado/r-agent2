'use strict';

/**
 * Ingestão de arquivo no RAG — documento SEM texto extraído não pode ser indexado.
 *
 * Defeito medido em 2026-10-08: quando a extração não devolvia texto (ex.: `.jpeg`
 * sem OCR), a rota gravava o PLACEHOLDER como conteúdo do documento
 * (`"Sem texto extraído. Indexando metadados do arquivo."`) e o indexava. O
 * resultado era um "chunk fantasma" que pontuava alto e entrava nas respostas do
 * copiloto: o `.jpeg` foi a 1ª FONTE de "Como faço uma matrícula?" (score 0.70),
 * à frente dos manuais de jornada.
 *
 * Contrato fixado aqui (nos dois sentidos):
 *  - sem texto extraído → `autoIndex: false` + aviso `NOT_INDEXED_NO_TEXT`
 *    (o documento continua existindo como asset/metadado);
 *  - com texto extraído → comportamento anterior preservado (`autoIndex: true`).
 */

const { handleRagIngestionRoutes } = require('../../api/modules/rag-documents/rag/ragIngestionRoutes');

const ROUTE = '/rag/documents/upload';

function buildHarness({ extractedText, warnings = [] }) {
  const calls = { createDocument: [], sendJson: [], emitPipelineStage: [] };
  const res = { setHeader: jest.fn(), statusCode: 200 };
  const req = {
    headers: { 'content-type': 'multipart/form-data; boundary=xyz' },
    tenantId: 'system',
    agent: { id: 'u-1', tenantId: 'system' },
  };

  const deps = {
    requireAuth: () => ({ valid: true }),
    requirePermission: () => ({ allowed: true }),
    parseMultipartFormData: async () => ({
      fields: {},
      files: [{ filename: 'aluno.jpeg', mimeType: 'image/jpeg', size: 1024, buffer: Buffer.from('x') }],
    }),
    extractTextFromFile: async () => ({ extractedText, warnings }),
    createDocument: async (documentData) => {
      calls.createDocument.push(documentData);
      return {
        success: true,
        document: { id: 'doc-teste', title: documentData.title, content: documentData.content },
        indexing: { attempted: Boolean(documentData.autoIndex), success: true },
      };
    },
    ragDocumentsService: {
      upsertDocumentFileToDb: async () => ({ success: true }),
      updateDocument: async () => ({ success: true }),
      deleteDocument: async () => ({ success: true }),
    },
    isSuperAdmin: () => true,
    isValidExecutionId: () => false,
    createPipelineWs: () => null,
    emitPipelineStage: (...args) => calls.emitPipelineStage.push(args),
    sendJson: (targetRes, status, payload) => { calls.sendJson.push({ status, payload }); },
    badRequest: (targetRes, message) => { calls.sendJson.push({ status: 400, payload: { message } }); },
    setCorsHeaders: jest.fn(),
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    sendRagApiError: jest.fn(() => true),
  };

  return { req, res, deps, calls };
}

async function runUpload(options) {
  const harness = buildHarness(options);
  await handleRagIngestionRoutes({
    req: harness.req,
    res: harness.res,
    method: 'POST',
    pathname: ROUTE,
    deps: harness.deps,
  });
  return harness.calls;
}

describe('rag upload — documento sem texto extraído não entra no índice', () => {
  test('arquivo sem texto: autoIndex false e aviso declarado', async () => {
    const calls = await runUpload({ extractedText: '', warnings: [] });

    expect(calls.createDocument).toHaveLength(1);
    const documentData = calls.createDocument[0];
    expect(documentData.autoIndex).toBe(false);
    // O conteúdo segue existindo para a listagem (asset sem texto)...
    expect(documentData.content).toContain('Sem texto extraído');
    // ...mas o chamador é AVISADO de que não houve indexação.
    const codes = (documentData.metadata.extractionWarnings || []).map((w) => w.code);
    expect(codes).toContain('NO_TEXT_EXTRACTED');
    expect(codes).toContain('NOT_INDEXED_NO_TEXT');
  });

  test('arquivo com texto: indexação preservada (controle)', async () => {
    const calls = await runUpload({
      extractedText: 'Plano mensal: matrícula com cadastro, pagamento e liberação de acesso.',
      warnings: [],
    });

    expect(calls.createDocument).toHaveLength(1);
    const documentData = calls.createDocument[0];
    expect(documentData.autoIndex).toBe(true);
    const codes = (documentData.metadata.extractionWarnings || []).map((w) => w.code);
    expect(codes).not.toContain('NOT_INDEXED_NO_TEXT');
  });
});
