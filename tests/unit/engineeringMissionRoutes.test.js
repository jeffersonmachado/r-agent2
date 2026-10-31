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

/**
 * GOVERNANCE_CHANGE_HTTP_FLOW — o contrato de aprovação de self-modification atravessa o boundary
 * HTTP REAL (express + fetch), com a identidade vinda da AUTENTICAÇÃO.
 *
 * DEFEITO ELIMINADO (2026-10-03): a rota encaminhava apenas `actorType`, `approvalRef` e `note`.
 * `governanceChangeApproved`, `governanceChangeReason`, `reviewer` e `requiresIndependentReviewer`
 * eram DESCARTADOS — o caminho de mudança legítima de governança existia no serviço e no motor, mas
 * era INALCANÇÁVEL por HTTP: um humano autorizado jamais conseguia autorizar uma alteração de gate.
 */
describe('engineering-missions routes — aprovação de self-modification (HTTP real)', () => {
  const FINDING_ID = 'f1111111-2222-3333-4444-555555555555';
  let server;
  let captured;

  afterEach((done) => {
    if (server) server.close(done);
    else done();
  });

  function depsWithApproval({ allowed = true, impl } = {}) {
    captured = null;
    return buildDepsFactory({
      requireAuth: asDevelopment,
      requirePermission: () => ({ allowed }),
      bugTriageService: {
        approveSelfModification: async (findingId, payload) => {
          captured = { findingId, payload };
          if (impl) return impl(findingId, payload);
          return { approved: true, finding: { id: findingId, status: 'FIXING' } };
        },
      },
    });
  }

  test('GOV_HTTP_01 a rota ENCAMINHA o consentimento explícito de governança ao serviço', async () => {
    server = await startServer(depsWithApproval());
    const res = await fetch(`${baseUrl(server)}/engineering/findings/${FINDING_ID}/approve-self-modification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        governanceChangeApproved: true,
        governanceChangeReason: 'o limiar antigo media outro conjunto de testes',
        reviewer: 'auditor-independente',
        requiresIndependentReviewer: true,
        approvalRef: 'CHG-42',
        note: 'aval registrado no change request',
      }),
    });

    expect(res.status).toBe(200);
    expect(captured).not.toBeNull();
    expect(captured.payload.governanceChangeApproved).toBe(true);
    expect(captured.payload.governanceChangeReason).toContain('limiar antigo');
    expect(captured.payload.reviewer).toBe('auditor-independente');
    expect(captured.payload.requiresIndependentReviewer).toBe(true);
    expect(captured.payload.approvalRef).toBe('CHG-42');
    expect(captured.payload.note).toContain('change request');
  });

  test('GOV_HTTP_02 ausência de consentimento explícito NÃO vira true (nunca presumido)', async () => {
    server = await startServer(depsWithApproval());
    const res = await fetch(`${baseUrl(server)}/engineering/findings/${FINDING_ID}/approve-self-modification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'aprovação genérica' }),
    });

    expect(res.status).toBe(200);
    expect(captured.payload.governanceChangeApproved).toBe(false);
    expect(captured.payload.requiresIndependentReviewer).toBe(false);
  });

  test('GOV_HTTP_03 a identidade do aprovador vem da AUTENTICAÇÃO — `actor` do corpo é ignorado', async () => {
    // Principal autenticado REAL: id + classificação (o produtor `asDevelopment` só classifica).
    const deps = depsWithApproval();
    deps.requireAuth = (req) => {
      req.tenantId = 'system';
      req.agent = { id: 'test-agent', username: 'test-agent', platformClassification: 'DEVELOPMENT' };
      return { valid: true };
    };
    server = await startServer(deps);
    await fetch(`${baseUrl(server)}/engineering/findings/${FINDING_ID}/approve-self-modification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `actor`/`permissions` injetados pelo corpo NÃO podem virar autoridade.
      body: JSON.stringify({ actor: 'SYSTEM:fake-admin', actorType: 'HUMAN', permissions: ['engineering:approve_self_modification'] }),
    });

    expect(captured.payload.actor).toBe('test-agent');
    expect(captured.payload.actor).not.toBe('SYSTEM:fake-admin');
    // O tipo autenticado é derivado do principal (sessão de usuário ⇒ HUMAN), nunca do corpo.
    expect(captured.payload.authenticatedActorType).toBe('HUMAN');
  });

  test('GOV_HTTP_04 conta de serviço é recusada com 403 (identidade autenticada, não declarada)', async () => {
    const denial = Object.assign(new Error('tipo de ator "SERVICE" não é autoridade legítima'), {
      code: 'SELF_MODIFICATION_APPROVAL_ACTOR_NOT_HUMAN',
    });
    // O principal autenticado é uma conta de SERVIÇO — mesmo enviando actorType=HUMAN no corpo.
    const deps = depsWithApproval({ impl: async () => { throw denial; } });
    deps.requireAuth = (req) => {
      req.tenantId = 'system';
      req.agent = { platformClassification: 'DEVELOPMENT', id: 'svc-1', type: 'service_account' };
      return { valid: true };
    };
    server = await startServer(deps);

    const res = await fetch(`${baseUrl(server)}/engineering/findings/${FINDING_ID}/approve-self-modification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorType: 'HUMAN', governanceChangeApproved: true, governanceChangeReason: 'tentativa' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('SELF_MODIFICATION_APPROVAL_ACTOR_NOT_HUMAN');
    // A autoridade NÃO veio do corpo: o tipo autenticado era SERVICE.
    expect(captured.payload.authenticatedActorType).toBe('SERVICE');
  });

  test('GOV_HTTP_05 recusa de governança tem causa de CLIENTE e código estável (nunca 500)', async () => {
    const denial = Object.assign(new Error('aprovação da missão não equivale a aprovação de MUDANÇA DE GOVERNANÇA'), {
      code: 'GOVERNANCE_CHANGE_APPROVAL_REQUIRED',
      stage: 'EXPLICIT_GOVERNANCE_APPROVAL',
    });
    server = await startServer(depsWithApproval({ impl: async () => { throw denial; } }));

    const res = await fetch(`${baseUrl(server)}/engineering/findings/${FINDING_ID}/approve-self-modification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ governanceChangeApproved: false }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('GOVERNANCE_CHANGE_APPROVAL_REQUIRED');
  });

  test('GOV_HTTP_06 sem a permissão ESPECÍFICA o boundary responde 403 antes de chamar o serviço', async () => {
    server = await startServer(depsWithApproval({ allowed: false }));
    const res = await fetch(`${baseUrl(server)}/engineering/findings/${FINDING_ID}/approve-self-modification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ governanceChangeApproved: true, governanceChangeReason: 'x' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('forbidden');
    expect(captured).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTRATO DE REPRODUÇÃO NA CONFIRMAÇÃO (defeito de boundary eliminado em 2026-10-08).
//
// A rota encaminhava apenas basis/evidence/rootCause. O campo `reproduction` era DESCARTADO aqui,
// embora o serviço já o aceitasse e persistisse. Efeito medido ponta a ponta no finding c2cc1772
// (INC-3B): `finding.reproduction = {}` ⇒ `buildFixTaskContract` monta
// `testCommands = [finding.reproduction.command, ...]` ⇒ fix task nasce com `testCommands = []` ⇒
// em TESTING o Router reprova com `NO_TEST_COMMANDS` DEPOIS do patch ter sido gerado e aplicado
// (2 de 3 tentativas com patch aplicado e ZERO TestRun executado).
//
// Os testes abaixo medem o EFEITO REAL (o contrato de fix task), não apenas o dublê: um dublê que
// "recebe o campo" passaria mesmo se o consumidor continuasse montando a task sem comando.
describe('engineering-missions routes — confirmação de finding encaminha o contrato de reprodução', () => {
  const FINDING_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const REPRO_COMMAND = 'npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern=tests/unit/engineeringMission/missionReplanService.test.js --no-coverage';
  const { buildFixTaskContract } = require('../../engine/engineeringMission/bugFinding');
  let server;

  afterEach(() => {
    if (server) { server.close(); server = null; }
  });

  const findingBase = () => ({
    id: FINDING_ID,
    title: 'fachada de replan nao aplica efeito para HALT + LIVELOCK / BUDGET_EXHAUSTED',
    status: 'SUSPECTED',
    category: 'BUG',
    severity: 'MEDIUM',
    source: 'UNIT_TEST',
    evidence_refs: [],
    affected_subsystems: [],
    reproduction: {},
    fingerprint: 'fp-repro-contract',
  });

  const depsWithConfirm = () => {
    const captured = { id: null, args: null };
    const deps = buildDepsFactory({
      requireAuth: asDevelopment,
      bugFindingService: {
        getFinding: async () => findingBase(),
        confirmFinding: async (id, args) => {
          captured.id = id;
          captured.args = args;
          return {
            finding: { ...findingBase(), ...(args.reproduction ? { reproduction: args.reproduction } : {}) },
            basis: args.basis,
          };
        },
      },
    });
    return { deps, captured };
  };

  const confirm = async (body) => {
    const res = await fetch(`${baseUrl(server)}/engineering/findings/${FINDING_ID}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  test('reproduction de COMANDO atravessa o boundary e produz testCommands não vazio na fix task', async () => {
    const { deps, captured } = depsWithConfirm();
    server = await startServer(deps);

    const res = await confirm({
      basis: 'REPRODUCED_TEST_FAILURE',
      reproduction: { command: REPRO_COMMAND, expect: 'FAIL' },
    });

    expect(res.status).toBe(200);
    expect(captured.args.reproduction).toEqual({ command: REPRO_COMMAND, expect: 'FAIL' });

    // EFEITO REAL: o contrato da correção passa a carregar o comando que era vermelho.
    const contract = buildFixTaskContract({ finding: { ...findingBase(), reproduction: captured.args.reproduction } });
    expect(contract.testCommands).toEqual([REPRO_COMMAND]);

    // CONTROLE do defeito: com o campo perdido, o contrato nasce SEM comando — era este o estado
    // que produzia NO_TEST_COMMANDS em TESTING, depois do patch já aplicado.
    const broken = buildFixTaskContract({ finding: { ...findingBase(), reproduction: {} } });
    expect(broken.testCommands).toEqual([]);
  });

  test('reproduction de INVARIANTE é aceito (plano INVARIANT tem caminho próprio)', async () => {
    const { deps, captured } = depsWithConfirm();
    server = await startServer(deps);

    const reproduction = { invariants: ['HALT+LIVELOCK deve produzir efeito explicito'] };
    const res = await confirm({ basis: 'REPRODUCED_TEST_FAILURE', reproduction });

    expect(res.status).toBe(200);
    expect(captured.args.reproduction).toEqual(reproduction);
  });

  test('reproduction inválido é recusado no boundary (nunca vira plano silenciosamente inútil)', async () => {
    const invalidos = [
      {},
      { command: '   ' },
      { command: 42 },
      { command: null },
      'comando',
      ['comando'],
      { invariants: [] },
      { invariants: 'nao-e-lista' },
    ];
    for (const reproducao of invalidos) {
      const { deps, captured } = depsWithConfirm();
      server = await startServer(deps);

      const res = await confirm({ basis: 'REPRODUCED_TEST_FAILURE', reproduction: reproducao });

      expect(res.status).toBe(200);
      expect(captured.args.reproduction).toBeNull();
      server.close();
      server = null;
    }
  });

  test('confirmar SEM reproduction continua válido (o campo é opcional, não uma exigência nova)', async () => {
    const { deps, captured } = depsWithConfirm();
    server = await startServer(deps);

    const res = await confirm({ basis: 'REPRODUCED_TEST_FAILURE' });

    expect(res.status).toBe(200);
    expect(captured.args.reproduction).toBeNull();
    expect(captured.args.basis).toBe('REPRODUCED_TEST_FAILURE');
  });

  /**
   * PERDA DE POSSE NO MEIO DA OPERAÇÃO — achado da revisão adversarial de 2026-10-27.
   *
   * `FINDING_LEASE_LOST` é condição de CONCORRÊNCIA nomeada e fail-closed, mas não estava no mapa de
   * `handleError`: virava **500 com log de erro** enquanto "lease de outro worker" saía 409. O cliente
   * recebia "erro de servidor" para um conflito de estado real e ia investigar o lugar errado.
   */
  const depsWithConfirmError = (code) => buildDepsFactory({
    requireAuth: asDevelopment,
    bugFindingService: {
      getFinding: async () => findingBase(),
      confirmFinding: async () => { throw Object.assign(new Error(`recusa ${code}`), { code }); },
    },
  });

  test.each([
    ['FINDING_LEASE_LOST'],
    ['FINDING_LEASE_HELD_BY_OTHER_WORKER'],
    ['FINDING_LEASE_MISMATCH'],
    ['FINDING_STATE_CONFLICT'],
  ])('%s no boundary é 409 (conflito de estado), nunca 500', async (code) => {
    server = await startServer(depsWithConfirmError(code));

    const res = await confirm({ basis: 'REPRODUCED_TEST_FAILURE' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(code);
  });
});

describe('resolveAuthenticatedActorType', () => {
  const { resolveAuthenticatedActorType } = require('../../api/modules/engineering-missions/routes');

  test('sessão de usuário autenticado ⇒ HUMAN', () => {
    expect(resolveAuthenticatedActorType({ id: 'u1', username: 'ana' })).toBe('HUMAN');
  });

  test('conta de serviço ⇒ SERVICE (nunca HUMAN)', () => {
    expect(resolveAuthenticatedActorType({ id: 'svc', type: 'service_account' })).toBe('SERVICE');
    expect(resolveAuthenticatedActorType({ id: 'svc', isServiceAccount: true })).toBe('SERVICE');
  });

  test('tipo explícito do principal autenticado prevalece', () => {
    expect(resolveAuthenticatedActorType({ actorType: 'service', id: 'x' })).toBe('service');
  });

  test('principal ausente ⇒ null (fail-closed no serviço)', () => {
    expect(resolveAuthenticatedActorType(null)).toBeNull();
    expect(resolveAuthenticatedActorType({})).toBeNull();
  });
});
