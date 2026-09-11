'use strict';

/**
 * Segregação de acesso backend nas rotas de replay do Learning Core.
 *
 * GAP CONFIRMADO (auditoria 2026-09-11): `GET /api/learning/replays`,
 * `POST /api/learning/training/from-replay` e
 * `POST /api/learning/manuals/from-replay` exigiam apenas papel de tenant
 * (owner/admin/super_admin). Um admin operacional PRODUCTION (owner/admin de
 * tenant, sem platformRole) era autoridade suficiente para listar replays
 * técnicos e derivar conteúdo deles — o frontend escondia, mas a API não
 * negava. Frontend não é enforcement.
 *
 * Regra: classificação de plataforma é independente do papel de tenant.
 *   - PRODUCTION (owner/admin de tenant) → NÃO acessa replay/derivação
 *   - SUPPORT (platformRole support_n1..n3, customer_success) → acessa replay
 *   - DEVELOPMENT (engineer/qa_engineer/devops ou super_admin) → acessa
 *
 * A classificação é o gate; o papel de tenant deixou de ser usado como
 * autorização nessas superfícies técnicas porque a classificação é resolvida
 * server-side a partir de `platform_role`, não de dados do request.
 */

const mockListReplays = jest.fn(() => []);
const mockGenerateTrainingFromReplay = jest.fn(async () => ({ trainingId: 'training:x' }));
const mockGenerateManualFromReplay = jest.fn(async () => ({ id: 'manual-1' }));

jest.mock('../../api/modules/learning-core/service', () => ({
  ingestInteractionBatch: jest.fn(async () => ({ accepted: 0, rejected: 0 })),
}));

jest.mock('../../api/modules/learning-core/journeyTrainerService', () => ({
  listReplays: (...args) => mockListReplays(...args),
  generateTrainingFromReplay: (...args) => mockGenerateTrainingFromReplay(...args),
}));

jest.mock('../../api/modules/learning-core/manualService', () => ({
  generateManualFromReplay: (...args) => mockGenerateManualFromReplay(...args),
  listManuals: jest.fn(() => []),
  resolveManualFile: jest.fn(),
  ensureManualPdf: jest.fn(),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { handleLearningCoreRoutes } = require('../../api/modules/learning-core/routes');

function buildDeps() {
  const sent = [];
  const deps = {
    requireAuth: jest.fn(() => ({ valid: true })),
    sendJson: jest.fn((_res, code, data) => sent.push({ code, data })),
    badRequest: jest.fn((_res, message) => sent.push({ code: 400, data: { error: message } })),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({ replayId: 'replay-1' })),
  };
  return { deps, sent };
}

async function invoke({ method, pathname, agent }) {
  const { deps, sent } = buildDeps();
  await handleLearningCoreRoutes({
    req: { agent, tenantId: agent?.tenantId },
    res: { writableEnded: false, writeHead: jest.fn(), end: jest.fn() },
    method,
    pathname,
    deps,
  });
  return sent;
}

const PRODUCTION_TENANT_ADMIN = {
  id: 'u-admin', username: 'admin', role: 'admin', tenantId: 'academia-a',
};
const SUPPORT_AGENT = {
  id: 'u-sup', username: 'sup', role: 'agent', tenantId: 'academia-a', platformRole: 'support_n2',
};
const DEVELOPMENT_AGENT = {
  id: 'u-dev', username: 'dev', role: 'agent', tenantId: 'academia-a', platformRole: 'engineer',
};

describe('learning-core — segregação de replay/derivação (boundary backend)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/learning/replays nega admin PRODUCTION do tenant', async () => {
    const sent = await invoke({
      method: 'GET', pathname: '/api/learning/replays', agent: PRODUCTION_TENANT_ADMIN,
    });

    expect(sent[0].code).toBe(403);
    expect(sent[0].data.error).toBe('classification_required');
    expect(sent[0].data.required).toBe('SUPPORT');
    expect(mockListReplays).not.toHaveBeenCalled();
  });

  test('GET /api/learning/replays permite SUPPORT de plataforma', async () => {
    const sent = await invoke({
      method: 'GET', pathname: '/api/learning/replays', agent: SUPPORT_AGENT,
    });

    expect(sent[0].code).toBe(200);
    expect(mockListReplays).toHaveBeenCalledWith({ tenantId: 'academia-a' });
  });

  test('POST /api/learning/training/from-replay nega admin PRODUCTION do tenant', async () => {
    const sent = await invoke({
      method: 'POST', pathname: '/api/learning/training/from-replay', agent: PRODUCTION_TENANT_ADMIN,
    });

    expect(sent[0].code).toBe(403);
    expect(sent[0].data.error).toBe('classification_required');
    expect(mockGenerateTrainingFromReplay).not.toHaveBeenCalled();
  });

  test('POST /api/learning/training/from-replay permite SUPPORT de plataforma', async () => {
    const sent = await invoke({
      method: 'POST', pathname: '/api/learning/training/from-replay', agent: SUPPORT_AGENT,
    });

    expect(sent[0].code).toBe(201);
    expect(mockGenerateTrainingFromReplay).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'academia-a',
      replayId: 'replay-1',
    }));
  });

  test('POST /api/learning/manuals/from-replay nega admin PRODUCTION do tenant', async () => {
    const sent = await invoke({
      method: 'POST', pathname: '/api/learning/manuals/from-replay', agent: PRODUCTION_TENANT_ADMIN,
    });

    expect(sent[0].code).toBe(403);
    expect(sent[0].data.error).toBe('classification_required');
    expect(mockGenerateManualFromReplay).not.toHaveBeenCalled();
  });

  test('POST /api/learning/manuals/from-replay permite DEVELOPMENT', async () => {
    const sent = await invoke({
      method: 'POST', pathname: '/api/learning/manuals/from-replay', agent: DEVELOPMENT_AGENT,
    });

    expect(sent[0].code).toBe(201);
    expect(mockGenerateManualFromReplay).toHaveBeenCalled();
  });

  test('classificação é o gate: auditor de tenant (PRODUCTION) é negado', async () => {
    const sent = await invoke({
      method: 'GET',
      pathname: '/api/learning/replays',
      agent: { id: 'u-aud', username: 'aud', role: 'auditor', tenantId: 'academia-a' },
    });

    expect(sent[0].code).toBe(403);
    expect(sent[0].data.error).toBe('classification_required');
    expect(mockListReplays).not.toHaveBeenCalled();
  });

  test('classificação é o gate: super_admin (DEVELOPMENT) acessa sem papel de tenant owner/admin', async () => {
    const sent = await invoke({
      method: 'GET',
      pathname: '/api/learning/replays',
      agent: { id: 'u-sa', username: 'sa', role: 'super_admin', tenantId: 'academia-a' },
    });

    expect(sent[0].code).toBe(200);
    expect(mockListReplays).toHaveBeenCalledWith({ tenantId: 'academia-a' });
  });
});
