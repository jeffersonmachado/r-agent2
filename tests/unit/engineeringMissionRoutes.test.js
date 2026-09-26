'use strict';

/**
 * Rotas do Engineering Mission Compiler — superfície DEVELOPMENT-only, entrada inválida e
 * propagação de erro de domínio. Servidor HTTP real (express + fetch), `requireAuth` injetado via
 * `buildDeps` (mesmo padrão de produção) e `checkClassification` REAL (não mockado).
 *
 * Cobre ADV-16 (escalada de privilégio) e ADV-17 (entrada malformada) do catálogo adversarial.
 */

const express = require('express');
const http = require('http');
const { createEngineeringMissionRoutes } = require('../../api/modules/engineering-missions/routes');
const { MISSION_TYPES } = require('../../engine/engineeringMission/constants');
const { deriveDisplayStatus } = require('../../engine/engineeringMission/missionStatus');

const MISSION_ID = '11111111-2222-3333-4444-555555555555';

function buildDepsFactory(overrides = {}) {
  const mission = {
    id: MISSION_ID,
    title: 'missão teste',
    original_mission: 'Corrija o defeito X',
    status: 'AWAITING_APPROVAL',
    approval_state: 'PENDING',
    current_version: 1,
    current_spec_hash: 'abc123',
    mission_type: 'BUG_FIX',
    risk: 'MEDIUM',
    preview: { sections: [], counts: { POLICY_REQUIRED: 1 } },
    enrichment: {},
  };
  const base = {
    // Dublê fiel ao produtor real: `api/middleware/auth.js` define `req.agent` E `req.tenantId`
    // (null de propósito para super-admin sem header). Um dublê que só devolve `{ valid: true }`
    // não representa request autenticado e faz as rotas fail-closed responderem 400.
    requireAuth: (req) => {
      req.tenantId = 'system';
      req.agent = { id: 'test-agent', email: 'test-agent@local' };
      return { valid: true };
    },
    // Stub do RBAC real (§19). O default permite para que os testes de auth/validação/ordem de
    // rota continuem medindo o que se propõem a medir; a MATRIZ de permissão tem testes próprios
    // (que negam explicitamente) mais abaixo neste arquivo.
    requirePermission: () => ({ allowed: true }),
    sendJson: (res, status, body) => { res.status(status).json(body); },
    badRequest: (res, message) => { res.status(400).json({ error: 'bad_request', message }); },
    hasJsonContentType: () => true,
    parseJsonBody: async (req) => req.body,
    logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    MISSION_TYPES,
    deriveDisplayStatus,
    missionStore: {
      listMissions: async () => [mission],
      listVersions: async () => [{ version: 1, spec_hash: 'abc123' }],
      listApprovals: async () => [{ id: 'ap-1', state: 'PENDING' }],
    },
    missionCompilerService: {
      compileMission: async (text) => ({ created: true, mission: { ...mission, original_mission: text, preview: { sections: [] }, approval_state: 'PENDING' } }),
      getMissionDetail: async () => ({ ...mission, displayStatus: 'AWAITING_APPROVAL', versions: [], approvals: [] }),
    },
    missionApprovalService: {
      getPolicy: async () => ({ enabled: false, mode: 'MANUAL', policyId: 'default' }),
      setPolicy: async (policy) => {
        if (policy.enabled === true && (policy.mode || 'MANUAL') === 'MANUAL') {
          const err = new Error('política com enabled=true exige mode SAFE_ONLY ou POLICY_BASED (MANUAL nunca autoaprova)');
          err.code = 'INVALID_MISSION_TRANSITION';
          throw err;
        }
        return policy;
      },
      approve: async () => ({ approval: { state: 'APPROVED' }, mission: { ...mission, status: 'APPROVED' }, created: true }),
      reject: async () => ({ approval: { state: 'REJECTED' }, mission: { ...mission, status: 'REJECTED' } }),
      editAndApprove: async () => ({ mission: { ...mission, current_version: 2 }, materiality: { level: 'MATERIAL' } }),
      reEnrich: async () => ({ ...mission, current_version: 2, preview: { sections: [] } }),
      evaluatePolicyForMission: async () => ({ eligible: false, blockers: [] }),
    },
    missionOrchestratorService: {
      startExecution: async () => {
        const err = new Error('nenhuma aprovação registrada para esta mission');
        err.code = 'MISSION_APPROVAL_NOT_FOUND';
        throw err;
      },
      runMissionTask: async () => ({ result: { status: 'GREEN' } }),
      resumeInterruptedMissions: async () => ({ scanned: 0, items: [] }),
      refreshMissionState: async () => ({ id: 1, status: 'BLOCKED', displayStatus: 'BLOCKED' }),
    },
    missionReportService: { buildMissionReport: async () => ({ artifactType: 'engineering-mission-report', originalMission: { text: 'x' } }) },
  };
  return { ...base, ...overrides };
}

