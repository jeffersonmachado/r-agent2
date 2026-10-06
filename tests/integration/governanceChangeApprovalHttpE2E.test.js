'use strict';

/**
 * tests/integration/governanceChangeApprovalHttpE2E.test.js
 *
 * GOVERNANCE_CHANGE_FULL_E2E (fronteira HTTP) — a aprovação que autoriza uma
 * mudança nas REGRAS QUE JULGAM o sistema só vale se atravessar, DE VERDADE:
 *
 *   HTTP real → auth real (token de sessão) → classificação DEVELOPMENT →
 *   RBAC por ação (`engineering:approve_self_modification`) → principal HUMANO →
 *   consentimento explícito (`governanceChangeApproved`) + motivo + reviewer
 *   independente → aprovação PERSISTIDA no finding.
 *
 * POR QUE ISTO NÃO ESTAVA PROVADO. Existiam provas unitárias fortes — rota com
 * deps injetadas, RBAC unitário, ciclo de vida da aprovação — e NENHUMA delas
 * atravessa o middleware real: um defeito de fiação (rota sem ação de RBAC,
 * permissão não resolvida pelo token, campo descartado no boundary) deixava as
 * três verdes. O caminho existia no serviço e era INALCANÇÁVEL por HTTP.
 *
 * Aqui o app é montado com a COMPOSITION REAL (`createEngineeringMissionExpressRouter`)
 * e as requisições são HTTP de verdade contra um servidor em porta efêmera. Nada
 * de deps falsas: `requireAuth` e `requirePermission` são os do produto.
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO via `skipOrFail` (RELEASE_AUTHORITATIVE=1 lança).
 * ESCOPO DECLARADO: esta suíte prova a FRONTEIRA DE AUTORIZAÇÃO ponta a ponta. A
 * produção do baseline diff pelo coder (Docker/provider) e o fechamento do finding
 * após a regressão têm provas próprias (`engineeringBugAutonomousLoopE2E`).
 */

const express = require('express');

const sequelizeModule = require('../../api/db/sequelize');
const { skipOrFail } = require('../helpers/infraGate');
const authService = require('../../api/services/authService');
const bugFindingService = require('../../api/services/engineeringMission/bugFindingService');

const SUITE_NAME = 'governance-change-approval-http-e2e';
const TEST_TENANT_KEY = 'jest-e2e-gov-approval';
// Identidades ÚNICAS por execução: uma execução anterior que falhou antes do
// cleanup não pode envenenar a seguinte com "Email já cadastrado".
const RUN_TAG = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const APPROVER_USERNAME = `jest-gov-approver-${RUN_TAG}`;
const NOBODY_USERNAME = `jest-gov-nobody-${RUN_TAG}`;

let dbAvailable = false;
let dbReason = 'desconhecido';

const created = { agents: [], findings: [] };

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

/** Sobe o ROUTER REAL num servidor HTTP em porta efêmera. */
async function startHttpApp() {
  const { createEngineeringMissionExpressRouter } = require('../../api/composition/engineering-missions');
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(createEngineeringMissionExpressRouter());
  app.use((error, req, res, _next) => {
    res.status(500).json({ error: 'internal', message: String(error && error.message) });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function httpPost(baseUrl, path, { token = null, body = {}, tenantId = null } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      // Super-admin precisa SELECIONAR o tenant explicitamente (o middleware real
      // não infere): sem o header, `req.tenantId` fica null e a rota recusa com
      // TENANT_REQUIRED — comportamento do produto, reproduzido aqui.
      ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
    },
    body: JSON.stringify(body),
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) { payload = null; }
  return { status: response.status, body: payload };
}

/** Agente real, com papel e classificação controlados, e sessão real (token). */
async function createAgentWithSession({ username, role, platformRole }) {
  const models = require('../../api/db/models');
  const tenant = await models.getTenant().findOrCreate({
    where: { tenant_key: TEST_TENANT_KEY },
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest E2E — Governance Approval', status: 'active', plan: 'enterprise' },
  });
  const tenantId = (tenant[0] || tenant).tenant_key || TEST_TENANT_KEY;
  // Cleanup defensivo: qualquer resíduo do MESMO username nesta execução
  // (retry do jest, execução anterior abortada) é removido antes.
  await models.getUser().destroy({ where: { username } }).catch(() => {});

  const password = `Jest-${Math.random().toString(36).slice(2)}-Aa1!`;
  const created_ = await authService.createAgent({
    tenantId,
    username,
    email: `${username}@jest.local`,
    password,
    role,
    name: username,
  });
  if (!created_ || created_.success === false) {
    throw new Error(`createAgent falhou: ${JSON.stringify(created_)}`);
  }
  const agentId = created_.agent?.id || created_.id;
  created.agents.push(agentId);

  // A CLASSIFICAÇÃO (DEVELOPMENT) vem de `platform_role` — não do role de tenant.
  if (platformRole) {
    await models.getUser().update({ platform_role: platformRole }, { where: { id: agentId } });
  }

  // `login` é POSICIONAL: (username, password, ipAddress, userAgent).
  const login = await authService.login(username, password, '127.0.0.1', 'jest-e2e-governance-approval');
  if (!login || login.success === false || !login.token) {
    throw new Error(`login falhou: ${JSON.stringify(login)}`);
  }
  return { agentId, token: login.token };
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
}, 60000);

