'use strict';

/**
 * RBAC granular das rotas de missão (§19) + gate de escalação de política (§20).
 *
 * Defeito real corrigido: o módulo inteiro era protegido APENAS por
 * `requireAuth` + `classification('DEVELOPMENT')`. Classificação diz ONDE a rota pode ser chamada
 * (superfície de engenharia), não O QUE aquele usuário pode fazer — qualquer identidade com
 * classificação DEVELOPMENT podia aprovar, executar e ADMINISTRAR A POLÍTICA da instalação.
 *
 * Aqui a matriz é medida com o `requirePermission` REAL do produto
 * (`api/middleware/auth.js` + `ROLE_PERMISSIONS`), não com um stub que sempre diz sim.
 */

const express = require('express');
const http = require('http');
const { createEngineeringMissionRoutes, resolveRequiredAction, ROUTE_ACTIONS } = require('../../api/modules/engineering-missions/routes');
const { MISSION_TYPES } = require('../../engine/engineeringMission/constants');
const { deriveDisplayStatus } = require('../../engine/engineeringMission/missionStatus');
const { hasPermission, ROLE_PERMISSIONS } = require('../../api/services/rbacService');
const { requirePermission } = require('../../api/middleware/auth');

const MISSION_ID = '11111111-2222-3333-4444-555555555555';

/** Agente real de cada papel, do jeito que o middleware entrega (req.agent). */
const agentFor = (role, platformClassification = 'DEVELOPMENT') => ({ id: `u-${role}`, role, platformClassification });
const asAgent = (role) => (req) => { req.agent = agentFor(role); return { valid: true }; };

function buildDeps(overrides = {}) {
  const mission = {
    id: MISSION_ID,
    title: 'missão rbac',
    original_mission: 'Corrija o defeito X',
    status: 'AWAITING_APPROVAL',
    approval_state: 'PENDING',
    current_version: 1,
    current_spec_hash: 'abc123',
    mission_type: 'BUG_FIX',
    risk: 'MEDIUM',
    preview: { sections: [] },
    enrichment: {},
  };
  const compileCalls = [];
  const loggerErrors = [];
  const base = {
    requireAuth: () => ({ valid: true }),
    // O MESMO checker usado em produção — a matriz abaixo é medida contra ele.
    requirePermission,
    sendJson: (res, status, body) => { res.status(status).json(body); },
    badRequest: (res, message) => { res.status(400).json({ error: 'bad_request', message }); },
    hasJsonContentType: () => true,
    parseJsonBody: async (req) => req.body,
    // Logger que REGISTRA em vez de engolir: um logger mudo esconde justamente o erro que o teste
    // precisa ver (a primeira versão deste arquivo deu 500 e o motivo ficou invisível).
    logger: { error: (...args) => { loggerErrors.push(args); }, warn: () => {}, info: () => {}, debug: () => {} },
    MISSION_TYPES,
    deriveDisplayStatus,
    missionStore: { listMissions: async () => [mission] },
    missionCompilerService: {
      compileMission: async (text, options) => {
        compileCalls.push(options);
        return { created: true, mission: { ...mission, original_mission: text, preview: { sections: [] }, approval_state: 'PENDING' } };
      },
      getMissionDetail: async () => ({ ...mission, displayStatus: 'AWAITING_APPROVAL', versions: [], approvals: [] }),
    },
    missionApprovalService: {
      getPolicy: async () => ({ enabled: false, mode: 'MANUAL' }),
      setPolicy: async (policy) => policy,
      approve: async () => ({ approval: { state: 'APPROVED' }, mission }),
      reject: async () => ({ approval: { state: 'REJECTED' }, mission }),
      editAndApprove: async () => ({ mission }),
      reEnrich: async () => mission,
      evaluatePolicyForMission: async () => ({ eligible: false }),
    },
    missionOrchestratorService: {
      startExecution: async () => ({ task: { id: 'task-1' }, mission }),
      runMissionTask: async () => ({ result: { status: 'GREEN' } }),
      resumeInterruptedMissions: async () => ({ scanned: 0, items: [] }),
      refreshMissionState: async () => mission,
    },
    missionReportService: { buildMissionReport: async () => ({ artifactType: 'engineering-mission-report' }) },
    missionReviewService: {
      runReviews: async () => ({ meta: { status: 'FAIL', blocksGreen: true }, adversarial: { status: 'PASS' } }),
      listReviews: async () => [],
      getLatestReview: async () => null,
    },
    missionSelfAssessmentService: { computeSelfAssessment: async () => ({ artifactType: 'engineering-mission-self-assessment', rate: () => null }) },
  };
  const deps = { ...base, ...overrides };
  deps.__compileCalls = compileCalls;
  deps.__loggerErrors = loggerErrors;
  return deps;
}