function startServer(deps) {
  const app = express();
  app.use(express.json());
  app.use(createEngineeringMissionRoutes({ buildDeps: () => deps }));
  const server = http.createServer(app);
  return new Promise((resolve) => { server.listen(0, () => resolve(server)); });
}

const baseUrl = (server) => `http://127.0.0.1:${server.address().port}`;
// Dublê fiel ao produtor real: o middleware de produção define `req.agent` E `req.tenantId`.
// Sem `tenantId`, as rotas fail-closed devolvem 400 e o teste mede o dublê, não a rota.
const asDevelopment = (req) => {
  req.agent = { platformClassification: 'DEVELOPMENT' };
  req.tenantId = 'system';
  return { valid: true };
};

describe('engineering-missions routes', () => {
  let server;

  afterEach((done) => {
    if (server) server.close(done);
    else done();
  });

  test('ADV-16: 401 sem autenticação', async () => {
    server = await startServer(buildDepsFactory({ requireAuth: () => ({ valid: false, error: 'sem token' }) }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions`);
    expect(res.status).toBe(401);
  });

  test('ADV-16: classificação: 403 sem platformClassification (PRODUCTION default)', async () => {
    server = await startServer(buildDepsFactory());
    const res = await fetch(`${baseUrl(server)}/engineering/missions`);
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe('classification_required');
  });

  test('ADV-16: classificação: 403 para PRODUCTION explícito', async () => {
    server = await startServer(buildDepsFactory({ requireAuth: (req) => { req.agent = { platformClassification: 'PRODUCTION' }; return { valid: true }; } }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions`);
    expect(res.status).toBe(403);
  });

  test('ADV-16: classificação: 403 para SUPPORT explícito', async () => {
    server = await startServer(buildDepsFactory({ requireAuth: (req) => { req.agent = { platformClassification: 'SUPPORT' }; return { valid: true }; } }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions`);
    expect(res.status).toBe(403);
  });

  test('classificação: 200 para DEVELOPMENT na listagem, com displayStatus derivado', async () => {
    server = await startServer(buildDepsFactory({ requireAuth: asDevelopment }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.missions[0].displayStatus).toBe('AWAITING_APPROVAL');
  });

  test('classificação: overview agrega por displayStatus e expõe a política', async () => {
    server = await startServer(buildDepsFactory({ requireAuth: asDevelopment }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions/overview`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.byDisplayStatus.AWAITING_APPROVAL).toBe(1);
    expect(body.autoApprovalPolicy.mode).toBe('MANUAL');
  });

  test('ADV-17: POST sem missão retorna 400 antes de qualquer persistência', async () => {
    let called = false;
    server = await startServer(buildDepsFactory({
      requireAuth: asDevelopment,
      missionCompilerService: { compileMission: async () => { called = true; return {}; }, getMissionDetail: async () => null },
    }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mission: '   ' }),
    });
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  test('ADV-17: POST com missionType desconhecido retorna 400', async () => {
    server = await startServer(buildDepsFactory({ requireAuth: asDevelopment }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mission: 'corrija X', missionType: 'NAO_EXISTE' }),
    });
    expect(res.status).toBe(400);
  });

  test('POST válido compila e devolve preview (201)', async () => {
    server = await startServer(buildDepsFactory({ requireAuth: asDevelopment }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mission: 'Corrija definitivamente o defeito X' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.preview).toBeDefined();
    expect(body.autoApproved).toBe(false);
  });

  test('PUT /policy rejeita autoaprovação habilitada em modo MANUAL (422)', async () => {
    server = await startServer(buildDepsFactory({ requireAuth: asDevelopment }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions/policy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, mode: 'MANUAL' }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INVALID_MISSION_TRANSITION');
  });

  test('execução sem aprovação responde 409 com a causa exata (não 500)', async () => {
    server = await startServer(buildDepsFactory({ requireAuth: asDevelopment }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions/${MISSION_ID}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('MISSION_APPROVAL_NOT_FOUND');
  });

  test('missão inexistente responde 404', async () => {
    server = await startServer(buildDepsFactory({
      requireAuth: asDevelopment,
      missionCompilerService: { compileMission: async () => ({}), getMissionDetail: async () => null },
    }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions/${MISSION_ID}`);
    expect(res.status).toBe(404);
  });

  test('relatório de auditoria é servido com artefato identificado', async () => {
    server = await startServer(buildDepsFactory({ requireAuth: asDevelopment }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions/${MISSION_ID}/report`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifactType).toBe('engineering-mission-report');
  });

  test('REGRESSÃO de ordem de rota: /self-assessment NÃO pode ser capturado por /:id', async () => {
    // Achado real: com `GET /engineering/missions/:id` registrado antes de
    // `GET /engineering/missions/self-assessment`, o path era interpretado como uma missão com
    // id "self-assessment" — endpoint inalcançável (404), sem nenhum erro de boot. Rota estática
    // precisa vir antes da parametrizada.
    let calledCompilerDetail = false;
    server = await startServer(buildDepsFactory({
      requireAuth: asDevelopment,
      missionCompilerService: {
        compileMission: async () => ({}),
        getMissionDetail: async () => { calledCompilerDetail = true; return null; },
      },
      missionSelfAssessmentService: {
        computeSelfAssessment: async () => ({ artifactType: 'engineering-mission-self-assessment', window: { missionsAnalyzed: 0 } }),
        persistSelfAssessment: async () => 'reports/x.json',
      },
      missionReviewService: {
        runReviews: async () => ({}),
        getLatestReview: async () => null,
        listReviews: async () => [],
        getBlockingReview: async () => null,
      },
    }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions/self-assessment`);
    const body = await res.json();
    expect(calledCompilerDetail).toBe(false);
    expect(res.status).toBe(200);
    expect(body.artifactType).toBe('engineering-mission-self-assessment');
  });

  test('revisão: POST /:id/review rejeita kind desconhecido com 400', async () => {
    server = await startServer(buildDepsFactory({
      requireAuth: asDevelopment,
      missionReviewService: { runReviews: async () => ({}), getBlockingReview: async () => null },
    }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions/${MISSION_ID}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kinds: ['META', 'INEXISTENTE'] }),
    });
    expect(res.status).toBe(400);
  });

  test('revisão: POST /:id/review devolve findings e bloqueio quando existir', async () => {
    server = await startServer(buildDepsFactory({
      requireAuth: asDevelopment,
      missionReviewService: {
        runReviews: async () => ({ missionId: MISSION_ID, missionVersion: 1, meta: { status: 'FAIL', blocksGreen: true, counts: { blockers: 1 } }, adversarial: null }),
        getBlockingReview: async () => ({ id: 'rev-1', kind: 'META', blockingFindings: [{ id: 'MR-09', checkId: 'NO_SECRETS_IN_PATCH', severity: 'BLOCKER', title: 'Segredo adicionado pelo patch' }] }),
      },
    }));
    const res = await fetch(`${baseUrl(server)}/engineering/missions/${MISSION_ID}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kinds: ['META'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.blocksGreen).toBe(true);
    expect(body.blocking.blockingFindings[0].checkId).toBe('NO_SECRETS_IN_PATCH');
  });
});
