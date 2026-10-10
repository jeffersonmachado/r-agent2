'use strict';

/**
 * `/rag/health` (Node) precisa dizer se o SERVIÇO RAG consegue servir, não só se
 * o banco está consistente.
 *
 * Defeito medido em 2026-10-06: o rag-service no ar mas sem `.env`
 * (`dbConfigured: false`) respondia 503/degraded e a tela do operador
 * (`/rag-documents`) seguia mostrando "ok" — o problema só aparecia por
 * documentos nascendo `failed`.
 *
 * Contrato fixado aqui:
 *  - `includeServiceHealth: true` ⇒ `serviceHealth` no payload e warning
 *    `RAG_SERVICE_NOT_READY` como PRIMEIRO warning quando o serviço não está
 *    pronto (a página mostra o primeiro);
 *  - sem a flag (default) ⇒ **nenhum probe de rede** (os testes de unidade do
 *    health não podem depender de um rag-service vivo);
 *  - probe que falha nunca quebra o health (`ok` continua calculado).
 */

const HEALTH_PATH = '../../api/services/rag/ragDocumentsHealth';

const HEALTHY = {
  state: 'healthy',
  available: true,
  ready: true,
  reason: null,
  errorType: null,
  httpStatus: 200,
  payload: { status: 'healthy', ready: true, dbConfigured: true },
  serviceUrl: 'http://127.0.0.1:8001',
};

const DEGRADED_NO_DB = {
  state: 'degraded',
  available: false,
  ready: false,
  reason: 'database_not_configured',
  errorType: null,
  httpStatus: 200,
  payload: { status: 'degraded', ready: false, dbConfigured: false, reason: 'database_not_configured' },
  serviceUrl: 'http://127.0.0.1:8001',
};

const UNREACHABLE = {
  state: 'unhealthy',
  available: false,
  ready: false,
  reason: 'connection_refused',
  errorType: 'connection_refused',
  payload: null,
  serviceUrl: 'http://127.0.0.1:8001',
};

let mockGetRagHealth;
let mockVectorStore;

function loadHealthLib() {
  // eslint-disable-next-line global-require
  return require(HEALTH_PATH);
}

async function callHealth(options, cache = new Map()) {
  const persistFn = jest.fn(async () => undefined);
  const markInconsistentFn = jest.fn(async () => undefined);
  const markConsistentFn = jest.fn(async () => undefined);
  const lib = loadHealthLib();
  const result = await lib.getRagHealth('tenant-1', options, cache, persistFn, markInconsistentFn, markConsistentFn);
  return { result, markConsistentFn, persistFn };
}

describe('ragDocumentsHealth — prontidão do serviço RAG', () => {
  beforeEach(() => {
    jest.resetModules();
    mockVectorStore = {
      countVectorDocs: jest.fn(async () => ({ documents: 0, chunks: 0 })),
      countChunksByDocument: jest.fn(async () => ({})),
      countChunksWithEmbeddingByDocument: jest.fn(async () => ({})),
    };
    jest.doMock('../../api/services/vectorStore/postgresVectorStore', () => mockVectorStore);
    mockGetRagHealth = jest.fn(async () => HEALTHY);
    jest.doMock('../../api/services/ragService', () => ({ getRagHealth: mockGetRagHealth }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('degradado sem banco virou PRIMEIRO warning com a causa e o remédio', async () => {
    mockGetRagHealth.mockResolvedValue(DEGRADED_NO_DB);

    const { result } = await callHealth({ includeServiceHealth: true });

    expect(result.ok).toBe(true);
    expect(result.warnings[0].code).toBe('RAG_SERVICE_NOT_READY');
    expect(result.warnings[0].message).toContain('database_not_configured');
    expect(result.warnings[0].message).toContain('--env-file .env');
    expect(result.warnings[0].details.dbConfigured).toBe(false);
    expect(result.serviceHealth).toMatchObject({
      state: 'degraded',
      ready: false,
      dbConfigured: false,
      reason: 'database_not_configured',
    });
  });

  test('serviço inacessível reporta queda de indexação/consulta', async () => {
    mockGetRagHealth.mockResolvedValue(UNREACHABLE);

    const { result } = await callHealth({ includeServiceHealth: true });

    expect(result.warnings[0].code).toBe('RAG_SERVICE_NOT_READY');
    expect(result.warnings[0].message).toContain('indisponível');
    expect(result.warnings[0].message).toContain('connection_refused');
    expect(result.serviceHealth.state).toBe('unhealthy');
  });

  test('serviço saudável não gera warning e reporta o estado', async () => {
    const { result } = await callHealth({ includeServiceHealth: true });

    expect(result.warnings).toEqual([]);
    expect(result.serviceHealth).toMatchObject({ state: 'healthy', ready: true, dbConfigured: true });
  });

  test('SEM a flag não há probe de rede (default dos testes de unidade)', async () => {
    const { result } = await callHealth({});

    expect(mockGetRagHealth).not.toHaveBeenCalled();
    expect(result.serviceHealth).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  test('probe que lança não quebra o health (best-effort)', async () => {
    mockGetRagHealth.mockRejectedValue(new Error('boom'));

    const { result } = await callHealth({ includeServiceHealth: true });

    expect(result.ok).toBe(true);
    expect(result.serviceHealth).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  test('sem getRagHealth no módulo (mock parcial) também não quebra', async () => {
    jest.resetModules();
    jest.doMock('../../api/services/vectorStore/postgresVectorStore', () => mockVectorStore);
    jest.doMock('../../api/services/ragService', () => ({}));

    const { result } = await callHealth({ includeServiceHealth: true });

    expect(result.ok).toBe(true);
    expect(result.serviceHealth).toBeNull();
  });
});