function startServer(deps) {
  const app = express();
  app.use(express.json());
  app.use(createEngineeringMissionRoutes({ buildDeps: () => deps }));
  const server = http.createServer(app);
  return new Promise((resolve) => { server.listen(0, () => resolve(server)); });
}

const url = (server, path) => `http://127.0.0.1:${server.address().port}${path}`;
const METHODS = { GET: 'GET', POST: 'POST', PUT: 'PUT' };

describe('engineering-missions — mapa rota→ação (fail-closed)', () => {
  test('cada rota do módulo tem uma ação de RBAC declarada', () => {
    const expectations = [
      ['GET', '/engineering/missions', 'read'],
      ['POST', '/engineering/missions', 'create'],
      ['GET', '/engineering/missions/overview', 'read'],
      ['GET', '/engineering/missions/self-assessment', 'read'],
      ['GET', '/engineering/missions/policy', 'read'],
      ['PUT', '/engineering/missions/policy', 'policy_admin'],
      ['POST', '/engineering/missions/resume-interrupted', 'execute'],
      ['GET', `/engineering/missions/${MISSION_ID}`, 'read'],
      ['GET', `/engineering/missions/${MISSION_ID}/preview`, 'read'],
      ['GET', `/engineering/missions/${MISSION_ID}/report`, 'read'],
      ['POST', `/engineering/missions/${MISSION_ID}/enrich`, 'enrich'],
      ['POST', `/engineering/missions/${MISSION_ID}/approve`, 'approve'],
      ['POST', `/engineering/missions/${MISSION_ID}/reject`, 'reject'],
      ['POST', `/engineering/missions/${MISSION_ID}/edit`, 'approve'],
      ['POST', `/engineering/missions/${MISSION_ID}/execute`, 'execute'],
      ['POST', `/engineering/missions/${MISSION_ID}/review`, 'execute'],
    ];
    for (const [method, path, action] of expectations) {
      expect(resolveRequiredAction(method, path)).toBe(action);
    }
  });

  test('rota NÃO mapeada devolve null (nunca "herda" permissão por omissão)', () => {
    expect(resolveRequiredAction('POST', '/engineering/missions/qualquer-coisa/nova')).toBeNull();
    expect(resolveRequiredAction('DELETE', '/engineering/missions')).toBeNull();
    expect(resolveRequiredAction('GET', '/outro/modulo')).toBeNull();
  });

  test('POST /review e POST /execute exigem a ação de execução (não leitura)', () => {
    expect(resolveRequiredAction('POST', `/engineering/missions/${MISSION_ID}/review`)).toBe('execute');
    expect(resolveRequiredAction('POST', `/engineering/missions/${MISSION_ID}/execute`)).toBe('execute');
    expect(ROUTE_ACTIONS.every((entry) => typeof entry.action === 'string')).toBe(true);
  });
});