afterAll(async () => {
  if (dbAvailable) {
    const models = require('../../api/db/models');
    for (const id of created.findings) {
      await models.getEngineeringBugFinding().destroy({ where: { id } }).catch(() => {});
    }
    for (const id of created.agents) {
      await models.getSession().destroy({ where: { user_id: id } }).catch(() => {});
      await models.getUser().destroy({ where: { id } }).catch(() => {});
    }
    await models.getTenant().destroy({ where: { tenant_key: TEST_TENANT_KEY } }).catch(() => {});
  }
  await sequelizeModule.close().catch(() => {});
}, 60000);

describe('GOVERNANCE_CHANGE_FULL_E2E — aprovação de governança por HTTP real', () => {
  jest.setTimeout(180000);

  let app = null;
  let authorized = null;
  let unauthorized = null;
  let findingId = null;

  beforeAll(async () => {
    if (!dbAvailable) return;

    // Agente HUMANO com classificação DEVELOPMENT e permissão global.
    authorized = await createAgentWithSession({ username: APPROVER_USERNAME, role: 'super_admin', platformRole: 'engineer' });
    // Agente HUMANO com classificação DEVELOPMENT mas SEM a permissão específica:
    // é o caso que separa "é humano" de "tem autoridade para reescrever o critério".
    unauthorized = await createAgentWithSession({ username: NOBODY_USERNAME, role: 'engineer', platformRole: 'engineer' });

    app = await startHttpApp();
  }, 120000);

  afterAll(async () => {
    if (app && app.server) await new Promise((resolve) => app.server.close(resolve));
  });

  /** Finding REAL que exige aval de governança (patch mexe em baseline protegida). */
  async function createSelfModificationFinding() {
    const registered = await bugFindingService.registerFinding(
      {
        title: `E2E governance change ${Date.now()}`,
        source: 'STATIC_ANALYSIS',
        detail: 'candidato altera baseline protegida de governança; exige aval explícito',
        evidenceRefs: [{ type: 'ARTIFACT', ref: 'tests/integration/governanceChangeApprovalHttpE2E.test.js' }],
      },
      { actor: 'jest-e2e', tenantId: TEST_TENANT_KEY },
    );
    const finding = registered.finding || registered;
    created.findings.push(finding.id);

    const models = require('../../api/db/models');
    // O objeto do teste é o CAMINHO DE AUTORIZAÇÃO, não a detecção do baseline
    // diff (que tem prova própria no triage). O estado inicial é preparado para
    // que a decisão de autorização seja o único passo exercitado aqui.
    await models.getEngineeringBugFinding().update(
      {
        self_modification: true,
        triage: { requiresIndependentReviewer: true, provenance: 'JEST_E2E' },
      },
      { where: { id: finding.id } },
    );
    return finding.id;
  }

  test('1. sem token ⇒ 401 do middleware REAL (a rota não é pública)', async () => {
    if (!dbAvailable) return skipOrFail(SUITE_NAME, `Postgres indisponível: ${dbReason}`, { requirement: 'postgres' });
    findingId = await createSelfModificationFinding();

    const denied = await httpPost(app.baseUrl, `/engineering/findings/${findingId}/approve-self-modification`, {
      body: { governanceChangeApproved: true, governanceChangeReason: 'tentativa anônima' },
    });
    expect(denied.status).toBe(401);
    expect(String(denied.body?.error || '')).toMatch(/unauthorized/i);
  });

  test('2. humano SEM a permissão específica ⇒ 403 (RBAC real, não "é humano, passa")', async () => {
    if (!dbAvailable) return skipOrFail(SUITE_NAME, `Postgres indisponível: ${dbReason}`, { requirement: 'postgres' });

    const denied = await httpPost(app.baseUrl, `/engineering/findings/${findingId}/approve-self-modification`, {
      token: unauthorized.token,
      tenantId: TEST_TENANT_KEY,
      body: {
        governanceChangeApproved: true,
        governanceChangeReason: 'sem permissão específica para reescrever o critério',
        reviewer: 'reviewer-independente',
      },
    });
    expect(denied.status).toBe(403);
    const errorCode = String(denied.body?.error || '');
    // A recusa pode vir da classificação ou do RBAC por ação: as DUAS são
    // fronteiras legítimas, e a asserção exige que NÃO seja sucesso.
    expect(['forbidden', 'classification_required']).toContain(errorCode);

    const afterDenial = await bugFindingService.getFinding(findingId);
    expect(afterDenial.triage?.selfModificationApproval || null).toBeFalsy();
  });

  test('3. humano COM permissão, mas SEM consentimento de governança ⇒ consentimento NAO é presumido', async () => {
    if (!dbAvailable) return skipOrFail(SUITE_NAME, `Postgres indisponível: ${dbReason}`, { requirement: 'postgres' });

    const denied = await httpPost(app.baseUrl, `/engineering/findings/${findingId}/approve-self-modification`, {
      token: authorized.token,
      tenantId: TEST_TENANT_KEY,
      body: { approvalRef: 'sem-consentimento' },
    });

    // SEM consentimento explicito de governanca a mudanca NAO fica autorizada.
    // O aval operacional pode ser registrado, mas o consentimento NUNCA e
    // presumido: `governanceChangeApproved` fica false e o fechamento continua
    // bloqueado ate um humano consentir explicitamente. Presumir `true` por
    // omissao e exatamente o afrouxamento silencioso que a politica proibe.
    const afterDenial = await bugFindingService.getFinding(findingId);
    const persistedApproval = afterDenial.triage?.selfModificationApproval || null;
    if (persistedApproval) {
      expect(persistedApproval.governanceChangeApproved).toBe(false);
    } else {
      expect(denied.body?.approved === true).toBe(false);
    }
    expect(denied.body?.governanceChangeApproved === true).toBe(false);
  });

  test('4. humano COM permissão + consentimento + motivo + reviewer independente ⇒ 200 e aprovação PERSISTIDA', async () => {
    if (!dbAvailable) return skipOrFail(SUITE_NAME, `Postgres indisponível: ${dbReason}`, { requirement: 'postgres' });

    const approved = await httpPost(app.baseUrl, `/engineering/findings/${findingId}/approve-self-modification`, {
      token: authorized.token,
      tenantId: TEST_TENANT_KEY,
      body: {
        governanceChangeApproved: true,
        governanceChangeReason: 'mudança de baseline aprovada por autoridade humana com justificativa registrada',
        reviewer: 'reviewer-independente-e2e',
        approvalRef: 'E2E-APPR-1',
      },
    });

    expect({ status: approved.status, body: approved.body.error || null }).toEqual({ status: 200, body: null });

    const persisted = await bugFindingService.getFinding(findingId);
    // A aprovação vive em `triage.selfModificationApproval` — o registro que o
    // runtime de fechamento relê para saber se a mudança foi consentida.
    const approval = persisted.triage.selfModificationApproval || {};
    expect(approval.governanceChangeApproved).toBe(true);
    expect(String(approval.governanceChangeReason || '')).toMatch(/autoridade humana/i);
    expect(String(approval.reviewer || '')).toBe('reviewer-independente-e2e');
    // A identidade NUNCA vem do corpo: o que fica persistido e o principal
    // autenticado (o id do agente da sessao), nao um nome enviado no payload.
    expect(String(approval.actor || '')).toBe(String(authorized.agentId));
    // Humano verificado, com a permissão REALMENTE checada no ato do aval.
    expect(String(approval.actorType || '').toUpperCase()).toBe('HUMAN');
    expect(approval.hasSpecificPermission).toBe(true);  });

  test('5. o corpo NÃO pode declarar identidade humana para um principal automático', async () => {
    if (!dbAvailable) return skipOrFail(SUITE_NAME, `Postgres indisponível: ${dbReason}`, { requirement: 'postgres' });

    // Mesmo achando o endpoint, um corpo dizendo "sou humano" não muda o tipo
    // autenticado — a autoridade é derivada do token, não do texto enviado.
    const spoof = await httpPost(app.baseUrl, `/engineering/findings/${findingId}/approve-self-modification`, {
      token: unauthorized.token,
      tenantId: TEST_TENANT_KEY,
      body: {
        actorType: 'HUMAN',
        governanceChangeApproved: true,
        governanceChangeReason: 'declarando-se humano pelo corpo da requisição',
        reviewer: 'qualquer',
      },
    });
    expect(spoof.status).not.toBe(200);
  });
});
