'use strict';

/**
 * Testes unitários: rotas de competências do Learning Core (/api/learning/*).
 */

const mockGetCompetencies = jest.fn();
const mockRecomputeCompetencies = jest.fn();
const mockGetSkillGraphArtifact = jest.fn();

jest.mock('../../api/modules/learning-core/service', () => ({
  ingestInteractionBatch: jest.fn(async () => ({ accepted: 0, rejected: 0 })),
}));

jest.mock('../../api/modules/learning-core/competencyService', () => ({
  getCompetencies: (...args) => mockGetCompetencies(...args),
  recomputeCompetencies: (...args) => mockRecomputeCompetencies(...args),
  getSkillGraphArtifact: (...args) => mockGetSkillGraphArtifact(...args),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { handleLearningCoreRoutes } = require('../../api/modules/learning-core/routes');

function buildDeps(overrides = {}) {
  const sent = [];
  const deps = {
    requireAuth: jest.fn(() => ({ valid: true })),
    sendJson: jest.fn((res, code, data) => sent.push({ code, data })),
    badRequest: jest.fn((res, message) => sent.push({ code: 400, data: { error: message } })),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({})),
    ...overrides,
  };
  return { deps, sent };
}

function buildCtx({ method = 'GET', pathname, agent, deps }) {
  return {
    req: { agent: agent || { id: 'u1', username: 'agente1', role: 'operator', tenantId: 'system' } },
    res: { writableEnded: true },
    method,
    pathname,
    deps,
  };
}

describe('learning-core — rotas de competências', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCompetencies.mockResolvedValue({
      agentId: 'u1',
      competencies: [{ skillKey: 'tickets', score: 0.8 }],
      profile: { dominantSkills: [] },
      computedAt: '2026-07-23T00:00:00.000Z',
    });
    mockRecomputeCompetencies.mockResolvedValue({
      competencies: [],
      profile: { dominantSkills: [], weakSkills: [], totals: {} },
      unclassifiedRoutes: [],
      eventsProcessed: 0,
    });
    mockGetSkillGraphArtifact.mockReturnValue(null);
  });

  test('GET /competencies/me exige autenticação (401)', async () => {
    const { deps, sent } = buildDeps({ requireAuth: jest.fn(() => ({ valid: false })) });
    const handled = await handleLearningCoreRoutes(buildCtx({ pathname: '/api/learning/competencies/me', deps }));
    expect(handled).toBe(true);
    expect(sent[0].code).toBe(401);
    expect(mockGetCompetencies).not.toHaveBeenCalled();
  });

  test('GET /competencies/me retorna competências do próprio usuário (200)', async () => {
    const { deps, sent } = buildDeps();
    const handled = await handleLearningCoreRoutes(buildCtx({ pathname: '/api/learning/competencies/me', deps }));
    expect(handled).toBe(true);
    expect(mockGetCompetencies).toHaveBeenCalledWith({ tenantId: 'system', agentId: 'u1' });
    expect(sent[0].code).toBe(200);
    expect(sent[0].data.competencies).toHaveLength(1);
  });

  test('GET /competencies/:userId nega acesso sem role admin (403)', async () => {
    const { deps, sent } = buildDeps();
    const handled = await handleLearningCoreRoutes(buildCtx({ pathname: '/api/learning/competencies/u2', deps }));
    expect(handled).toBe(true);
    expect(sent[0].code).toBe(403);
    expect(mockGetCompetencies).not.toHaveBeenCalled();
  });

  test('GET /competencies/:userId permite admin (200)', async () => {
    const { deps, sent } = buildDeps();
    const handled = await handleLearningCoreRoutes(buildCtx({
      pathname: '/api/learning/competencies/u2',
      agent: { id: 'admin1', role: 'admin', tenantId: 'system' },
      deps,
    }));
    expect(handled).toBe(true);
    expect(mockGetCompetencies).toHaveBeenCalledWith({ tenantId: 'system', agentId: 'u2' });
    expect(sent[0].code).toBe(200);
  });

  test('POST /competencies/recompute recomputa o próprio usuário e retorna payload', async () => {
    const { deps, sent } = buildDeps();
    const handled = await handleLearningCoreRoutes(buildCtx({
      method: 'POST',
      pathname: '/api/learning/competencies/recompute',
      deps,
    }));
    expect(handled).toBe(true);
    expect(mockRecomputeCompetencies).toHaveBeenCalledWith({
      tenantId: 'system',
      agentId: 'u1',
      username: 'agente1',
    });
    expect(sent[0].code).toBe(200);
    expect(sent[0].data).toHaveProperty('unclassifiedRoutes');
    expect(sent[0].data).toHaveProperty('eventsProcessed');
  });

  test('GET /skill-graph retorna 404 explícito quando o artefato não foi gerado', async () => {
    const { deps, sent } = buildDeps();
    const handled = await handleLearningCoreRoutes(buildCtx({ pathname: '/api/learning/skill-graph', deps }));
    expect(handled).toBe(true);
    expect(sent[0].code).toBe(404);
    expect(sent[0].data.error).toBe('skill_graph_not_generated');
    expect(sent[0].data.message).toContain('learning:skill-graph:build');
  });

  test('GET /skill-graph retorna o artefato quando gerado (200)', async () => {
    mockGetSkillGraphArtifact.mockReturnValue({ version: 1, skills: [], journeys: [], routeSkillMap: {} });
    const { deps, sent } = buildDeps();
    const handled = await handleLearningCoreRoutes(buildCtx({ pathname: '/api/learning/skill-graph', deps }));
    expect(handled).toBe(true);
    expect(sent[0].code).toBe(200);
    expect(sent[0].data.version).toBe(1);
  });

  test('rotas fora do learning-core não são tratadas', async () => {
    const { deps } = buildDeps();
    const handled = await handleLearningCoreRoutes(buildCtx({ pathname: '/api/other', deps }));
    expect(handled).toBe(false);
  });
});