describe('engineering-missions — matriz de permissão real (§19)', () => {
  const servers = [];
  afterEach((done) => {
    const closing = servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve)));
    Promise.all(closing).then(() => done());
  });
  const open = async (deps) => { const s = await startServer(deps); servers.push(s); return s; };

  test('ROLE_PERMISSIONS: engineering existe para owner/admin e NÃO para papéis operacionais', () => {
    expect(hasPermission(agentFor('owner'), 'engineering', 'policy_admin')).toBe(true);
    expect(hasPermission(agentFor('admin'), 'engineering', 'execute')).toBe(true);
    // Um tenant ADMIN não autoriza escalação de política da instalação (§20).
    expect(hasPermission(agentFor('admin'), 'engineering', 'policy_admin')).toBe(false);
    for (const role of ['operator', 'supervisor', 'manager', 'auditor', 'readonly']) {
      expect(hasPermission(agentFor(role), 'engineering', 'read')).toBe(false);
      expect(hasPermission(agentFor(role), 'engineering', 'execute')).toBe(false);
      expect(hasPermission(agentFor(role), 'engineering', 'approve')).toBe(false);
    }
    expect(ROLE_PERMISSIONS.auditor.some((p) => p.resource === 'engineering')).toBe(false);
  });

  test('owner com DEVELOPMENT acessa a listagem', async () => {
    const deps = buildDeps({ requireAuth: asAgent('owner') });
    const server = await open(deps);
    const res = await fetch(url(server, '/engineering/missions'));
    // Se algum dep faltar na montagem, o erro aparece aqui em vez de virar um 500 mudo.
    expect(deps.__loggerErrors).toEqual([]);
    expect(res.status).toBe(200);
  });

  test('papel SEM permissão de engenharia recebe 403 com a ação exigida (não 401 nem 200)', async () => {
    const server = await open(buildDeps({ requireAuth: asAgent('operator') }));
    const res = await fetch(url(server, '/engineering/missions'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('forbidden');
    expect(body.required).toEqual({ resource: 'engineering', action: 'read' });
  });

  test('papel com leitura NÃO executa: POST /execute responde 403 exigindo a ação de execução', async () => {
    const deps = buildDeps({ requireAuth: asAgent('admin') });
    // admin tem execute; o caso negativo é um papel só-leitura de engenharia — simulado removendo
    // a permissão de execute do agente (mesma identidade, permissão diferente).
    deps.requirePermission = (req, resource, action) => (action === 'execute'
      ? { allowed: false, error: 'Permissão negada: execute em engineering' }
      : requirePermission(req, resource, action));
    const server = await open(deps);
    const res = await fetch(url(server, `/engineering/missions/${MISSION_ID}/execute`), { method: 'POST' });
    expect(res.status).toBe(403);
    expect((await res.json()).required.action).toBe('execute');
  });

  test('PUT /policy exige policy_admin (owner passa, admin NÃO)', async () => {
    const ownerServer = await open(buildDeps({ requireAuth: asAgent('owner') }));
    const ownerRes = await fetch(url(ownerServer, '/engineering/missions/policy'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, mode: 'SAFE_ONLY' }),
    });
    expect(ownerRes.status).toBe(200);

    const adminServer = await open(buildDeps({ requireAuth: asAgent('admin') }));
    const adminRes = await fetch(url(adminServer, '/engineering/missions/policy'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, mode: 'SAFE_ONLY' }),
    });
    expect(adminRes.status).toBe(403);
    expect((await adminRes.json()).required.action).toBe('policy_admin');
  });

  test('composition incompleta (sem requirePermission) NEGA com 500 explícito — nunca libera', async () => {
    const deps = buildDeps({ requireAuth: asAgent('owner') });
    delete deps.requirePermission;
    const server = await open(deps);
    const res = await fetch(url(server, '/engineering/missions'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('permission_checker_missing');
  });

  test('a autorização de ESCALAÇÃO de política vem do RBAC, nunca do corpo da requisição', async () => {
    const deps = buildDeps({ requireAuth: asAgent('owner') });
    const server = await open(deps);
    await fetch(url(server, '/engineering/missions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mission: 'Missão com política ampla', autoApprovalPolicy: { maxRisk: 'CRITICAL' } }),
    });
    // owner tem policy_admin ⇒ autorizado.
    expect(deps.__compileCalls[0].policyEscalationAuthorized).toBe(true);

    const adminDeps = buildDeps({ requireAuth: asAgent('admin') });
    const adminServer = await open(adminDeps);
    await fetch(url(adminServer, '/engineering/missions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mission: 'Missão com política ampla', autoApprovalPolicy: { maxRisk: 'CRITICAL' } }),
    });
    // admin NÃO tem policy_admin ⇒ não autorizado (o corpo pedindo não muda nada).
    expect(adminDeps.__compileCalls[0].policyEscalationAuthorized).toBe(false);
  });

  test('POLICY_ESCALATION_DENIED é 403 (política é negada, não "ajustada")', async () => {
    const deps = buildDeps({
      requireAuth: asAgent('admin'),
      missionCompilerService: {
        compileMission: async () => {
          const err = new Error('escalação bloqueada');
          err.code = 'POLICY_ESCALATION_DENIED';
          err.escalations = [{ axis: 'maxRisk', comparison: 'WIDER' }];
          throw err;
        },
        getMissionDetail: async () => null,
      },
    });
    const server = await open(deps);
    const res = await fetch(url(server, '/engineering/missions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mission: 'x' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('POLICY_ESCALATION_DENIED');
    expect(body.escalations).toHaveLength(1);
  });

  test('401 continua vindo ANTES de 403 (autenticação precede autorização)', async () => {
    const server = await open(buildDeps({ requireAuth: () => ({ valid: false, error: 'sem token' }) }));
    const res = await fetch(url(server, '/engineering/missions'));
    expect(res.status).toBe(401);
  });

  test('METHODS cobre os verbos usados no mapa (guarda contra teste que não exercita o real)', () => {
    expect(Object.values(METHODS)).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT']));
    expect(ROUTE_ACTIONS.some((entry) => entry.method === 'PUT')).toBe(true);
  });
});
