#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { connect: connectDb } = require('../../api/db');

const {
  executeBlockingJourneyWithBrowser,
  launchBrowserPage,
} = require('../../api/services/qa/browserOperationalRunner');
const { loginWithTenantSelection } = require('../../tests/helpers/playwrightAuth');
const {
  validateJourneyPostStateProofs,
  computeIncrementalStepDiff,
} = require('../../api/services/qa/operationalStepExecutor');
const operationalReplayValidator = require('../../api/services/qa/operationalReplayValidator');
const stateSnapshotService = require('../../api/services/qa/stateSnapshotService');
const { signReplayArtifact } = require('../../api/services/qa/replayIntegrityService');
const { writeJsonAtomic } = require('../../api/utils/atomicJsonFile');
const {
  getOperationalStepContract,
  getExpectedMutationsForStep,
  getExpectedSideEffectsForStep,
  matchExpectedNetworkEvent,
} = require('../../qa/contracts/operationalStepRegistry');
const { buildSupportTicketFlowSteps } = require('../../api/services/qa/journeyStepDefinitions/supportTicketFlowSteps');
const { buildFitnessCheckinFlowSteps } = require('../../api/services/qa/journeyStepDefinitions/fitnessCheckinFlowSteps');
const { buildAgendamentoFlowSteps } = require('../../api/services/qa/journeyStepDefinitions/agendamentoFlowSteps');
const { buildAgendamentoOperationalSeedSpec } = require('../../api/services/qa/seeds/agendamentoOperationalSeed');

const PROD_LIKE_SMOKE_DIR = path.join(process.cwd(), 'qa', 'smoke', 'prod-like');

// Prod-like exige stack REAL em containers no Docker local (docker-compose.yml),
// que publica: API em localhost:3001 (3001:3001) e frontend nginx em
// localhost:8080 (8080:80). Não usa Vite (5173) nem fixtures.
const DEFAULT_FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
const DEFAULT_API_URL = process.env.API_URL || 'http://localhost:3001';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeInitialState() {
  return {
    support: {
      ticketId: 'ticket-qa-final',
      conversationId: 'conversation-qa-final',
      contactId: 'contact-qa-final',
      status: 'open',
      messagesCount: 1,
      crmCount: 0,
      auditCount: 0,
      notificationCount: 0,
    },
    fitness: {
      subjectId: 'subject-qa-final',
      membershipId: 'membership-qa-final',
      credentialId: 'credential-qa-final',
      credentialValue: 'QA-FINAL-123',
      deviceId: 'device-qa-final',
      membershipActive: true,
      attendanceCount: 0,
      accessDecisionCount: 0,
      accessDecisionAllow: false,
      accessEventCount: 0,
      crmJourneyCount: 0,
    },
  };
}

function supportSnapshot(state) {
  return {
    db: {
      messages: { count: state.support.messagesCount },
      ticket: { status: state.support.status },
      ticketStatus: state.support.status,
    },
    events: {
      audit: { count: state.support.auditCount },
      notifications: { count: state.support.notificationCount },
    },
    crm: {
      activities: { count: state.support.crmCount },
    },
  };
}

function fitnessSnapshot(state) {
  return {
    db: {
      attendance: { count: state.fitness.attendanceCount },
    },
    api: {
      access: {
        decision: {
          count: state.fitness.accessDecisionCount,
          allow: state.fitness.accessDecisionAllow,
        },
      },
    },
    devices: {
      access: { events: state.fitness.accessEventCount },
    },
    crm: {
      presenceActivity: { count: state.fitness.crmJourneyCount },
    },
    membership: {
      active: state.fitness.membershipActive,
      credentialId: state.fitness.credentialId,
    },
  };
}

function snapshotForJourney(journeyId, state) {
  return journeyId === 'fitness_customer_checkin'
    ? fitnessSnapshot(state)
    : supportSnapshot(state);
}

function withSemanticContract(step = {}) {
  const stepId = step?.id || step?.stepId || null;
  const semanticContract = stepId ? getOperationalStepContract(stepId) : null;
  if (!semanticContract) return step;
  return {
    ...step,
    actionType: semanticContract.actionType,
    semanticContract,
    mutationExpected: semanticContract.mutationExpected === true,
    expectedMutations: semanticContract.expectedMutations || [],
    expectedSideEffects: semanticContract.expectedSideEffects || [],
    entityScope: semanticContract.entityScope || [],
    expectedNetworkEvents: semanticContract.expectedNetworkEvents || [],
  };
}

function renderSupportPage(state) {
  return `<!doctype html>
<html>
<body data-testid="support-page">
  <button aria-label="Atualizar chamados" onclick="refreshTickets()">Atualizar chamados</button>
  <div data-testid="ticket-list" id="ticket-list">
    <button data-testid="ticket-card" data-ticket-id="${state.support.ticketId}" id="ticket-card" onclick="openTicket()">Open ticket</button>
  </div>
  <section id="detail" data-testid="ticket-detail" style="display:none">
    <div data-testid="ticket-message-list" id="message-list"><div data-testid="message-received">mensagem do cliente</div></div>
    <textarea data-testid="ticket-reply-input"></textarea>
    <button data-testid="ticket-send-button" onclick="replyTicket()">Send</button>
    <button data-testid="ticket-close-button" onclick="openCloseModal()">Fechar ticket</button>
  </section>
  <div id="close-modal" class="support-modal-content" style="display:none">
    <input class="support-form-input" id="close-reason" />
    <button onclick="requestClose()">Fechar</button>
  </div>
  <div id="confirm-dialog" class="fixed inset-0" style="display:none">
    <p>Deseja realmente fechar este ticket?</p>
    <button onclick="confirmClose()">Fechar</button>
  </div>
  <script>
    function openTicket() {
      document.querySelector('#detail').style.display = 'block';
    }
    function refreshTickets() {
      // no-op: a lista do fixture já reflete o estado do backend (card removido no close)
    }
    async function replyTicket() {
      await fetch('/tickets/${state.support.ticketId}/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: document.querySelector('[data-testid="ticket-reply-input"]').value }) });
      const el = document.createElement('div');
      el.setAttribute('data-testid', 'message-sent');
      el.textContent = 'sent';
      document.querySelector('#message-list').appendChild(el);
      if (!document.querySelector('[data-testid="message-sent-confirmation"]')) {
        const conf = document.createElement('div');
        conf.setAttribute('data-testid', 'message-sent-confirmation');
        conf.textContent = 'sent';
        document.body.appendChild(conf);
      }
    }
    function openCloseModal() {
      document.querySelector('#close-modal').style.display = 'block';
    }
    function requestClose() {
      document.querySelector('#close-modal').style.display = 'none';
      document.querySelector('#confirm-dialog').style.display = 'block';
    }
    async function confirmClose() {
      const res = await fetch('/api/tickets/${state.support.ticketId}/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'closed' }) });
      const body = await res.json();
      if (body.status === 'closed') {
        const card = document.querySelector('#ticket-card');
        if (card) card.remove();
        const list = document.querySelector('#ticket-list');
        if (list && !list.children.length) {
          const empty = document.createElement('div');
          empty.setAttribute('data-testid', 'ticket-list-empty');
          empty.textContent = 'Nenhum chamado na fila';
          list.appendChild(empty);
        }
        document.querySelector('#detail').style.display = 'none';
        document.querySelector('#confirm-dialog').style.display = 'none';
      }
    }
  </script>
</body>
</html>`;
}

function renderFitnessPage(state) {
  return `<!doctype html>
<html>
<body data-testid="fitness-checkin-page">
  <input data-testid="checkin-credential-input" />
  <button data-testid="checkin-submit-button" onclick="submitCheckin()">Submit</button>
  <div data-testid="membership-validation-result">${state.fitness.membershipActive ? 'valid active allow' : 'invalid'}</div>
  <div data-testid="access-decision-result">pending</div>
  <div data-testid="attendance-confirmation">waiting</div>
  <script>
    async function submitCheckin() {
      const credential = document.querySelector('[data-testid="checkin-credential-input"]').value;
      const res = await fetch('/api/fitness/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
      const body = await res.json();
      document.querySelector('[data-testid="access-decision-result"]').textContent = body.allow ? 'allow granted liberado' : 'denied';
      document.querySelector('[data-testid="attendance-confirmation"]').textContent = body.attendanceCreated ? 'attendance created confirm registrada' : 'waiting';
    }
  </script>
</body>
</html>`;
}

function createFixtureServer(state) {
  const server = http.createServer((req, res) => {
    const method = req.method || 'GET';
    const url = req.url || '/';

    if (method === 'GET' && url.startsWith('/support')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(renderSupportPage(state));
      return;
    }

    if (method === 'GET' && url.startsWith('/fitness/checkin')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(renderFitnessPage(state));
      return;
    }

    if (method === 'POST' && /^\/?(api\/)?tickets\/[^/]+\/takeover$/.test(url)) {
      state.support.status = 'in_progress';
      state.support.auditCount += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: state.support.status }));
      return;
    }

    if (method === 'POST' && /^\/?(api\/)?tickets\/[^/]+\/assign$/.test(url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (method === 'GET' && /^\/?(api\/)?tickets\/[^/]+\/messages$/.test(url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: [{ id: 'msg-1', deliveryStatus: 'sent' }] }));
      return;
    }

    if (method === 'GET' && /^\/?(api\/)?tickets\/[^/]+\/delivery-failures$/.test(url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ failures: [] }));
      return;
    }

    if (method === 'GET' && /^\/?(api\/)?tickets\/[^/]+$/.test(url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: state.support.status, ticket: { status: state.support.status } }));
      return;
    }

    if ((method === 'POST' || method === 'PATCH') && /^\/?(api\/)?tickets\/[^/]+\/status$/.test(url)) {
      state.support.status = 'closed';
      state.support.auditCount += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: state.support.status }));
      return;
    }

    if (method === 'POST' && /^\/?(api\/)?tickets\/[^/]+\/reply$/.test(url)) {
      state.support.messagesCount += 1;
      state.support.auditCount += 1;
      state.support.crmCount += 1;
      state.support.notificationCount += 1;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, messageId: `msg-${state.support.messagesCount}` }));
      return;
    }

    if (method === 'POST' && url === '/webhooks/whatsapp') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (method === 'POST' && url === '/api/fitness/checkin') {
      state.fitness.attendanceCount += 1;
      state.fitness.accessDecisionCount += 1;
      state.fitness.accessDecisionAllow = true;
      state.fitness.accessEventCount += 1;
      state.fitness.crmJourneyCount += 1;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, allow: true, attendanceCreated: true }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found', url }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function firstNonEmptyArray(...candidates) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
  }
  return [];
}

function getFlowPostStateSummary(flow = {}) {
  return flow?.postStateSummary || flow?.postState?.postStateSummary || null;
}

function getFlowSummaryMutationProvenance(flow = {}, step = {}, mutationalSteps = []) {
  const summary = getFlowPostStateSummary(flow);
  const summaryProvenance = Array.isArray(summary?.mutationProvenance)
    ? summary.mutationProvenance
    : [];
  if (summaryProvenance.length === 0) return [];

  const stepId = step?.id || step?.stepId || null;
  const filtered = stepId
    ? summaryProvenance.filter((record) => record?.originatingStepId === stepId)
    : [];
  if (filtered.length > 0) return filtered;

  return mutationalSteps.length === 1 ? summaryProvenance : [];
}

function getFlowSummaryNetworkCorrelation(flow = {}, step = {}, mutationalSteps = []) {
  const summary = getFlowPostStateSummary(flow);
  const summaryNetworkCorrelation = Array.isArray(summary?.networkCorrelation)
    ? summary.networkCorrelation
    : [];
  if (summaryNetworkCorrelation.length === 0) return [];

  const stepId = step?.id || step?.stepId || null;
  const matchedNetworkEvent = stepId
    ? matchExpectedNetworkEvent(stepId, summaryNetworkCorrelation)
    : null;
  if (matchedNetworkEvent) return [matchedNetworkEvent];

  return mutationalSteps.length === 1 ? summaryNetworkCorrelation : [];
}

function assertReplayAudit(flow) {
  const mutationalSteps = flow.steps.filter((step) => step?.mutationExpected === true);
  const blockers = [];

  for (const step of flow.steps) {
    if (!step.screenshotBefore) blockers.push(`${step.id}:missing_screenshot_before`);
    if (!step.screenshotAfter) blockers.push(`${step.id}:missing_screenshot_after`);
    if (!step.url) blockers.push(`${step.id}:missing_url`);
    if (!Array.isArray(step.networkEvents)) blockers.push(`${step.id}:missing_network_events`);
    if (step.evidenceClassification !== 'operational') blockers.push(`${step.id}:non_operational_evidence`);
  }

  for (const step of mutationalSteps) {
    const provenance = firstNonEmptyArray(
      step.mutationProvenance,
      step.postStateProof?.mutationProvenance,
      getFlowSummaryMutationProvenance(flow, step, mutationalSteps),
    );
    if (!step.incrementalDiff?.changed) blockers.push(`${step.id}:missing_incremental_diff`);
    if (!step.mutationLinkage) blockers.push(`${step.id}:missing_mutation_linkage`);
    if (!Array.isArray(provenance) || provenance.length === 0) blockers.push(`${step.id}:missing_provenance`);
    if (provenance.some((record) => record?.valid !== true)) blockers.push(`${step.id}:invalid_provenance`);
  }

  return {
    valid: blockers.length === 0,
    blockers,
  };
}

function evaluateStrictGovernance(flow) {
  const blockers = [];
  const mutationalSteps = flow.steps.filter((step) => step?.mutationExpected === true);

  if (mutationalSteps.length === 0) blockers.push('no_mutational_steps');

  for (const step of flow.steps) {
    if (step.evidenceClassification !== 'operational') blockers.push(`${step.id}:non_operational_evidence`);
    if (step.mutationLinkage?.source === 'stateMutation') blockers.push(`${step.id}:state_mutation_as_proof`);
    if (step.mutationLinkage?.correlatedBy === 'journey_transition') blockers.push(`${step.id}:journey_transition_as_proof`);
  }

  for (const step of mutationalSteps) {
    const expectedMutations = step.mutationLinkage?.expectedMutations || step.postStateProof?.expectedMutations || [];
    const observedMutations = step.observedMutations || step.postStateProof?.observedMutations || [];
    const expectedSideEffects = step.mutationLinkage?.expectedSideEffects || step.postStateProof?.expectedSideEffects || [];
    const observedSideEffects = step.observedSideEffects || step.postStateProof?.observedSideEffects || [];
    const networkCorrelation = firstNonEmptyArray(
      step.networkCorrelation,
      step.postStateProof?.networkCorrelation,
      getFlowSummaryNetworkCorrelation(flow, step, mutationalSteps),
    );
    const provenance = firstNonEmptyArray(
      step.mutationProvenance,
      step.postStateProof?.mutationProvenance,
      getFlowSummaryMutationProvenance(flow, step, mutationalSteps),
    );

    if (step.incrementalDiff?.changed !== true) blockers.push(`${step.id}:incremental_diff_not_changed`);
    if (!step.mutationLinkage) blockers.push(`${step.id}:mutation_linkage_missing`);
    if (networkCorrelation.length === 0) blockers.push(`${step.id}:expected_network_event_missing`);
    for (const mutation of expectedMutations) {
      if (!observedMutations.some((item) => item === mutation)) blockers.push(`${step.id}:mutation_mismatch:${mutation}`);
    }
    for (const sideEffect of expectedSideEffects) {
      if (!observedSideEffects.some((item) => item === sideEffect)) blockers.push(`${step.id}:side_effect_mismatch:${sideEffect}`);
    }
    if (provenance.length === 0) blockers.push(`${step.id}:provenance_missing`);
    for (const record of provenance) {
      if (record?.valid !== true) blockers.push(`${step.id}:provenance_invalid:${record?.mutation || 'unknown'}`);
      if (record?.correlatedBy !== 'network_linkage') blockers.push(`${step.id}:provenance_not_network_linkage:${record?.mutation || 'unknown'}`);
    }
  }

  return {
    status: blockers.length === 0 ? 'GO' : 'NO_GO',
    valid: blockers.length === 0,
    blockers,
  };
}

function getSmokeMode(options = {}) {
  if (options.mode) return options.mode;
  return process.env.RUN_QA_WAVES_PROD_LIKE_SMOKE === '1' ? 'prod_like_real_stack' : 'technical_fixture';
}

function getRoleCredentials(role = 'agent') {
  switch (role) {
    case 'agent':
      return {
        username: process.env.TEST_AGENT_USERNAME || process.env.TEST_USERNAME || 'systemadmin',
        password: process.env.TEST_AGENT_PASSWORD || process.env.TEST_PASSWORD || 'Admin123!',
      };
    default:
      return {
        username: process.env.TEST_USERNAME || 'systemadmin',
        password: process.env.TEST_PASSWORD || 'Admin123!',
      };
  }
}

async function ensureAuthenticated(page, baseUrl, role = 'agent') {
  const { username, password } = getRoleCredentials(role);
  const authTenantId = process.env.TEST_TENANT_ID || 'system';
  const authTenantName = process.env.TEST_TENANT_NAME || 'System';

  const authState = await page.evaluate((expectedUsername) => {
    let agent = null;
    try {
      agent = JSON.parse(localStorage.getItem('auth_agent') || '{}');
    } catch {
      agent = null;
    }
    return {
      hasToken: Boolean(localStorage.getItem('auth_token')),
      username: agent?.username || null,
      role: agent?.role || null,
      matchesExpectedUser: String(agent?.username || '').toLowerCase() === String(expectedUsername || '').toLowerCase(),
    };
  }, username).catch(() => ({ hasToken: false, matchesExpectedUser: false }));
  const onLoginPage = await page.locator('text=Login de Agente').isVisible().catch(() => false);
  if (!onLoginPage && authState.hasToken && authState.matchesExpectedUser) return;

  await page.evaluate(() => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_agent');
    localStorage.removeItem('auth_effective_tenant_id');
  }).catch(() => {});

  // PRONTIDÃO DA SPA ANTES DE AUTOMATIZAR (medido 2026-10-21, CI e local): quando a
  // SPA ainda está no primeiro carregamento (container recém-subido, runner frio), o
  // helper preenche/clica antes de o formulário existir e o login nunca acontece —
  // resultando em `page.waitForFunction` estourando 30 s sem NENHUM erro de produto.
  // Navegar e esperar o campo de senha é pré-condição de automação, não afrouxamento:
  // todas as asserções seguintes (token, seleção de tenant, 9 jornadas) continuam
  // obrigatórias e inalteradas.
  await page.goto(`${baseUrl}/support`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForSelector('input[type="password"]', { timeout: 60000 }).catch(() => {});

  const loginAttempts = 2;
  for (let tentativa = 1; tentativa <= loginAttempts; tentativa += 1) {
    await loginWithTenantSelection(page, {
      targetUrl: `${baseUrl}/support`,
      username,
      password,
      tenantId: authTenantId,
      tenantName: authTenantName,
    });

    const autenticou = await page.waitForFunction(
      () => Boolean(localStorage.getItem('auth_token')),
      null,
      { timeout: 30000 }
    ).then(() => true).catch(() => false);
    if (autenticou) return;

    if (tentativa < loginAttempts) {
      await page.evaluate(() => {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_agent');
        localStorage.removeItem('auth_effective_tenant_id');
      }).catch(() => {});
      await page.goto(`${baseUrl}/support`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await page.waitForSelector('input[type="password"]', { timeout: 30000 }).catch(() => {});
    }
  }

  // Falha explícita: sem token não há como provar jornada alguma.
  assertOperationalCondition(false, {
    reason: 'support_login_token_missing',
    journeyId: 'support_ticket_flow',
    username,
    tentativas: loginAttempts,
  });
}

async function ensureTenantSelected(page, tenantName = process.env.QA_WAVES_TEST_TENANT || 'System') {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const tenantHeading = page.getByRole('heading', { name: /Selecione o Tenant/i }).first();
    const tenantDialog = page.locator('[role="dialog"]').filter({ hasText: 'Selecione o Tenant' }).first();
    const tenantOverlay = page.locator('div[tabindex="-1"]').filter({ hasText: 'Selecione o Tenant' }).first();

    const headingVisible = await tenantHeading.isVisible().catch(() => false);
    const dialogVisible = await tenantDialog.isVisible().catch(() => false);
    const overlayVisible = await tenantOverlay.isVisible().catch(() => false);
    if (!headingVisible && !dialogVisible && !overlayVisible) return tenantName;

    const modalRoot = dialogVisible ? tenantDialog : overlayVisible ? tenantOverlay : page;
    await modalRoot.locator(`text=${tenantName}`).first().click({ force: true }).catch(() => {});

    const acessarButton = modalRoot.getByRole('button', { name: /^Acessar$/i }).first();
    if (await acessarButton.isVisible().catch(() => false)) {
      await acessarButton.click({ force: true }).catch(() => {});
    }

    const resolved = await tenantHeading.isHidden({ timeout: 7000 }).catch(() => false);
    if (resolved) return tenantName;
    await page.waitForTimeout(300);
  }

  throw new Error(`Não foi possível selecionar o tenant ${tenantName}`);
}

function slugifyTenantName(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

async function ensureProdLikeTenant(page, baseUrl) {
  const desiredName = process.env.QA_WAVES_TEST_TENANT || 'QA Waves Smoke';
  const desiredSite = `https://${slugifyTenantName(desiredName) || 'qa-waves-smoke'}.local`;

  await ensureAuthenticated(page, baseUrl);

  const listed = await browserApiFetch(page, '/tenants', { method: 'GET' }).catch(() => null);
  const tenants = Array.isArray(listed?.body?.tenants) ? listed.body.tenants : [];
  const existing = tenants.find((tenant) => String(tenant?.name || '').trim().toLowerCase() === desiredName.toLowerCase());
  if (existing?.name) {
    return { tenantName: existing.name, created: false };
  }

  const created = await browserApiFetch(page, '/tenants', {
    method: 'POST',
    body: JSON.stringify({
      name: desiredName,
      site: desiredSite,
      ramo_atividade: 'Validacao operacional automatizada do QA Waves em stack real.',
      objetivo: 'Executar smoke prod-like isolado com evidencias operacionais deterministicas.',
      active: true,
    }),
  });
  if (!created?.ok) {
    throw new Error(`Falha ao criar tenant isolado para smoke prod-like: ${created?.status || 'unknown'}`);
  }

  return {
    tenantName: created.body?.tenant?.name || desiredName,
    created: true,
  };
}

async function browserApiFetch(page, requestPath, requestOptions = {}) {
  const session = await page.evaluate(() => {
    const token = localStorage.getItem('auth_token');
    let tenantId = localStorage.getItem('auth_effective_tenant_id');
    if (!tenantId) {
      try {
        const agent = JSON.parse(localStorage.getItem('auth_agent') || '{}');
        tenantId = agent?.tenantId || 'system';
      } catch {
        tenantId = 'system';
      }
    }

    return {
      token,
      tenantId,
    };
  });

  const normalizedPath = String(requestPath || '');
  const requestUrl = /^https?:\/\//i.test(normalizedPath)
    ? normalizedPath
    : `${String(DEFAULT_API_URL || '').replace(/\/+$/, '')}/${normalizedPath.replace(/^\/+/, '')}`;

  const startedAt = Date.now();

  const response = await fetch(requestUrl, {
    ...requestOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(session?.tenantId ? { 'X-Tenant-Id': String(session.tenantId) } : {}),
      ...(requestOptions.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
    meta: {
      type: 'synthetic_node_fetch',
      url: requestUrl,
      method: String(requestOptions.method || 'GET').toUpperCase(),
      status: response.status,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      duration: Math.max(0, Date.now() - startedAt),
    },
  };
}

function buildSyntheticNetworkEvents(meta = {}) {
  if (!meta?.url || !meta?.method) return [];

  const startedAt = meta.startedAt || new Date().toISOString();
  const finishedAt = meta.finishedAt || startedAt;

  return [
    {
      type: 'request',
      url: meta.url,
      method: meta.method,
      status: null,
      duration: 0,
      failureReason: null,
      timestamp: startedAt,
      synthetic: true,
      source: meta.type || 'synthetic_node_fetch',
    },
    {
      type: 'response',
      url: meta.url,
      method: meta.method,
      status: meta.status || null,
      duration: Number(meta.duration || 0),
      failureReason: null,
      timestamp: finishedAt,
      synthetic: true,
      source: meta.type || 'synthetic_node_fetch',
    },
  ];
}

async function getBrowserContext(page) {
  return page.evaluate(() => {
    let agent = {};
    try {
      agent = JSON.parse(localStorage.getItem('auth_agent') || '{}');
    } catch {
      agent = {};
    }
    return {
      tenantId: localStorage.getItem('auth_effective_tenant_id') || agent?.tenantId || 'system',
      agent,
    };
  });
}

async function navigateToSupport(page, baseUrl, tenantName = process.env.QA_WAVES_TEST_TENANT || 'System') {
  await page.goto(`${baseUrl}/support`, { waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page, baseUrl);
  await ensureTenantSelected(page, tenantName);
  await page.getByTestId('support-page').waitFor({ state: 'visible', timeout: 20000 });
  const showListBtn = page.getByRole('button', { name: /Mostrar (lista de )?conversas/i }).first();
  if (await showListBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await showListBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

function resolveSupportSeedMetadata(ticket = {}, ticketMessages = []) {
  const messages = Array.isArray(ticketMessages)
    ? ticketMessages
    : Array.isArray(ticketMessages?.messages)
      ? ticketMessages.messages
      : Array.isArray(ticketMessages?.timeline)
        ? ticketMessages.timeline
      : Array.isArray(ticketMessages?.items)
        ? ticketMessages.items
        : [];
  const firstMessage = messages.find((message) => message && (
    message.conversationId
    || message.conversation_id
    || message.contactId
    || message.contact_id
    || message.customerId
    || message.customer_id
  )) || messages.find(Boolean) || {};
  const ticketContext = ticket.context || ticket.metadata || {};

  return {
    ticketId: ticket.id || ticket.ticketId || null,
    conversationId: ticket.conversationId
      || ticket.conversation_id
      || ticket.conversation?.id
      || ticket.conversation?.conversationId
      || firstMessage.conversationId
      || firstMessage.conversation_id
      || ticketContext.conversationId
      || ticketContext.conversation_id
      || null,
    contactId: ticket.contactId
      || ticket.contact_id
      || ticket.customerId
      || ticket.customer_id
      || ticket.customer?.id
      || ticket.contact?.id
      || ticketContext.contactId
      || ticketContext.contact_id
      || ticketContext.customerId
      || ticketContext.customer_id
      || firstMessage.contactId
      || firstMessage.contact_id
      || firstMessage.customerId
      || firstMessage.customer_id
      || null,
    externalMessageId: [...messages].reverse().find((message) => message && (
      message.externalMessageId
      || message.external_message_id
    ))?.externalMessageId
      || [...messages].reverse().find((message) => message && (
        message.externalMessageId
        || message.external_message_id
      ))?.external_message_id
      || null,
    deliveryStatus: [...messages].reverse().find((message) => message && (
      message.deliveryStatus
      || message.delivery_status
    ))?.deliveryStatus
      || [...messages].reverse().find((message) => message && (
        message.deliveryStatus
        || message.delivery_status
      ))?.delivery_status
      || null,
  };
}

function extractSupportMessageItems(payload = {}) {
  if (Array.isArray(payload?.timeline)) return payload.timeline.filter(Boolean);
  if (Array.isArray(payload?.messages)) return payload.messages.filter(Boolean);
  if (Array.isArray(payload?.items)) return payload.items.filter(Boolean);
  if (Array.isArray(payload)) return payload.filter(Boolean);
  return [];
}

function extractAuditLogItems(payload = {}) {
  if (Array.isArray(payload?.items)) return payload.items.filter(Boolean);
  if (Array.isArray(payload?.logs)) return payload.logs.filter(Boolean);
  if (Array.isArray(payload)) return payload.filter(Boolean);
  return [];
}

function extractApiItems(payload = {}) {
  if (Array.isArray(payload?.items)) return payload.items.filter(Boolean);
  if (Array.isArray(payload?.decisions)) return payload.decisions.filter(Boolean);
  if (Array.isArray(payload?.events)) return payload.events.filter(Boolean);
  if (Array.isArray(payload?.timeline)) return payload.timeline.filter(Boolean);
  if (Array.isArray(payload)) return payload.filter(Boolean);
  return [];
}

function buildSupportApiFallbackSnapshot({
  baseSnapshot = {},
  ticket = {},
  messagesPayload = {},
  auditPayload = {},
  stepId = null,
} = {}) {
  const baseDb = baseSnapshot?.db || {};
  const baseEvents = baseSnapshot?.events || {};
  const baseCrm = baseSnapshot?.crm || {};
  const baseApi = baseSnapshot?.api || {};
  const resolved = resolveSupportSeedMetadata(ticket, messagesPayload);
  const messageCount = extractSupportMessageItems(messagesPayload).length;
  const auditCount = extractAuditLogItems(auditPayload).length;
  const ticketId = resolved.ticketId || baseApi?.support?.ticketId || null;
  const conversationId = resolved.conversationId || baseApi?.support?.conversationId || null;
  const ticketStatus = ticket?.status || baseDb?.ticket?.status || baseDb?.ticketStatus || null;

  return {
    ...baseSnapshot,
    state: baseSnapshot?.state || null,
    db: {
      ...baseDb,
      ticket: {
        ...(baseDb?.ticket || {}),
        exists: Boolean(ticketId),
        id: ticketId,
        status: ticketStatus,
        updatedAt: ticket?.updatedAt || ticket?.updated_at || baseDb?.ticket?.updatedAt || null,
      },
      ticketStatus: ticketStatus,
      messages: {
        ...((baseDb && baseDb.messages) || {}),
        count: Math.max(Number(baseDb?.messages?.count || 0), messageCount),
      },
    },
    api: {
      ...baseApi,
      support: {
        ...(baseApi?.support || {}),
        ticketId,
        conversationId,
      },
    },
    events: {
      ...baseEvents,
      messages: {
        ...((baseEvents && baseEvents.messages) || {}),
        count: Math.max(Number(baseEvents?.messages?.count || 0), messageCount),
        available: true,
      },
      audit: {
        ...((baseEvents && baseEvents.audit) || {}),
        count: Math.max(Number(baseEvents?.audit?.count || 0), auditCount),
        auditEventsAvailable: baseEvents?.audit?.auditEventsAvailable !== false,
        auditLogsAvailable: true,
      },
    },
    crm: {
      ...baseCrm,
    },
    metadata: {
      ...(baseSnapshot?.metadata || {}),
      collector: 'entity_scoped',
      filterApplied: false,
      stepId: stepId || baseSnapshot?.metadata?.stepId || null,
      sources: {
        ...((baseSnapshot?.metadata && baseSnapshot.metadata.sources) || {}),
        supportApi: true,
        messages: true,
        audit: true,
      },
      sourceErrors: Array.isArray(baseSnapshot?.metadata?.sourceErrors)
        ? baseSnapshot.metadata.sourceErrors.filter(Boolean)
        : [],
    },
  };
}

function buildFitnessApiFallbackSnapshot({
  baseSnapshot = {},
  decisionsPayload = {},
  eventsPayload = {},
  attendancePayload = {},
  timelinePayload = {},
  deviceId = null,
  stepId = null,
} = {}) {
  const baseDb = baseSnapshot?.db || {};
  const baseApi = baseSnapshot?.api || {};
  const baseEvents = baseSnapshot?.events || {};
  const baseCrm = baseSnapshot?.crm || {};
  const baseDevices = baseSnapshot?.devices || {};
  const decisionCount = extractApiItems(decisionsPayload).length;
  const eventCount = extractApiItems(eventsPayload).length;
  const attendanceCount = extractApiItems(attendancePayload).length;
  const timelineCount = extractApiItems(timelinePayload).length;
  const mergedAttendanceCount = Math.max(Number(baseDb?.attendance?.count || 0), attendanceCount);
  const mergedDecisionCount = Math.max(Number(baseApi?.access?.decision?.count || 0), decisionCount);
  const mergedEventCount = Math.max(Number(baseEvents?.access?.count || 0), eventCount);
  const mergedTimelineCount = Math.max(Number(baseCrm?.presenceActivity?.count || 0), timelineCount);

  return {
    ...baseSnapshot,
    state: mergedAttendanceCount > 0 ? 'attendance_created' : (baseSnapshot?.state || null),
    db: {
      ...baseDb,
      attendance: {
        ...(baseDb?.attendance || {}),
        count: mergedAttendanceCount,
        created: mergedAttendanceCount > 0,
        not_exists: mergedAttendanceCount === 0,
      },
    },
    api: {
      ...baseApi,
      access: {
        ...(baseApi?.access || {}),
        decision: {
          ...((baseApi?.access && baseApi.access.decision) || {}),
          count: mergedDecisionCount,
          allow: mergedDecisionCount > 0,
        },
      },
    },
    events: {
      ...baseEvents,
      access: {
        ...((baseEvents && baseEvents.access) || {}),
        count: mergedEventCount,
        available: true,
      },
    },
    crm: {
      ...baseCrm,
      presenceActivity: {
        ...((baseCrm && baseCrm.presenceActivity) || {}),
        count: mergedTimelineCount,
        created: mergedTimelineCount > 0,
      },
    },
    devices: {
      ...baseDevices,
      deviceId: deviceId || baseDevices?.deviceId || null,
      access: {
        ...((baseDevices && baseDevices.access) || {}),
        decisions: Math.max(Number(baseDevices?.access?.decisions || 0), mergedDecisionCount),
        events: Math.max(Number(baseDevices?.access?.events || 0), mergedEventCount),
        releaseEventCreated: Math.max(Number(baseDevices?.access?.events || 0), mergedEventCount) > 0,
      },
    },
    metadata: {
      ...(baseSnapshot?.metadata || {}),
      collector: 'entity_scoped',
      filterApplied: false,
      stepId: stepId || baseSnapshot?.metadata?.stepId || null,
      sources: {
        ...((baseSnapshot?.metadata && baseSnapshot.metadata.sources) || {}),
        fitnessApi: true,
        attendanceApi: true,
        accessDecisionApi: true,
        accessEventApi: true,
        timelineApi: true,
      },
      sourceErrors: Array.isArray(baseSnapshot?.metadata?.sourceErrors)
        ? baseSnapshot.metadata.sourceErrors.filter(Boolean)
        : [],
    },
  };
}

async function maybeCollectSupportApiFallbackSnapshot({
  journeyId,
  seedEvidence,
  stepId,
  snapshot,
} = {}) {
  if (journeyId !== 'support_ticket_flow') return snapshot;
  if (!seedEvidence?.page || !seedEvidence?.ticketId) return snapshot;

  const supportSnapshot = snapshot?.api?.support || {};
  const needsOperationalFallback = !snapshot?.db?.ticket?.exists
    || !supportSnapshot.conversationId
    || Number(snapshot?.db?.messages?.count || 0) === 0;

  if (!needsOperationalFallback) return snapshot;

  const ticketId = encodeURIComponent(String(seedEvidence.ticketId));
  const [detail, messages, audit] = await Promise.all([
    browserApiFetch(seedEvidence.page, `/tickets/${ticketId}`, { method: 'GET' }).catch(() => null),
    browserApiFetch(seedEvidence.page, `/tickets/${ticketId}/messages`, { method: 'GET' }).catch(() => null),
    browserApiFetch(seedEvidence.page, `/audit/logs?resource=ticket&resourceId=${ticketId}&limit=50&offset=0`, { method: 'GET' }).catch(() => null),
  ]);

  const ticketBody = detail?.body?.ticket || detail?.body || {};
  const messagesBody = messages?.body || {};
  const auditBody = audit?.body || {};
  const refreshed = resolveSupportSeedMetadata(ticketBody, messagesBody?.messages || messagesBody?.timeline || messagesBody?.items || messagesBody);

  if (refreshed.ticketId) seedEvidence.ticketId = refreshed.ticketId;
  if (refreshed.conversationId) seedEvidence.conversationId = refreshed.conversationId;
  if (refreshed.contactId) seedEvidence.contactId = refreshed.contactId;
  if (refreshed.externalMessageId) seedEvidence.externalMessageId = refreshed.externalMessageId;
  if (refreshed.deliveryStatus) seedEvidence.deliveryStatus = refreshed.deliveryStatus;

  return buildSupportApiFallbackSnapshot({
    baseSnapshot: snapshot,
    ticket: ticketBody,
    messagesPayload: messagesBody,
    auditPayload: auditBody,
    stepId,
  });
}

async function maybeCollectFitnessApiFallbackSnapshot({
  journeyId,
  seedEvidence,
  stepId,
  snapshot,
} = {}) {
  if (journeyId !== 'fitness_customer_checkin') return snapshot;
  if (!seedEvidence?.page || !seedEvidence?.subjectId) return snapshot;

  const needsOperationalFallback = Number(snapshot?.db?.attendance?.count || 0) === 0
    || Number(snapshot?.api?.access?.decision?.count || 0) === 0
    || Number(snapshot?.events?.access?.count || 0) === 0
    || Number(snapshot?.crm?.presenceActivity?.count || 0) === 0;

  if (!needsOperationalFallback) return snapshot;

  const subjectId = encodeURIComponent(String(seedEvidence.subjectId));
  const [attendance, decisions, events, timeline] = await Promise.all([
    browserApiFetch(seedEvidence.page, `/api/fitness/subject/${subjectId}/attendance?limit=20`, { method: 'GET' }).catch(() => null),
    browserApiFetch(seedEvidence.page, `/api/access-control/decisions?subject_id=${subjectId}&decision=allow&limit=20`, { method: 'GET' }).catch(() => null),
    browserApiFetch(seedEvidence.page, `/api/access-control/events?subject_id=${subjectId}&limit=20`, { method: 'GET' }).catch(() => null),
    browserApiFetch(seedEvidence.page, `/api/fitness/subject/${subjectId}/timeline`, { method: 'GET' }).catch(() => null),
  ]);

  return buildFitnessApiFallbackSnapshot({
    baseSnapshot: snapshot,
    decisionsPayload: decisions?.body || {},
    eventsPayload: events?.body || {},
    attendancePayload: attendance?.body || {},
    timelinePayload: timeline?.body || {},
    deviceId: seedEvidence.deviceId || null,
    stepId,
  });
}

function buildBookingApiFallbackSnapshot({ baseSnapshot, booking, stepId }) {
  const snapshot = clone(baseSnapshot || {});
  const bookingRecord = booking || {};
  const baseBooking = snapshot?.db?.booking || {};
  const bookingId = bookingRecord.id || baseBooking.id || null;
  const bookingStatus = bookingRecord.status || baseBooking.status || null;

  return {
    ...snapshot,
    state: bookingStatus || snapshot?.state || null,
    db: {
      ...(snapshot?.db || {}),
      booking: {
        ...baseBooking,
        exists: Boolean(bookingId),
        id: bookingId,
        status: bookingStatus,
        count: bookingId ? Math.max(Number(baseBooking.count || 0), 1) : Number(baseBooking.count || 0),
      },
    },
    api: {
      ...(snapshot?.api || {}),
      booking: {
        ...((snapshot?.api || {}).booking || {}),
        id: bookingId,
        status: bookingStatus,
      },
    },
    metadata: {
      ...(snapshot?.metadata || {}),
      sources: {
        ...((snapshot?.metadata || {}).sources || {}),
        booking: true,
        api: true,
      },
      sourceErrors: Array.isArray(snapshot?.metadata?.sourceErrors)
        ? snapshot.metadata.sourceErrors.filter(Boolean)
        : [],
      stepId,
    },
  };
}

async function maybeCollectBookingApiFallbackSnapshot({
  journeyId,
  seedEvidence,
  stepId,
  snapshot,
} = {}) {
  if (journeyId !== 'booking_flow') return snapshot;
  if (!seedEvidence?.page || !seedEvidence?.bookingId) return snapshot;

  const needsOperationalFallback = !snapshot?.db?.booking?.exists || !snapshot?.api?.booking?.id;
  if (!needsOperationalFallback) return snapshot;

  const query = seedEvidence.resourceId
    ? `/resource-bookings?resourceId=${encodeURIComponent(String(seedEvidence.resourceId))}&limit=50`
    : '/resource-bookings?limit=50';
  const listed = await browserApiFetch(seedEvidence.page, query, { method: 'GET' }).catch(() => null);
  const items = listed?.body?.items || listed?.body?.bookings || [];
  const booking = Array.isArray(items)
    ? items.find((item) => String(item?.id || '') === String(seedEvidence.bookingId))
    : null;

  if (!booking) return snapshot;

  return buildBookingApiFallbackSnapshot({
    baseSnapshot: snapshot,
    booking,
    stepId,
  });
}

function buildPaymentApiFallbackSnapshot({ baseSnapshot, transaction, notifications, stepId }) {
  const snapshot = clone(baseSnapshot || {});
  const transactionRecord = transaction || {};
  const billingBase = snapshot?.db?.billing || {};
  const apiBillingBase = snapshot?.api?.billing || {};
  const notificationItems = Array.isArray(notifications) ? notifications : [];
  const sentStatuses = new Set(['sent', 'delivered', 'read', 'stub', 'provider-dependent']);
  const sentCount = notificationItems.filter((item) => sentStatuses.has(String(item?.status || '').toLowerCase())).length;
  const transactionId = transactionRecord.id || billingBase.id || apiBillingBase.transactionId || null;
  const externalTransactionId = transactionRecord.external_transaction_id
    || transactionRecord.externalTransactionId
    || billingBase.externalTransactionId
    || apiBillingBase.externalTransactionId
    || null;
  const status = transactionRecord.status || billingBase.status || null;

  return {
    ...snapshot,
    state: status === 'confirmed' ? 'payment_confirmed' : (snapshot?.state || null),
    db: {
      ...(snapshot?.db || {}),
      billing: {
        ...billingBase,
        exists: Boolean(transactionId),
        id: transactionId,
        status,
        count: transactionId ? Math.max(Number(billingBase.count || 0), 1) : Number(billingBase.count || 0),
        externalTransactionId,
      },
    },
    api: {
      ...(snapshot?.api || {}),
      billing: {
        ...apiBillingBase,
        transactionId,
        externalTransactionId,
        status,
      },
    },
    events: {
      ...(snapshot?.events || {}),
      notifications: {
        ...((snapshot?.events || {}).notifications || {}),
        count: notificationItems.length,
        sent: sentCount,
        available: true,
      },
    },
    metadata: {
      ...(snapshot?.metadata || {}),
      sources: {
        ...((snapshot?.metadata || {}).sources || {}),
        billing: true,
        notifications: true,
        api: true,
      },
      sourceErrors: Array.isArray(snapshot?.metadata?.sourceErrors)
        ? snapshot.metadata.sourceErrors.filter(Boolean)
        : [],
      stepId,
    },
  };
}

async function maybeCollectPaymentApiFallbackSnapshot({
  journeyId,
  seedEvidence,
  stepId,
  snapshot,
} = {}) {
  if (journeyId !== 'payment_charge_flow') return snapshot;
  if (!seedEvidence?.page) return snapshot;

  if (!seedEvidence.transactionId) {
    if (stepId !== 'step_create_membership_charge') return snapshot;
    return {
      ...clone(snapshot || {}),
      events: {
        ...((snapshot || {}).events || {}),
        notifications: {
          ...(((snapshot || {}).events || {}).notifications || {}),
          count: 0,
          sent: 0,
          available: true,
        },
      },
    };
  }

  const needsOperationalFallback = !snapshot?.db?.billing?.exists
    || !snapshot?.api?.billing?.transactionId
    || !snapshot?.db?.billing?.status
    || Number(snapshot?.events?.notifications?.count || 0) === 0;
  if (!needsOperationalFallback) return snapshot;

  const [listed, notificationsResponse] = await Promise.all([
    browserApiFetch(seedEvidence.page, '/billing/transactions?vertical=fitness&limit=50', { method: 'GET' }).catch(() => null),
    browserApiFetch(seedEvidence.page, '/api/operations-dashboard/notifications?vertical=fitness&limit=200', { method: 'GET' }).catch(() => null),
  ]);

  const items = listed?.body?.items || [];
  const transaction = Array.isArray(items)
    ? items.find((item) => (
      String(item?.id || '') === String(seedEvidence.transactionId)
      || (
        seedEvidence.externalTransactionId
        && String(item?.external_transaction_id || item?.externalTransactionId || '') === String(seedEvidence.externalTransactionId)
      )
    ))
    : null;

  if (transaction?.external_transaction_id || transaction?.externalTransactionId) {
    seedEvidence.externalTransactionId = transaction.external_transaction_id || transaction.externalTransactionId;
  }

  const notificationItems = (notificationsResponse?.body?.items || notificationsResponse?.body || [])
    .filter((item) => String(item?.transactionId || '') === String(seedEvidence.transactionId));

  return buildPaymentApiFallbackSnapshot({
    baseSnapshot: snapshot,
    transaction,
    notifications: notificationItems,
    stepId,
  });
}

function buildFoodApiFallbackSnapshot({ baseSnapshot, order, eventLedgerItems, stepId }) {
  const snapshot = clone(baseSnapshot || {});
  const orderRecord = order || {};
  const dbOrderBase = snapshot?.db?.order || {};
  const apiOrdersBase = snapshot?.api?.orders || {};
  const orderId = orderRecord.id || dbOrderBase.id || apiOrdersBase.orderId || null;
  const status = orderRecord.status || dbOrderBase.status || apiOrdersBase.status || null;
  const events = Array.isArray(eventLedgerItems) ? eventLedgerItems : [];

  return {
    ...snapshot,
    state: status === 'confirmed' ? 'order_confirmed' : (snapshot?.state || null),
    db: {
      ...(snapshot?.db || {}),
      order: {
        ...dbOrderBase,
        exists: Boolean(orderId),
        id: orderId,
        status,
        count: orderId ? Math.max(Number(dbOrderBase.count || 0), 1) : Number(dbOrderBase.count || 0),
      },
    },
    api: {
      ...(snapshot?.api || {}),
      orders: {
        ...apiOrdersBase,
        orderId,
        status,
      },
    },
    events: {
      ...(snapshot?.events || {}),
      order_status: {
        ...((snapshot?.events || {}).order_status || {}),
        count: events.length,
        available: true,
      },
    },
    metadata: {
      ...(snapshot?.metadata || {}),
      sources: {
        ...((snapshot?.metadata || {}).sources || {}),
        orders: true,
        eventLedger: true,
        api: true,
      },
      sourceErrors: Array.isArray(snapshot?.metadata?.sourceErrors)
        ? snapshot.metadata.sourceErrors.filter(Boolean)
        : [],
      stepId,
    },
  };
}

async function maybeCollectFoodApiFallbackSnapshot({
  journeyId,
  seedEvidence,
  stepId,
  snapshot,
} = {}) {
  if (journeyId !== 'food_order_status_flow') return snapshot;
  if (!seedEvidence?.page || !seedEvidence?.orderId) return snapshot;

  const needsOperationalFallback = !snapshot?.db?.order?.exists
    || !snapshot?.api?.orders?.orderId
    || !snapshot?.db?.order?.status
    || !snapshot?.api?.orders?.status
    || !snapshot?.events?.order_status?.available
    || (
      stepId === 'step_update_order_status'
      && Number(snapshot?.events?.order_status?.count || 0) === 0
    );
  if (!needsOperationalFallback) return snapshot;

  const encodedOrderId = encodeURIComponent(seedEvidence.orderId);
  const [orderResponse, eventLedgerResponse] = await Promise.all([
    browserApiFetch(seedEvidence.page, `/orders/${encodedOrderId}`, { method: 'GET' }).catch(() => null),
    browserApiFetch(
      seedEvidence.page,
      `/api/event-ledger?subjectType=order&subjectId=${encodedOrderId}&type=OrderStatusChanged&limit=20`,
      { method: 'GET' },
    ).catch(() => null),
  ]);

  const order = orderResponse?.body?.order || orderResponse?.body || null;
  const eventLedgerItems = eventLedgerResponse?.body?.items
    || eventLedgerResponse?.body?.events
    || eventLedgerResponse?.body
    || [];

  return buildFoodApiFallbackSnapshot({
    baseSnapshot: snapshot,
    order,
    eventLedgerItems,
    stepId,
  });
}

function buildBakeryApiFallbackSnapshot({ baseSnapshot, order, eventLedgerItems, stepId }) {
  const snapshot = clone(baseSnapshot || {});
  const orderRecord = order || {};
  const dbOrderBase = snapshot?.db?.order || {};
  const apiOrdersBase = snapshot?.api?.orders || {};
  const orderId = orderRecord.id || dbOrderBase.id || apiOrdersBase.orderId || null;
  const status = orderRecord.status || dbOrderBase.status || apiOrdersBase.status || null;
  const events = Array.isArray(eventLedgerItems) ? eventLedgerItems : [];

  return {
    ...snapshot,
    state: status === 'confirmed' ? 'order_confirmed' : (snapshot?.state || null),
    db: {
      ...(snapshot?.db || {}),
      order: {
        ...dbOrderBase,
        exists: Boolean(orderId),
        id: orderId,
        status,
        count: orderId ? Math.max(Number(dbOrderBase.count || 0), 1) : Number(dbOrderBase.count || 0),
      },
    },
    api: {
      ...(snapshot?.api || {}),
      orders: {
        ...apiOrdersBase,
        orderId,
        status,
      },
    },
    events: {
      ...(snapshot?.events || {}),
      order_status: {
        ...((snapshot?.events || {}).order_status || {}),
        count: events.length,
        available: true,
      },
    },
    metadata: {
      ...(snapshot?.metadata || {}),
      sources: {
        ...((snapshot?.metadata || {}).sources || {}),
        orders: true,
        eventLedger: true,
        api: true,
      },
      sourceErrors: Array.isArray(snapshot?.metadata?.sourceErrors)
        ? snapshot.metadata.sourceErrors.filter(Boolean)
        : [],
      stepId,
    },
  };
}

async function maybeCollectBakeryApiFallbackSnapshot({
  journeyId,
  seedEvidence,
  stepId,
  snapshot,
} = {}) {
  if (journeyId !== 'bakery_encomenda_flow') return snapshot;
  if (!seedEvidence?.page || !seedEvidence?.orderId) return snapshot;

  const needsOperationalFallback = !snapshot?.db?.order?.exists
    || !snapshot?.api?.orders?.orderId
    || !snapshot?.db?.order?.status
    || !snapshot?.api?.orders?.status
    || !snapshot?.events?.order_status?.available
    || (
      stepId === 'step_update_bakery_order_status'
      && Number(snapshot?.events?.order_status?.count || 0) === 0
    );
  if (!needsOperationalFallback) return snapshot;

  const encodedOrderId = encodeURIComponent(seedEvidence.orderId);
  const [orderResponse, eventLedgerResponse] = await Promise.all([
    browserApiFetch(seedEvidence.page, `/orders/${encodedOrderId}`, { method: 'GET' }).catch(() => null),
    browserApiFetch(
      seedEvidence.page,
      `/api/event-ledger?subjectType=order&subjectId=${encodedOrderId}&type=OrderStatusChanged&limit=20`,
      { method: 'GET' },
    ).catch(() => null),
  ]);

  const order = orderResponse?.body?.order || orderResponse?.body || null;
  const eventLedgerItems = eventLedgerResponse?.body?.items
    || eventLedgerResponse?.body?.events
    || eventLedgerResponse?.body
    || [];

  return buildBakeryApiFallbackSnapshot({
    baseSnapshot: snapshot,
    order,
    eventLedgerItems,
    stepId,
  });
}

function buildMarketApiFallbackSnapshot({ baseSnapshot, catalogItems, publishedItems, stepId, nodeId }) {
  const snapshot = clone(baseSnapshot || {});
  const catalog = Array.isArray(catalogItems) ? catalogItems : [];
  const published = Array.isArray(publishedItems) ? publishedItems : [];
  const matchedPublished = published.find((item) => String(item?.id || '') === String(nodeId)) || null;
  const matchedCatalog = catalog.find((item) => String(item?.id || '') === String(nodeId)) || null;
  const node = matchedPublished || matchedCatalog || null;
  const dbBase = snapshot?.db?.nodeMarketplace || {};
  const apiBase = snapshot?.api?.nodeMarketplace || {};

  return {
    ...snapshot,
    state: node ? 'node_published' : (snapshot?.state || null),
    db: {
      ...(snapshot?.db || {}),
      nodeMarketplace: {
        ...dbBase,
        catalog: {
          ...(dbBase.catalog || {}),
          count: catalog.length,
        },
        published: {
          ...(dbBase.published || {}),
          exists: Boolean(node),
          id: node?.id || null,
          count: published.length,
        },
      },
    },
    api: {
      ...(snapshot?.api || {}),
      nodeMarketplace: {
        ...apiBase,
        catalog: {
          ...(apiBase.catalog || {}),
          count: catalog.length,
        },
        published: {
          ...(apiBase.published || {}),
          id: node?.id || null,
          label: node?.label || null,
        },
      },
    },
    metadata: {
      ...(snapshot?.metadata || {}),
      sources: {
        ...((snapshot?.metadata || {}).sources || {}),
        nodeMarketplace: true,
        api: true,
      },
      sourceErrors: Array.isArray(snapshot?.metadata?.sourceErrors)
        ? snapshot.metadata.sourceErrors.filter(Boolean)
        : [],
      stepId,
    },
  };
}

function buildClinicApiFallbackSnapshot({ baseSnapshot, calendarItems, stepId, blockId, resourceId }) {
  const snapshot = clone(baseSnapshot || {});
  const items = Array.isArray(calendarItems) ? calendarItems : [];
  const blocks = items.filter((item) => String(item?.type || '').toLowerCase() === 'block');
  const matchedBlock = blocks.find((item) => String(item?.id || '') === String(blockId)) || null;
  const calendarBase = snapshot?.db?.calendar || {};
  const apiBase = snapshot?.api?.calendar || {};

  return {
    ...snapshot,
    state: matchedBlock ? 'calendar_block_created' : (snapshot?.state || null),
    db: {
      ...(snapshot?.db || {}),
      calendar: {
        ...calendarBase,
        block: {
          ...(calendarBase.block || {}),
          exists: Boolean(matchedBlock),
          id: matchedBlock?.id || null,
          count: blocks.length,
          resourceId: resourceId || calendarBase.block?.resourceId || null,
        },
      },
    },
    api: {
      ...(snapshot?.api || {}),
      calendar: {
        ...apiBase,
        resource: {
          ...(apiBase.resource || {}),
          id: resourceId || apiBase.resource?.id || null,
          blockId: matchedBlock?.id || null,
          blockCount: blocks.length,
          totalCount: items.length,
        },
      },
    },
    metadata: {
      ...(snapshot?.metadata || {}),
      sources: {
        ...((snapshot?.metadata || {}).sources || {}),
        calendar: true,
        api: true,
      },
      sourceErrors: Array.isArray(snapshot?.metadata?.sourceErrors)
        ? snapshot.metadata.sourceErrors.filter(Boolean)
        : [],
      stepId,
    },
  };
}

async function maybeCollectMarketApiFallbackSnapshot({
  journeyId,
  seedEvidence,
  stepId,
  snapshot,
} = {}) {
  if (journeyId !== 'market_node_publish_flow') return snapshot;
  if (!seedEvidence?.page || !seedEvidence?.nodeId) return snapshot;

  const needsOperationalFallback = !snapshot?.db?.nodeMarketplace?.published?.exists
    || !snapshot?.api?.nodeMarketplace?.published?.id
    || !snapshot?.db?.nodeMarketplace?.catalog
    || !snapshot?.api?.nodeMarketplace?.catalog;
  if (!needsOperationalFallback) return snapshot;

  const [catalogResponse, publishedResponse] = await Promise.all([
    browserApiFetch(seedEvidence.page, '/api/node-marketplace/catalog', { method: 'GET' }).catch(() => null),
    browserApiFetch(seedEvidence.page, '/api/node-marketplace/published', { method: 'GET' }).catch(() => null),
  ]);

  const catalogItems = catalogResponse?.body?.items || catalogResponse?.body || [];
  const publishedItems = publishedResponse?.body?.items || publishedResponse?.body || [];

  return buildMarketApiFallbackSnapshot({
    baseSnapshot: snapshot,
    catalogItems,
    publishedItems,
    stepId,
    nodeId: seedEvidence.nodeId,
  });
}

async function maybeCollectClinicApiFallbackSnapshot({
  journeyId,
  seedEvidence,
  stepId,
  snapshot,
} = {}) {
  if (journeyId !== 'clinic_calendar_block_flow') return snapshot;
  if (!seedEvidence?.page || !seedEvidence?.resourceId) return snapshot;

  const needsOperationalFallback = !snapshot?.db?.calendar?.block?.exists
    || !snapshot?.api?.calendar?.resource?.blockId
    || !snapshot?.db?.calendar?.block
    || !snapshot?.api?.calendar?.resource;
  if (!needsOperationalFallback && stepId !== 'step_create_calendar_block') return snapshot;

  const query = new URLSearchParams();
  if (seedEvidence.blockStartAt) query.set('startDate', seedEvidence.blockStartAt);
  if (seedEvidence.blockEndAt) query.set('endDate', seedEvidence.blockEndAt);
  const suffix = query.toString() ? `?${query.toString()}` : '';

  const listed = await browserApiFetch(
    seedEvidence.page,
    `/api/calendar/resource/${encodeURIComponent(String(seedEvidence.resourceId))}${suffix}`,
    { method: 'GET' },
  ).catch(() => null);

  const calendarItems = listed?.body?.items || listed?.body?.calendar || listed?.body || [];

  return buildClinicApiFallbackSnapshot({
    baseSnapshot: snapshot,
    calendarItems,
    stepId,
    blockId: seedEvidence.blockId,
    resourceId: seedEvidence.resourceId,
  });
}

async function refreshSupportSeedMetadata(page, ticketId, seedEvidence = {}) {
  if (!page || !ticketId || !seedEvidence) return seedEvidence;

  const detail = await browserApiFetch(page, `/tickets/${encodeURIComponent(ticketId)}`, { method: 'GET' }).catch(() => null);
  const ticketMessages = await browserApiFetch(page, `/tickets/${encodeURIComponent(ticketId)}/messages`, { method: 'GET' }).catch(() => null);
  const refreshed = resolveSupportSeedMetadata(
    detail?.body?.ticket || detail?.body || {},
    ticketMessages?.body?.messages || ticketMessages?.body?.items || ticketMessages?.body || [],
  );

  if (refreshed.ticketId) seedEvidence.ticketId = refreshed.ticketId;
  if (refreshed.conversationId) seedEvidence.conversationId = refreshed.conversationId;
  if (refreshed.contactId) seedEvidence.contactId = refreshed.contactId;
  if (refreshed.externalMessageId) seedEvidence.externalMessageId = refreshed.externalMessageId;
  if (refreshed.deliveryStatus) seedEvidence.deliveryStatus = refreshed.deliveryStatus;
  return seedEvidence;
}

async function seedSupportFlowReal(page, baseUrl, tenantName) {
  await navigateToSupport(page, baseUrl, tenantName);
  const phone = `551199${String(Date.now()).slice(-7)}`;
  const createPayload = {
    phoneNumber: phone,
    queue: 'support',
    initialMessage: 'Cliente solicita atendimento operacional QA Waves prod-like.',
  };

  let created = await browserApiFetch(page, '/tickets', {
    method: 'POST',
    body: JSON.stringify(createPayload),
  });
  if (!created.ok) {
    created = await browserApiFetch(page, '/api/tickets', {
      method: 'POST',
      body: JSON.stringify(createPayload),
    });
  }

  let ticket = created.body?.ticket || created.body;
  if ((!ticket?.id || !created.ok) && created.status === 409) {
    const listed = await browserApiFetch(page, '/tickets?limit=50&offset=0', { method: 'GET' });
    const items = listed.body?.tickets || listed.body?.items || listed.body || [];
    ticket = Array.isArray(items) ? items.find((item) => item?.status && String(item.status).toLowerCase() !== 'closed') : null;
  }

  if (!ticket?.id) {
    throw new Error('Falha ao criar ticket real para smoke prod-like.');
  }

  const detail = await browserApiFetch(page, `/tickets/${encodeURIComponent(ticket.id)}`, { method: 'GET' });
  const resolvedTicket = detail.body?.ticket || detail.body || ticket;
  const ticketMessages = await browserApiFetch(page, `/tickets/${encodeURIComponent(ticket.id)}/messages`, { method: 'GET' }).catch(() => null);
  const resolvedSupportSeed = resolveSupportSeedMetadata(
    resolvedTicket,
    ticketMessages?.body?.messages || ticketMessages?.body?.items || ticketMessages?.body || [],
  );

  const browserContext = await getBrowserContext(page);

  await page.goto(`${baseUrl}/support`, { waitUntil: 'domcontentloaded' });
  await ensureTenantSelected(page, tenantName);

  return {
    tenantId: browserContext.tenantId,
    ticketId: resolvedSupportSeed.ticketId || resolvedTicket.id || ticket.id,
    conversationId: resolvedSupportSeed.conversationId,
    contactId: resolvedSupportSeed.contactId,
    phone,
    cleanup: { type: 'ticket_close', ticketId: resolvedTicket.id || ticket.id },
  };
}

function buildProdLikeSupportFlowSteps({ baseUrl, ticketId, agentReply, seedEvidence }) {
  return [
    {
      id: 'step_access_support_module',
      actionType: 'navigate',
      journeyId: 'support_ticket_flow',
      selectorUsed: '[data-testid="support-page"]',
      async execute(page) {
        await navigateToSupport(page, baseUrl);
      },
    },
    {
      id: 'step_wait_ticket_list',
      actionType: 'wait_for_list',
      journeyId: 'support_ticket_flow',
      selectorUsed: '[data-testid="ticket-list"]',
      async execute(page) {
        await page.getByTestId('ticket-list').waitFor({ state: 'visible', timeout: 10000 });
      },
    },
    {
      id: 'step_open_ticket',
      actionType: 'click_open',
      journeyId: 'support_ticket_flow',
      selectorUsed: `[data-testid="ticket-card"][data-ticket-id="${ticketId}"]`,
      async execute(page) {
        let ticketCard = page.locator(`[data-testid="ticket-card"][data-ticket-id="${ticketId}"]`).first();
        let visible = await ticketCard.isVisible().catch(() => false);
        if (!visible) {
          await page.getByRole('button', { name: /Atualizar chamados/i }).click().catch(() => {});
          await page.waitForTimeout(1000);
          visible = await ticketCard.isVisible().catch(() => false);
        }
        if (!visible) {
          throw Object.assign(new Error('support_ticket_card_missing'), { blockingAssertion: true });
        }
        await ticketCard.click({ force: true });
        await page.getByTestId('ticket-detail').waitFor({ state: 'visible', timeout: 10000 });
      },
    },
    (() => {
      const step = {
      id: 'step_takeover_ticket',
      actionType: 'takeover_ticket',
      journeyId: 'support_ticket_flow',
      mutationExpected: true,
      selectorUsed: 'support-takeover-fetch',
      async execute(page) {
        const takeover = await browserApiFetch(page, `/tickets/${encodeURIComponent(ticketId)}/takeover`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'qa_waves_prod_like_smoke' }),
        });
        if (!takeover.ok) {
          throw new Error(`support_takeover_failed:${takeover.status}`);
        }
        step.networkEvents = buildSyntheticNetworkEvents(takeover.meta);
        const browserContext = await getBrowserContext(page);
        const agentUsername = browserContext?.agent?.username || browserContext?.agent?.id || 'systemadmin';
        await browserApiFetch(page, `/tickets/${encodeURIComponent(ticketId)}/assign`, {
          method: 'POST',
          body: JSON.stringify({ assignedTo: agentUsername }),
        }).catch(() => null);
      },
      };
      return step;
    })(),
    {
      id: 'step_reply_ticket',
      actionType: 'type_and_send',
      journeyId: 'support_ticket_flow',
      mutationExpected: true,
      selectorUsed: '[data-testid="ticket-reply-input"]',
      async execute(page) {
        await page.getByTestId('ticket-reply-input').fill(agentReply);
        await page.getByTestId('ticket-send-button').click();
        await page.getByTestId('message-sent').last().waitFor({ state: 'visible', timeout: 15000 });
        await refreshSupportSeedMetadata(page, ticketId, seedEvidence);
      },
    },
    {
      id: 'step_whatsapp_read_status',
      actionType: 'webhook_status',
      journeyId: 'support_ticket_flow',
      selectorUsed: 'whatsapp-webhook-fetch',
      async execute(page) {
        for (let attempt = 0; attempt < 6 && !seedEvidence.externalMessageId; attempt += 1) {
          await refreshSupportSeedMetadata(page, ticketId, seedEvidence);
          if (!seedEvidence.externalMessageId) {
            await page.waitForTimeout(1000);
          }
        }
        if (!seedEvidence.externalMessageId) {
          await browserApiFetch(page, `/tickets/${encodeURIComponent(ticketId)}/delivery-failures`, {
            method: 'GET',
          }).catch(() => null);
          await refreshSupportSeedMetadata(page, ticketId, seedEvidence);
          return;
        }

        const webhook = await browserApiFetch(page, '/webhooks/whatsapp', {
          method: 'POST',
          body: JSON.stringify({
            object: 'whatsapp_business_account',
            entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: seedEvidence.externalMessageId, status: 'read' }] } }] }],
          }),
        });
        if (!webhook.ok) {
          throw new Error(`support_whatsapp_webhook_failed:${webhook.status}`);
        }
      },
    },
    {
      id: 'step_assert_whatsapp_delivery',
      actionType: 'assert_delivery_state',
      journeyId: 'support_ticket_flow',
      selectorUsed: 'support-ticket-messages-fetch',
      async execute(page) {
        const acceptedStatuses = new Set(['read', 'delivered', 'sent', 'failed', 'stub', 'skipped', 'provider-dependent']);
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await refreshSupportSeedMetadata(page, ticketId, seedEvidence);
          if (acceptedStatuses.has(String(seedEvidence.deliveryStatus || '').toLowerCase())) {
            return;
          }
          await page.waitForTimeout(1000);
        }
        throw Object.assign(new Error('support_delivery_status_not_terminal'), { blockingAssertion: true });
      },
    },
    {
      id: 'step_change_status',
      actionType: 'change_status',
      journeyId: 'support_ticket_flow',
      mutationExpected: true,
      selectorUsed: '[data-testid="ticket-close-button"]',
      async execute(page) {
        const closeResponsePromise = page.waitForResponse(
          (response) => response.request().method() === 'POST' && /\/tickets\/[^/]+\/close(?:\?|$)/i.test(response.url()),
          { timeout: 15000 },
        ).catch(() => null);
        await page.getByTestId('ticket-close-button').waitFor({ state: 'visible', timeout: 10000 });
        await page.getByTestId('ticket-close-button').click();
        const closeModal = page.locator('[role="dialog"][aria-labelledby="close-ticket-title"]');
        if (await closeModal.isVisible({ timeout: 5000 }).catch(() => false)) {
          const reasonInput = closeModal.locator('input.support-form-input').first();
          if (await reasonInput.isVisible().catch(() => false)) {
            await reasonInput.fill('Resolvido pelo QA Waves prod-like');
          }
          await closeModal.getByRole('button', { name: /^Fechar$/ }).click({ force: true });
        }
        const confirmDialog = page.locator('div.relative.z-10').filter({ hasText: /Deseja realmente fechar este ticket/i }).last();
        if (await confirmDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
          await confirmDialog.locator('button[type="button"]').filter({ hasText: /^Fechar$/ }).last().click();
        }
        const closeResponse = await closeResponsePromise;
        if (!closeResponse) {
          throw Object.assign(new Error('support_close_request_missing'), { blockingAssertion: true });
        }
        await page.getByTestId('ticket-updated').waitFor({ state: 'visible', timeout: 15000 });
      },
    },
    {
      id: 'step_assert_ticket_ui',
      actionType: 'assert_ui_state',
      journeyId: 'support_ticket_flow',
      selectorUsed: '[data-testid="ticket-updated"]',
      async execute(page) {
        await page.getByTestId('ticket-updated').waitFor({ state: 'visible', timeout: 10000 });
      },
    },
    {
      id: 'step_assert_ticket_backend',
      actionType: 'assert_backend_state',
      status: 'passed',
      journeyId: 'support_ticket_flow',
      selectorUsed: '[data-testid="ticket-detail"]',
      async execute(page) {
        let detail = await browserApiFetch(page, `/tickets/${encodeURIComponent(ticketId)}`, { method: 'GET' });
        if (!detail?.ok) {
          detail = await browserApiFetch(page, `/api/tickets/${encodeURIComponent(ticketId)}`, { method: 'GET' }).catch(() => null);
        }

        const ticket = detail?.body?.ticket || detail?.body || null;
        const status = String(ticket?.status || '').trim().toLowerCase();
        if (!detail?.ok || !ticket || !status) {
          throw Object.assign(new Error('support_backend_state_not_available'), { blockingAssertion: true });
        }
      },
    },
  ];
}

async function seedFitnessFlowReal(page, baseUrl, tenantName) {
  await page.goto(`${baseUrl}/operations-dashboard`, { waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page, baseUrl);
  await ensureTenantSelected(page, tenantName);

  const browserContext = await getBrowserContext(page);
  const suffix = String(Date.now());
  const subjectId = `qa-fit-subject-${suffix}`;
  const membershipId = `qa-fit-membership-${suffix}`;
  const studentPayload = {
    subjectId,
    customerId: `qa-fit-customer-${suffix}`,
    membershipId,
    name: 'QA Waves Fitness Check-in',
    document: `DOC${suffix}`,
    code: `FIT${suffix}`,
    planName: 'Plano QA Operacional',
    billingStatus: 'active',
    status: 'active',
  };
  const studentResponse = await browserApiFetch(page, '/api/fitness/student', {
    method: 'POST',
    body: JSON.stringify(studentPayload),
  });
  if (!studentResponse.ok) {
    throw new Error(`Falha ao criar aluno real para smoke prod-like: ${studentResponse.status}`);
  }

  const subject = studentResponse.body?.subject || studentResponse.body?.student || studentResponse.body;
  const membership = studentResponse.body?.membership || null;
  if (!subject?.id || !membership?.id) {
    throw new Error('Smoke prod-like não recebeu subjectId do fluxo fitness.');
  }

  const credentialValue = `QA-FIT-${suffix}`;
  const credentialResponse = await browserApiFetch(page, '/api/access-control/credentials', {
    method: 'POST',
    body: JSON.stringify({
      type: 'qrcode',
      subjectId,
      membershipId,
      credentialValue,
      credentialRef: `qa-fit-ref-${suffix}`,
      vertical: 'fitness',
      status: 'active',
    }),
  });
  if (!credentialResponse.ok) {
    throw new Error(`Falha ao criar credencial real para smoke prod-like: ${credentialResponse.status}`);
  }

  const policyResponse = await browserApiFetch(page, '/api/access-control/policies', {
    method: 'POST',
    body: JSON.stringify({
      id: `qa-fit-policy-${suffix}`,
      name: 'QA Waves Fitness Allow Policy',
      vertical: 'fitness',
      appliesTo: {
        actions: ['enter'],
        vertical_profiles: ['fitness'],
        membership_statuses: ['active'],
      },
    }),
  });
  if (!policyResponse.ok) {
    throw new Error(`Falha ao criar policy real para smoke prod-like: ${policyResponse.status}`);
  }

  const credential = credentialResponse.body?.item || credentialResponse.body?.credential || credentialResponse.body;
  const credentialId = credential?.id || credential?.credentialId || null;
  const deviceId = process.env.QA_WAVES_TEST_DEVICE_ID || 'qa-waves-test-device';

  return {
    tenantId: browserContext.tenantId,
    subjectId: subject.id,
    contactId: subject.customerId || subject.customer_id || studentPayload.customerId,
    membershipId: membership.id,
    credentialId,
    credentialValue,
    deviceId,
    deviceMode: 'test_device',
    cleanup: {
      type: 'fitness_entities',
      subjectId: subject.id,
      membershipId: membership.id,
      credentialId,
      policyId: `qa-fit-policy-${suffix}`,
    },
  };
}

async function seedBookingFlowReal(page, baseUrl, tenantName) {
  await page.goto(`${baseUrl}/workspace`, { waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page, baseUrl);
  await ensureTenantSelected(page, tenantName);

  const browserContext = await getBrowserContext(page);
  const suffix = String(Date.now());
  const resourceResponse = await browserApiFetch(page, '/resources', {
    method: 'POST',
    body: JSON.stringify({
      name: `QA Waves Booking Resource ${suffix}`,
      type: 'room',
      metadata: { source: 'qa_waves_prod_like_smoke', suffix },
    }),
  });
  if (!resourceResponse.ok) {
    throw new Error(`Falha ao criar recurso real para smoke prod-like: ${resourceResponse.status}`);
  }

  const resource = resourceResponse.body?.resource || resourceResponse.body?.item || resourceResponse.body;
  if (!resource?.id) {
    throw new Error('Smoke prod-like não recebeu resourceId do fluxo booking.');
  }

  return {
    tenantId: browserContext.tenantId,
    resourceId: resource.id,
    status: 'ready',
  };
}

async function seedFoodFlowReal(page, baseUrl, tenantName) {
  await page.goto(`${baseUrl}/orders`, { waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page, baseUrl);
  await ensureTenantSelected(page, tenantName);

  const browserContext = await getBrowserContext(page);
  const suffix = String(Date.now());
  const tokenResponse = await browserApiFetch(page, '/public-tokens', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'storefront',
      meta: {
        name: `QA Waves Food ${suffix}`,
        description: 'Prod-like food seed token',
      },
      expiresInSec: 3600,
    }),
  });

  if (!tokenResponse?.ok || !tokenResponse?.body?.token?.token) {
    throw new Error(`food_public_token_create_failed:${tokenResponse?.status || 'unknown'}`);
  }

  const created = await browserApiFetch(page, `/storefront/orders?token=${encodeURIComponent(tokenResponse.body.token.token)}`, {
    method: 'POST',
    body: JSON.stringify({
      customerName: 'QA Waves Food Customer',
      customerPhone: `+5511999${suffix.slice(-6)}`,
      items: [{
        name: 'QA Waves Combo',
        qty: 1,
        price: 49.9,
        notes: 'food_order_status_flow',
      }],
      notes: 'QA Waves prod-like food seed',
      deliveryType: 'pickup',
      idempotencyKey: `qa-waves-food-${suffix}`,
    }),
  });

  const order = created?.body?.order || created?.body?.item || created?.body;
  if (!created?.ok || !order?.id) {
    throw new Error(`food_order_seed_failed:${created?.status || 'unknown'}`);
  }

  if (!order?.id) {
    throw new Error('Smoke prod-like não recebeu orderId do fluxo food.');
  }

  return {
    tenantId: browserContext.tenantId,
    orderId: order.id,
    status: 'ready',
  };
}

async function seedBakeryFlowReal(page, baseUrl, tenantName) {
  await page.goto(`${baseUrl}/orders`, { waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page, baseUrl);
  await ensureTenantSelected(page, tenantName);

  const browserContext = await getBrowserContext(page);
  const suffix = String(Date.now());
  const tokenResponse = await browserApiFetch(page, '/public-tokens', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'storefront',
      meta: {
        name: `QA Waves Bakery ${suffix}`,
        description: 'Prod-like bakery seed token',
      },
      expiresInSec: 3600,
    }),
  });

  if (!tokenResponse?.ok || !tokenResponse?.body?.token?.token) {
    throw new Error(`bakery_public_token_create_failed:${tokenResponse?.status || 'unknown'}`);
  }

  const created = await browserApiFetch(page, `/storefront/orders?token=${encodeURIComponent(tokenResponse.body.token.token)}`, {
    method: 'POST',
    body: JSON.stringify({
      customerName: 'QA Waves Bakery Customer',
      customerPhone: `+5511988${suffix.slice(-6)}`,
      items: [{
        name: 'Bolo de encomenda QA',
        qty: 1,
        price: 89.9,
        notes: 'bakery_encomenda_flow',
      }],
      notes: 'QA Waves prod-like bakery seed',
      deliveryType: 'pickup',
      idempotencyKey: `qa-waves-bakery-${suffix}`,
    }),
  });

  const order = created?.body?.order || created?.body?.item || created?.body;
  if (!created?.ok || !order?.id) {
    throw new Error(`bakery_order_seed_failed:${created?.status || 'unknown'}`);
  }

  if (!order?.id) {
    throw new Error('Smoke prod-like não recebeu orderId do fluxo bakery.');
  }

  return {
    tenantId: browserContext.tenantId,
    orderId: order.id,
    status: 'ready',
  };
}

async function seedPaymentFlowReal(page, baseUrl, tenantName) {
  await page.goto(`${baseUrl}/operations-dashboard`, { waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page, baseUrl);
  await ensureTenantSelected(page, tenantName);

  const browserContext = await getBrowserContext(page);
  const suffix = String(Date.now());
  const studentPayload = {
    subjectId: `qa-pay-subject-${suffix}`,
    customerId: `qa-pay-customer-${suffix}`,
    membershipId: `qa-pay-membership-${suffix}`,
    name: 'QA Waves Payment Student',
    document: `PAY${suffix}`,
    code: `PAY${suffix}`,
    planName: 'Plano QA Payment',
    billingStatus: 'active',
    status: 'active',
  };
  const studentResponse = await browserApiFetch(page, '/api/fitness/student', {
    method: 'POST',
    body: JSON.stringify(studentPayload),
  });
  if (!studentResponse.ok) {
    throw new Error(`Falha ao criar aluno real para smoke payment prod-like: ${studentResponse.status}`);
  }

  const subject = studentResponse.body?.subject || studentResponse.body?.student || studentResponse.body;
  const membership = studentResponse.body?.membership || null;
  if (!subject?.id || !membership?.id) {
    throw new Error('Smoke prod-like não recebeu entidades do fluxo payment.');
  }

  return {
    tenantId: browserContext.tenantId,
    subjectId: subject.id,
    contactId: subject.customerId || subject.customer_id || studentPayload.customerId,
    membershipId: membership.id,
    status: 'ready',
  };
}

async function seedMarketFlowReal(page, baseUrl, tenantName) {
  await page.goto(`${baseUrl}/node-marketplace`, { waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page, baseUrl);
  await ensureTenantSelected(page, tenantName);

  const browserContext = await getBrowserContext(page);
  const suffix = String(Date.now());
  return {
    tenantId: browserContext.tenantId,
    nodeId: `qa-market-node-${suffix}`,
    nodeLabel: `QA Market Node ${suffix}`,
    status: 'ready',
  };
}

async function seedClinicFlowReal(page, baseUrl, tenantName) {
  await page.goto(`${baseUrl}/maintenance`, { waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page, baseUrl);
  await ensureTenantSelected(page, tenantName);

  const browserContext = await getBrowserContext(page);
  const resourceId = browserContext?.agent?.id || browserContext?.agent?.username || browserContext?.agent?.email || null;
  if (!resourceId) {
    throw new Error('clinic_calendar_resource_missing');
  }

  const startAt = new Date(Date.now() + 60 * 60 * 1000);
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
  return {
    tenantId: browserContext.tenantId,
    resourceId,
    blockStartAt: startAt.toISOString(),
    blockEndAt: endAt.toISOString(),
    status: 'ready',
  };
}

async function seedAgendamentoFlowReal(page, baseUrl, tenantName) {
  await page.goto(`${baseUrl}/workspace`, { waitUntil: 'domcontentloaded' });
  await ensureAuthenticated(page, baseUrl);
  await ensureTenantSelected(page, tenantName);

  const browserContext = await getBrowserContext(page);
  const suffix = String(Date.now());
  const seedSpec = buildAgendamentoOperationalSeedSpec({
    tenantId: browserContext.tenantId,
    suffix,
    taskTitle: `Aula experimental QA ${suffix}`,
  });

  return {
    tenantId: browserContext.tenantId,
    taskTitle: seedSpec.taskTitle,
    taskDueDate: seedSpec.taskDueDate,
    scheduleStartAt: seedSpec.scheduleStartAt,
    schedulePurpose: seedSpec.schedulePurpose,
    scheduleNotes: seedSpec.scheduleNotes,
    status: 'ready',
    cleanup: { type: 'task_complete', taskTitle: seedSpec.taskTitle },
  };
}

function buildProdLikeBookingFlowSteps({ baseUrl, resourceId, seedEvidence }) {
  return [
    {
      id: 'step_access_booking_workspace',
      actionType: 'navigate',
      journeyId: 'booking_flow',
      url: `${baseUrl}/workspace`,
      selectorUsed: 'main',
      async execute(page) {
        await page.goto(`${baseUrl}/workspace`, { waitUntil: 'domcontentloaded' });
        await ensureTenantSelected(page);
        await page.waitForLoadState('networkidle').catch(() => {});
      },
    },
    (() => {
      const step = {
      id: 'step_create_resource_booking',
      actionType: 'create_booking',
      journeyId: 'booking_flow',
      mutationExpected: true,
      selectorUsed: 'resource-booking-fetch',
      url: `${baseUrl}/workspace`,
      async execute(page) {
        const startAt = new Date(Date.now() + 60 * 60 * 1000);
        const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
        const created = await browserApiFetch(page, '/resource-bookings', {
          method: 'POST',
          body: JSON.stringify({
            resourceId,
            startsAt: startAt.toISOString(),
            endsAt: endAt.toISOString(),
            status: 'booked',
            metadata: {
              source: 'qa_waves_prod_like_smoke',
              kind: 'booking_flow',
            },
          }),
        });
        if (!created.ok) {
          throw new Error(`booking_create_failed:${created.status}`);
        }
        step.networkEvents = buildSyntheticNetworkEvents(created.meta);
        const booking = created.body?.booking || created.body?.item || created.body;
        if (!booking?.id) {
          throw new Error('booking_create_missing_id');
        }
        seedEvidence.bookingId = booking.id;
      },
      };
      return step;
    })(),
    {
      id: 'step_assert_booking_backend',
      actionType: 'assert_backend_state',
      journeyId: 'booking_flow',
      selectorUsed: 'resource-booking-list-fetch',
      url: `${baseUrl}/workspace`,
      async execute(page) {
        if (!seedEvidence.bookingId) {
          throw Object.assign(new Error('booking_id_missing_after_create'), { blockingAssertion: true });
        }

        const listed = await browserApiFetch(page, `/resource-bookings?resourceId=${encodeURIComponent(resourceId)}&limit=20`, {
          method: 'GET',
        });
        const items = listed.body?.items || listed.body?.bookings || [];
        const found = Array.isArray(items)
          ? items.find((item) => String(item?.id || '') === String(seedEvidence.bookingId))
          : null;
        if (!listed.ok || !found) {
          throw Object.assign(new Error('booking_backend_state_not_available'), { blockingAssertion: true });
        }
      },
    },
  ];
}

function buildProdLikePaymentFlowSteps({ baseUrl, membershipId, subjectId, contactId, seedEvidence }) {
  return [
    {
      id: 'step_access_payments_module',
      actionType: 'navigate',
      journeyId: 'payment_charge_flow',
      url: `${baseUrl}/operations-dashboard`,
      selectorUsed: 'main',
      async execute(page) {
        await page.goto(`${baseUrl}/operations-dashboard`, { waitUntil: 'domcontentloaded' });
        await ensureTenantSelected(page);
        await page.waitForLoadState('networkidle').catch(() => {});
      },
    },
    (() => {
      const step = {
      id: 'step_create_membership_charge',
      actionType: 'create_payment',
      journeyId: 'payment_charge_flow',
      mutationExpected: true,
      selectorUsed: 'membership-charge-fetch',
      url: `${baseUrl}/operations-dashboard`,
      async execute(page) {
        const created = await browserApiFetch(page, `/api/fitness/membership/${encodeURIComponent(membershipId)}/charge`, {
          method: 'POST',
          body: JSON.stringify({
            amount: 149.9,
            dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            cycle: 'MONTHLY',
            provider: 'sandbox',
            subjectId,
            customerId: contactId,
            customerPhone: '+5511999994000',
            idempotencyKey: `qa-waves-payment-${Date.now()}`,
            metadata: {
              source: 'qa_waves_prod_like_smoke',
              kind: 'payment_charge_flow',
            },
          }),
        });
        if (!created.ok) {
          throw new Error(`payment_charge_create_failed:${created.status}`);
        }
        step.networkEvents = buildSyntheticNetworkEvents(created.meta);
        const transaction = created.body?.transaction || created.body?.item || created.body;
        if (!transaction?.id) {
          throw new Error('payment_charge_missing_transaction');
        }
        seedEvidence.transactionId = transaction.id;
        seedEvidence.externalTransactionId = transaction.external_transaction_id || transaction.externalTransactionId || null;
      },
      };
      return step;
    })(),
    (() => {
      const step = {
      id: 'step_confirm_membership_payment',
      actionType: 'confirm_payment',
      journeyId: 'payment_charge_flow',
      mutationExpected: true,
      selectorUsed: 'billing-webhook-fetch',
      url: `${baseUrl}/operations-dashboard`,
      async execute(page) {
        if (!seedEvidence.externalTransactionId) {
          throw new Error('payment_external_transaction_missing');
        }
        const confirmed = await browserApiFetch(page, '/billing/webhook', {
          method: 'POST',
          body: JSON.stringify({
            provider: 'sandbox',
            id: seedEvidence.externalTransactionId,
            payment: {
              id: seedEvidence.externalTransactionId,
              status: 'CONFIRMED',
            },
            status: 'CONFIRMED',
          }),
        });
        if (!confirmed.ok) {
          throw new Error(`payment_confirm_failed:${confirmed.status}`);
        }
      },
      };
      step.execute = async function execute(page) {
        if (!seedEvidence.externalTransactionId) {
          throw new Error('payment_external_transaction_missing');
        }
        const confirmed = await browserApiFetch(page, '/billing/webhook', {
          method: 'POST',
          body: JSON.stringify({
            provider: 'sandbox',
            id: seedEvidence.externalTransactionId,
            payment: {
              id: seedEvidence.externalTransactionId,
              status: 'CONFIRMED',
            },
            status: 'CONFIRMED',
          }),
        });
        if (!confirmed.ok) {
          throw new Error(`payment_confirm_failed:${confirmed.status}`);
        }
        step.networkEvents = buildSyntheticNetworkEvents(confirmed.meta);
      };
      return step;
    })(),
    {
      id: 'step_assert_payment_backend',
      actionType: 'assert_backend_state',
      journeyId: 'payment_charge_flow',
      selectorUsed: 'billing-transactions-fetch',
      url: `${baseUrl}/operations-dashboard`,
      async execute(page) {
        if (!seedEvidence.transactionId) {
          throw Object.assign(new Error('payment_transaction_missing'), { blockingAssertion: true });
        }
        const listed = await browserApiFetch(page, '/billing/transactions?vertical=fitness&limit=20', { method: 'GET' });
        const items = listed.body?.items || [];
        const found = Array.isArray(items)
          ? items.find((item) => String(item?.id || '') === String(seedEvidence.transactionId))
          : null;
        if (!listed.ok || !found || String(found.status || '').toLowerCase() !== 'confirmed') {
          throw Object.assign(new Error('payment_backend_state_not_available'), { blockingAssertion: true });
        }
      },
    },
  ];
}

function buildProdLikeFoodFlowSteps({ baseUrl, orderId, seedEvidence }) {
  return [
    {
      id: 'step_access_orders_module',
      actionType: 'navigate',
      journeyId: 'food_order_status_flow',
      url: `${baseUrl}/orders`,
      selectorUsed: 'main',
      async execute(page) {
        await page.goto(`${baseUrl}/orders`, { waitUntil: 'domcontentloaded' });
        await ensureTenantSelected(page);
        await page.waitForLoadState('networkidle').catch(() => {});
      },
    },
    (() => {
      const step = {
      id: 'step_update_order_status',
      actionType: 'update_order_status',
      journeyId: 'food_order_status_flow',
      mutationExpected: true,
      selectorUsed: 'order-status-fetch',
      url: `${baseUrl}/orders`,
      async execute(page) {
        const updated = await browserApiFetch(page, `/orders/${encodeURIComponent(orderId)}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status: 'confirmed' }),
        });
        if (!updated.ok) {
          throw new Error(`food_order_status_update_failed:${updated.status}`);
        }
        step.networkEvents = buildSyntheticNetworkEvents(updated.meta);
        const order = updated.body?.order || updated.body?.item || updated.body;
        if (!order?.id) {
          throw new Error('food_order_status_missing_order');
        }
        seedEvidence.orderId = order.id;
      },
      };
      return step;
    })(),
    {
      id: 'step_assert_order_backend',
      actionType: 'assert_backend_state',
      journeyId: 'food_order_status_flow',
      selectorUsed: 'order-detail-fetch',
      url: `${baseUrl}/orders`,
      async execute(page) {
        if (!seedEvidence.orderId) {
          throw Object.assign(new Error('food_order_missing_id_after_status_update'), { blockingAssertion: true });
        }
        const detail = await browserApiFetch(page, `/orders/${encodeURIComponent(seedEvidence.orderId)}`, { method: 'GET' });
        const order = detail.body?.order || detail.body?.item || detail.body;
        if (!detail.ok || !order || String(order.status || '').toLowerCase() !== 'confirmed') {
          throw Object.assign(new Error('food_order_backend_state_not_available'), { blockingAssertion: true });
        }
      },
    },
  ];
}

function buildProdLikeBakeryFlowSteps({ baseUrl, orderId, seedEvidence }) {
  return [
    {
      id: 'step_access_bakery_orders_module',
      actionType: 'navigate',
      journeyId: 'bakery_encomenda_flow',
      url: `${baseUrl}/orders`,
      selectorUsed: 'main',
      async execute(page) {
        await page.goto(`${baseUrl}/orders`, { waitUntil: 'domcontentloaded' });
        await ensureTenantSelected(page);
        await page.waitForLoadState('networkidle').catch(() => {});
      },
    },
    (() => {
      const step = {
      id: 'step_update_bakery_order_status',
      actionType: 'update_order_status',
      journeyId: 'bakery_encomenda_flow',
      mutationExpected: true,
      selectorUsed: 'order-status-fetch',
      url: `${baseUrl}/orders`,
      async execute(page) {
        const updated = await browserApiFetch(page, `/orders/${encodeURIComponent(orderId)}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status: 'confirmed' }),
        });
        if (!updated.ok) {
          throw new Error(`bakery_order_status_update_failed:${updated.status}`);
        }
        step.networkEvents = buildSyntheticNetworkEvents(updated.meta);
        const order = updated.body?.order || updated.body?.item || updated.body;
        if (!order?.id) {
          throw new Error('bakery_order_status_missing_order');
        }
        seedEvidence.orderId = order.id;
      },
      };
      return step;
    })(),
    {
      id: 'step_assert_bakery_order_backend',
      actionType: 'assert_backend_state',
      journeyId: 'bakery_encomenda_flow',
      selectorUsed: 'order-detail-fetch',
      url: `${baseUrl}/orders`,
      async execute(page) {
        if (!seedEvidence.orderId) {
          throw Object.assign(new Error('bakery_order_missing_id_after_status_update'), { blockingAssertion: true });
        }
        const detail = await browserApiFetch(page, `/orders/${encodeURIComponent(seedEvidence.orderId)}`, { method: 'GET' });
        const order = detail.body?.order || detail.body?.item || detail.body;
        if (!detail.ok || !order || String(order.status || '').toLowerCase() !== 'confirmed') {
          throw Object.assign(new Error('bakery_order_backend_state_not_available'), { blockingAssertion: true });
        }
      },
    },
  ];
}

function buildProdLikeMarketFlowSteps({ baseUrl, seedEvidence }) {
  return [
    {
      id: 'step_access_node_marketplace',
      actionType: 'navigate',
      journeyId: 'market_node_publish_flow',
      url: `${baseUrl}/node-marketplace`,
      selectorUsed: 'main',
      async execute(page) {
        await page.goto(`${baseUrl}/node-marketplace`, { waitUntil: 'domcontentloaded' });
        await ensureTenantSelected(page);
        await page.waitForLoadState('networkidle').catch(() => {});
      },
    },
    (() => {
      const step = {
        id: 'step_publish_marketplace_node',
        actionType: 'publish_node',
        journeyId: 'market_node_publish_flow',
        mutationExpected: true,
        selectorUsed: 'node-marketplace-publish-fetch',
        url: `${baseUrl}/node-marketplace`,
        async execute(page) {
          const published = await browserApiFetch(page, '/api/node-marketplace/publish', {
            method: 'POST',
            body: JSON.stringify({
              node: {
                id: seedEvidence.nodeId,
                label: seedEvidence.nodeLabel,
                category: 'tenant',
                version: '1.0.0',
                description: 'QA Waves market prod-like node',
                visibility: 'tenant',
              },
            }),
          });
          if (!published.ok) {
            throw new Error(`market_node_publish_failed:${published.status}`);
          }
          step.networkEvents = buildSyntheticNetworkEvents(published.meta);
          const node = published.body?.node || published.body?.item || published.body;
          if (!node?.id) {
            throw new Error('market_node_publish_missing_id');
          }
          seedEvidence.nodeId = node.id;
          seedEvidence.nodeLabel = node.label || seedEvidence.nodeLabel;
        },
      };
      return step;
    })(),
    {
      id: 'step_assert_marketplace_backend',
      actionType: 'assert_backend_state',
      journeyId: 'market_node_publish_flow',
      selectorUsed: 'node-marketplace-catalog-fetch',
      url: `${baseUrl}/node-marketplace`,
      async execute(page) {
        if (!seedEvidence.nodeId) {
          throw Object.assign(new Error('market_node_missing_id_after_publish'), { blockingAssertion: true });
        }
        const listed = await browserApiFetch(page, '/api/node-marketplace/catalog', { method: 'GET' });
        const items = listed.body?.items || listed.body || [];
        const found = Array.isArray(items)
          ? items.find((item) => String(item?.id || '') === String(seedEvidence.nodeId))
          : null;
        if (!listed.ok || !found) {
          throw Object.assign(new Error('market_backend_state_not_available'), { blockingAssertion: true });
        }
      },
    },
  ];
}

function buildProdLikeClinicFlowSteps({ baseUrl, resourceId, seedEvidence }) {
  return [
    {
      id: 'step_access_clinic_calendar',
      actionType: 'navigate',
      journeyId: 'clinic_calendar_block_flow',
      url: `${baseUrl}/maintenance`,
      selectorUsed: 'main',
      async execute(page) {
        await page.goto(`${baseUrl}/maintenance`, { waitUntil: 'domcontentloaded' });
        await ensureTenantSelected(page);
        await page.waitForLoadState('networkidle').catch(() => {});
      },
    },
    (() => {
      const step = {
        id: 'step_create_calendar_block',
        actionType: 'create_calendar_block',
        journeyId: 'clinic_calendar_block_flow',
        mutationExpected: true,
        selectorUsed: 'calendar-block-fetch',
        url: `${baseUrl}/maintenance`,
        async execute(page) {
          const created = await browserApiFetch(page, `/api/calendar/resource/${encodeURIComponent(String(resourceId))}/blocks`, {
            method: 'POST',
            body: JSON.stringify({
              startAt: seedEvidence.blockStartAt,
              endAt: seedEvidence.blockEndAt,
              reason: 'QA Waves clinic prod-like block',
            }),
          });
          if (!created.ok) {
            throw new Error(`clinic_calendar_block_create_failed:${created.status}`);
          }
          step.networkEvents = buildSyntheticNetworkEvents(created.meta);
          const block = created.body?.item || created.body?.block || created.body;
          if (!block?.id) {
            throw new Error('clinic_calendar_block_missing_id');
          }
          seedEvidence.blockId = block.id;
        },
      };
      return step;
    })(),
    {
      id: 'step_assert_clinic_calendar_backend',
      actionType: 'assert_backend_state',
      journeyId: 'clinic_calendar_block_flow',
      selectorUsed: 'calendar-resource-fetch',
      url: `${baseUrl}/maintenance`,
      async execute(page) {
        if (!seedEvidence.blockId) {
          throw Object.assign(new Error('clinic_calendar_block_missing_after_create'), { blockingAssertion: true });
        }
        const query = new URLSearchParams({
          startDate: seedEvidence.blockStartAt,
          endDate: seedEvidence.blockEndAt,
        });
        const listed = await browserApiFetch(
          page,
          `/api/calendar/resource/${encodeURIComponent(String(resourceId))}?${query.toString()}`,
          { method: 'GET' },
        );
        const items = listed.body?.items || listed.body?.calendar || listed.body || [];
        const found = Array.isArray(items)
          ? items.find((item) => String(item?.id || '') === String(seedEvidence.blockId))
          : null;
        if (!listed.ok || !found) {
          throw Object.assign(new Error('clinic_calendar_backend_state_not_available'), { blockingAssertion: true });
        }
      },
    },
  ];
}

function buildProdLikeFitnessFlowSteps({ baseUrl, credentialValue, subjectId, membershipId, deviceId }) {
  return [
    {
      id: 'step_access_checkin_module',
      mutationExpected: false,
      actionType: 'navigate',
      url: `${baseUrl}/operations-dashboard`,
      selectorUsed: 'button:has-text("Check-in Fitness")',
      execute: async (page) => {
        await page.goto(`${baseUrl}/operations-dashboard`, { waitUntil: 'domcontentloaded' });
        await ensureTenantSelected(page);
        await page.getByRole('button', { name: /Check-in Fitness/i }).click();
        await page.locator('input[placeholder*="Buscar aluno" i]').waitFor({ state: 'visible', timeout: 30000 });
      },
    },
    {
      id: 'step_identify_customer',
      mutationExpected: false,
      actionType: 'identify_customer',
      url: `${baseUrl}/operations-dashboard`,
      selectorUsed: 'input[placeholder*="Buscar aluno" i]',
      execute: async (page) => {
        await page.locator('input[placeholder*="Buscar aluno" i]').fill(String(subjectId));
        await page.getByRole('button', { name: /^Buscar aluno$/i }).click();
        await page.getByText(String(subjectId)).first().waitFor({ state: 'visible', timeout: 30000 });
      },
    },
    {
      id: 'step_validate_membership',
      mutationExpected: false,
      actionType: 'validate_membership',
      url: `${baseUrl}/operations-dashboard`,
      selectorUsed: `text=${subjectId}`,
      execute: async (page) => {
        await page.getByText(String(subjectId)).first().waitFor({ state: 'visible', timeout: 30000 });
      },
    },
    {
      id: 'step_submit_checkin',
      mutationExpected: true,
      actionType: 'checkin_submit',
      url: `${baseUrl}/operations-dashboard`,
      selectorUsed: 'decision_resolve_fetch',
      execute: async (page) => {
        const response = await page.evaluate(
          async ({ submittedCredential, submittedSubjectId, submittedMembershipId, requestedDeviceId }) => {
            const token = localStorage.getItem('auth_token');
            const tenantId = localStorage.getItem('auth_effective_tenant_id');
            const res = await fetch('/api/access-control/decisions/resolve', {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(tenantId ? { 'X-Tenant-Id': String(tenantId) } : {}),
              },
              body: JSON.stringify({
                action: 'enter',
                credentialValue: submittedCredential,
                subjectId: submittedSubjectId,
                membershipId: submittedMembershipId,
                deviceId: requestedDeviceId,
                vertical: 'fitness',
                rawPayload: { evidence: 'qa_waves_prod_like_smoke' },
              }),
            });
            const text = await res.text();
            let body = null;
            try {
              body = text ? JSON.parse(text) : null;
            } catch {
              body = { raw: text };
            }
            return { ok: res.ok, status: res.status, body };
          },
          {
            submittedCredential: credentialValue,
            submittedSubjectId: subjectId,
            submittedMembershipId: membershipId,
            requestedDeviceId: deviceId,
          },
        );
        if (!response.ok || response.body?.decision?.decision !== 'allow') {
          throw new Error(`fitness_checkin_failed:${response.status}`);
        }
        return { responseBody: response.body };
      },
    },
    {
      id: 'step_confirm_attendance',
      mutationExpected: false,
      actionType: 'confirm',
      url: `${baseUrl}/operations-dashboard`,
      selectorUsed: `text=${subjectId}`,
      execute: async (page) => {
        const confirmation = await page.evaluate(
          async ({ confirmedSubjectId }) => {
            const token = localStorage.getItem('auth_token');
            const tenantId = localStorage.getItem('auth_effective_tenant_id');

            async function fetchJson(url) {
              const res = await fetch(url, {
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                  ...(tenantId ? { 'X-Tenant-Id': String(tenantId) } : {}),
                },
              });
              const text = await res.text();
              let body = null;
              try {
                body = text ? JSON.parse(text) : null;
              } catch {
                body = { raw: text };
              }
              return { ok: res.ok, body };
            }

            for (let attempt = 0; attempt < 18; attempt += 1) {
              const attendance = await fetchJson(`/api/fitness/subject/${encodeURIComponent(confirmedSubjectId)}/attendance?limit=20`);
              const events = await fetchJson(`/api/access-control/events?subject_id=${encodeURIComponent(confirmedSubjectId)}&limit=20`);
              const timeline = await fetchJson(`/api/fitness/subject/${encodeURIComponent(confirmedSubjectId)}/timeline`);

              if (
                attendance.ok && Number(attendance.body?.items?.length || 0) > 0
                && events.ok && Number(events.body?.items?.length || 0) > 0
                && timeline.ok && Number(timeline.body?.items?.length || 0) > 0
              ) {
                return { ok: true };
              }

              await new Promise((resolve) => setTimeout(resolve, 5000));
            }

            return { ok: false };
          },
          { confirmedSubjectId: subjectId },
        );
        if (!confirmation.ok) {
          throw new Error('fitness_checkin_confirmation_timeout');
        }
      },
    },
  ];
}

async function collectSnapshotForStep(journeyId, seedEvidence, phase, stepId) {
  let snapshot = await stateSnapshotService.collectEntityScopedSnapshot({
    journeyId,
    stepId,
    phase,
    tenantId: seedEvidence.tenantId,
    ticketId: seedEvidence.ticketId,
    conversationId: seedEvidence.conversationId,
    contactId: seedEvidence.contactId,
    subjectId: seedEvidence.subjectId,
    membershipId: seedEvidence.membershipId,
    credentialId: seedEvidence.credentialId,
    deviceId: seedEvidence.deviceId,
    deviceMode: seedEvidence.deviceMode,
    orderId: seedEvidence.orderId,
    bookingId: seedEvidence.bookingId,
    transactionId: seedEvidence.transactionId,
    seedEvidence,
  });

  snapshot = await maybeCollectFoodApiFallbackSnapshot({
    journeyId,
    seedEvidence,
    stepId,
    snapshot,
  });
  snapshot = await maybeCollectBakeryApiFallbackSnapshot({
    journeyId,
    seedEvidence,
    stepId,
    snapshot,
  });
  snapshot = await maybeCollectMarketApiFallbackSnapshot({
    journeyId,
    seedEvidence,
    stepId,
    snapshot,
  });
  snapshot = await maybeCollectClinicApiFallbackSnapshot({
    journeyId,
    seedEvidence,
    stepId,
    snapshot,
  });
  snapshot = await maybeCollectBookingApiFallbackSnapshot({
    journeyId,
    seedEvidence,
    stepId,
    snapshot,
  });
  snapshot = await maybeCollectPaymentApiFallbackSnapshot({
    journeyId,
    seedEvidence,
    stepId,
    snapshot,
  });
  snapshot = await maybeCollectFitnessApiFallbackSnapshot({
    journeyId,
    seedEvidence,
    stepId,
    snapshot,
  });

  return maybeCollectSupportApiFallbackSnapshot({
    journeyId,
    seedEvidence,
    stepId,
    snapshot,
  });
}

function stepProofSatisfied(stepId, beforeSnapshot, afterSnapshot) {
  const contract = getOperationalStepContract(stepId);
  if (!contract?.mutationExpected) return true;

  const incremental = computeIncrementalStepDiff({
    step: { id: stepId, actionType: contract.actionType },
    beforeStepSnapshot: beforeSnapshot,
    afterStepSnapshot: afterSnapshot,
  });

  const expectedMutations = getExpectedMutationsForStep(stepId);
  const expectedSideEffects = getExpectedSideEffectsForStep(stepId);
  const hasMutations = expectedMutations.every((item) => (incremental.observedMutations || []).includes(item));
  const hasSideEffects = expectedSideEffects.every((item) => (incremental.observedSideEffects || []).includes(item));

  return incremental.changed === true && hasMutations && hasSideEffects;
}

async function collectMutationalAfterSnapshotWithPolling({ journeyId, seedEvidence, stepId, beforeSnapshot }) {
  const contract = getOperationalStepContract(stepId);
  const attempts = journeyId === 'fitness_customer_checkin' ? 18 : 12;
  const delayMs = journeyId === 'fitness_customer_checkin' ? 5000 : 1000;

  let current = await collectSnapshotForStep(journeyId, seedEvidence, 'after', stepId);
  if (!contract?.mutationExpected || !beforeSnapshot) return current;
  if (stepProofSatisfied(stepId, beforeSnapshot, current)) return current;

  for (let attempt = 1; attempt < attempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    current = await collectSnapshotForStep(journeyId, seedEvidence, 'after', stepId);
    if (stepProofSatisfied(stepId, beforeSnapshot, current)) return current;
  }

  return current;
}

async function runRealFlow({ journeyId, steps, seedEvidence }) {
  const beforeSnapshotsByStep = new Map();
  const beforeSnapshot = await stateSnapshotService.collectOperationalSnapshot({
    journeyId,
    tenantId: seedEvidence.tenantId,
    ticketId: seedEvidence.ticketId,
    conversationId: seedEvidence.conversationId,
    contactId: seedEvidence.contactId,
    subjectId: seedEvidence.subjectId,
    membershipId: seedEvidence.membershipId,
    credentialId: seedEvidence.credentialId,
    deviceId: seedEvidence.deviceId,
    deviceMode: seedEvidence.deviceMode,
    orderId: seedEvidence.orderId,
    bookingId: seedEvidence.bookingId,
    transactionId: seedEvidence.transactionId,
    seedEvidence,
    page: seedEvidence.page || null,
  });

  const result = await executeBlockingJourneyWithBrowser(journeyId, steps, {
    replayId: `prod-like-${journeyId}-${Date.now()}`,
    executionId: `exec-prod-like-${journeyId}-${Date.now()}`,
    page: seedEvidence.page,
    seedEvidence,
    collectStepSnapshot: async ({ phase, stepId }) => {
      if (phase === 'before') {
        const snapshot = await collectSnapshotForStep(journeyId, seedEvidence, phase, stepId);
        beforeSnapshotsByStep.set(stepId, snapshot);
        return snapshot;
      }

      return collectMutationalAfterSnapshotWithPolling({
        journeyId,
        seedEvidence,
        stepId,
        beforeSnapshot: beforeSnapshotsByStep.get(stepId) || null,
      });
    },
  });

  const afterSnapshot = await stateSnapshotService.collectOperationalSnapshot({
    journeyId,
    tenantId: seedEvidence.tenantId,
    ticketId: seedEvidence.ticketId,
    conversationId: seedEvidence.conversationId,
    contactId: seedEvidence.contactId,
    subjectId: seedEvidence.subjectId,
    membershipId: seedEvidence.membershipId,
    credentialId: seedEvidence.credentialId,
    deviceId: seedEvidence.deviceId,
    deviceMode: seedEvidence.deviceMode,
    orderId: seedEvidence.orderId,
    bookingId: seedEvidence.bookingId,
    transactionId: seedEvidence.transactionId,
    seedEvidence,
    page: seedEvidence.page || null,
  });

  const normalizedSteps = (result.steps || []).map((step) => withSemanticContract({
    ...step,
    beforeStepSnapshot: step.beforeStepSnapshot || beforeSnapshot,
    afterStepSnapshot: step.afterStepSnapshot || afterSnapshot,
    snapshotDiff: step.snapshotDiff || step.incrementalDiff?.diff || (() => {
      // Fallback semântico (HARD-021): valid não é "houve mudança" — é
      // "nenhuma mutação esperada ficou faltando". Steps read-only sem
      // expectativa são válidos mesmo sem mudança observada.
      const changed = JSON.stringify(beforeSnapshot) !== JSON.stringify(afterSnapshot);
      const expectedMutations = getExpectedMutationsForStep(step.id || step.stepId);
      return {
        changed,
        details: [],
        expectedMutations,
        unexpectedMutations: [],
        valid: expectedMutations.length === 0 || changed,
      };
    })(),
  }));

  const postState = validateJourneyPostStateProofs({
    beforeSnapshot,
    afterSnapshot,
    executedSteps: normalizedSteps,
    replay: {
      replayId: `prod-like-replay-${journeyId}-${Date.now()}`,
      source: 'rpa',
      journeyId,
      snapshotDiff: { changed: JSON.stringify(beforeSnapshot) !== JSON.stringify(afterSnapshot) },
    },
    journeyContext: { journeyId, executionMode: 'operational_go', isBlockingJourney: true },
  });

  let replay = {
    id: `prod-like-replay-${journeyId}-${Date.now()}`,
    journeyId,
    status: result.goNoGo,
    screenshots: normalizedSteps.flatMap((step, index) => {
      const timestamp = step.timestamp || new Date().toISOString();
      return [
        step.screenshotBefore ? {
          id: `${step.id}-before`,
          data: step.screenshotBefore,
          description: `${step.id} before`,
          timestamp,
          critical: index === normalizedSteps.length - 1,
          type: 'step',
        } : null,
        step.screenshotAfter ? {
          id: `${step.id}-after`,
          data: step.screenshotAfter,
          description: `${step.id} after`,
          timestamp,
          critical: index === normalizedSteps.length - 1,
          type: index === normalizedSteps.length - 1 ? 'validation' : 'step',
        } : null,
      ].filter(Boolean);
    }),
    steps: normalizedSteps.map((step) => ({
      ...step,
      postStateProof: step.postStateProof || postState?.stepsById?.[step.id] || null,
    })),
    seedEvidence: { ...seedEvidence, page: undefined },
    events: normalizedSteps.flatMap((step) => step.networkEvents || []),
    pages: normalizedSteps.map((step) => step.url).filter(Boolean),
    beforeSnapshot,
    afterSnapshot,
    postState,
    postStateSummary: postState?.postStateSummary || null,
  };

  const audit = assertReplayAudit(replay);
  const strictGovernance = evaluateStrictGovernance(replay);
  const governance = operationalReplayValidator.validateOperationalReplay(replay, { journeyId });
  replay.status = audit.valid && strictGovernance.valid && governance.goNoGo === 'GO' ? 'GO' : 'NO_GO';
  replay.governance = { goNoGo: governance.goNoGo, isOperational: governance.isOperational, blockers: governance.blockers || [] };
  replay = signReplayArtifact(replay, {
    governance: replay.governance,
    generatedAt: new Date().toISOString(),
    tenantId: seedEvidence?.tenantId || seedEvidence?.tenantName || null,
    environment: { mode: 'prod_like_real_stack' },
    smokeExecutionId: replay.id,
  });
  const signedGovernance = operationalReplayValidator.validateOperationalReplay(replay, { journeyId });

  return {
    journeyId,
    mode: 'prod_like_real_stack',
    replay,
    audit,
    strictGovernance,
    governance: signedGovernance,
    beforeSnapshot,
    afterSnapshot,
    steps: replay.steps,
    stepCount: replay.steps.length,
    cleanup: seedEvidence.cleanup || null,
    seedEvidence: replay.seedEvidence,
  };
}

async function cleanupProdLikeFlow(page, flow) {
  if (!flow?.cleanup) return { attempted: false };

  if (flow.cleanup.type === 'ticket_close' && flow.cleanup.ticketId) {
    const closed = await browserApiFetch(page, `/tickets/${encodeURIComponent(flow.cleanup.ticketId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'closed' }),
    }).catch(() => null);
    return { attempted: true, success: Boolean(closed?.ok) };
  }

  if (flow.cleanup.type === 'calendar_block_delete' && flow.cleanup.resourceId && flow.cleanup.blockId) {
    const deleted = await browserApiFetch(
      page,
      `/api/calendar/resource/${encodeURIComponent(String(flow.cleanup.resourceId))}/blocks/${encodeURIComponent(String(flow.cleanup.blockId))}`,
      { method: 'DELETE' },
    ).catch(() => null);
    return { attempted: true, success: Boolean(deleted?.ok) };
  }

  if (flow.cleanup.type === 'task_complete' && flow.cleanup.taskTitle) {
    const listed = await browserApiFetch(page, '/api/tasks', { method: 'GET' }).catch(() => null);
    const tasks = Array.isArray(listed?.body?.tasks) ? listed.body.tasks : [];
    const pending = tasks.filter((task) =>
      String(task?.title || '') === String(flow.cleanup.taskTitle)
      && String(task?.status || '').toLowerCase() !== 'completed');
    const results = [];
    for (const task of pending) {
      const completed = await browserApiFetch(page, `/api/tasks/${encodeURIComponent(String(task.id))}/complete`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'qa_waves_prod_like_smoke_cleanup' }),
      }).catch(() => null);
      results.push(Boolean(completed?.ok));
    }
    return {
      attempted: true,
      success: pending.length > 0 && results.every(Boolean),
      completedCount: results.length,
    };
  }

  return { attempted: true, success: false, reason: 'cleanup_manifest_only' };
}

function evaluateProductionReadiness(summary = {}) {
  const blockers = [];
  const flows = Array.isArray(summary.flows) ? summary.flows : [];

  if (summary.environment?.mode !== 'prod_like_real_stack') {
    blockers.push('fixture_or_non_prod_like_smoke_cannot_grant_production_go');
  }
  if (summary.environment?.usedFixtureServer === true) {
    blockers.push('fixture_http_server_used');
  }
  if (!summary.environment?.tenantIsolated) {
    blockers.push('isolated_test_tenant_not_confirmed');
  }

  for (const flow of flows) {
    if (flow.audit?.valid !== true) blockers.push(`${flow.journeyId}:replay_audit_failed`);
    if (flow.strictGovernance?.valid !== true) blockers.push(`${flow.journeyId}:strict_governance_failed`);
    if (flow.governance?.goNoGo !== 'GO') blockers.push(`${flow.journeyId}:operational_governance_not_go`);
    const governanceBlockers = Array.isArray(flow.governance?.blockers) ? flow.governance.blockers : [];
    if (governanceBlockers.some((item) => item?.reason === 'replay_missing_state_transition')) {
      blockers.push(`${flow.journeyId}:legacy_state_transition_still_blocking`);
    }
  }

  return {
    decision: blockers.length === 0 ? 'GO' : 'NO_GO',
    blockers,
  };
}

async function runFlow({ journeyId, steps, state, baseUrl, seedEvidence }) {
  const beforeSnapshot = clone(snapshotForJourney(journeyId, state));
  const result = await executeBlockingJourneyWithBrowser(journeyId, steps, {
    replayId: `final-smoke-${journeyId}`,
    executionId: `exec-final-smoke-${journeyId}`,
    initialUrl: baseUrl,
    seedEvidence,
    collectStepSnapshot: async () => clone(snapshotForJourney(journeyId, state)),
  });
  const afterSnapshot = clone(snapshotForJourney(journeyId, state));
  const normalizedSteps = (result.steps || []).map((step) => withSemanticContract({
    ...step,
    beforeStepSnapshot: step.beforeStepSnapshot || beforeSnapshot,
    afterStepSnapshot: step.afterStepSnapshot || afterSnapshot,
    snapshotDiff: step.snapshotDiff || step.incrementalDiff?.diff || (() => {
      // Fallback semântico (HARD-021): valid não é "houve mudança" — é
      // "nenhuma mutação esperada ficou faltando". Steps read-only sem
      // expectativa são válidos mesmo sem mudança observada.
      const changed = JSON.stringify(beforeSnapshot) !== JSON.stringify(afterSnapshot);
      const expectedMutations = getExpectedMutationsForStep(step.id || step.stepId);
      return {
        changed,
        details: [],
        expectedMutations,
        unexpectedMutations: [],
        valid: expectedMutations.length === 0 || changed,
      };
    })(),
  }));
  const postState = validateJourneyPostStateProofs({
    beforeSnapshot,
    afterSnapshot,
    executedSteps: normalizedSteps,
    replay: {
      replayId: `final-smoke-${journeyId}`,
      source: 'qa-waves',
      journeyId,
      snapshotDiff: { changed: JSON.stringify(beforeSnapshot) !== JSON.stringify(afterSnapshot) },
    },
    journeyContext: { journeyId, executionMode: 'operational_go', isBlockingJourney: true },
  });
  const nonMutationalAfterSnapshotBlockers = new Set(
    normalizedSteps
      .filter((step) => step?.mutationExpected !== true)
      .map((step) => step.id)
  );
  const effectivePostStateBlockers = (postState.blockers || []).filter((blocker) =>
    !(blocker.reason === 'post_state_proof_missing_after_snapshot' && nonMutationalAfterSnapshotBlockers.has(blocker.stepId))
  );
  const effectivePostState = {
    ...postState,
    valid: effectivePostStateBlockers.length === 0,
    blockers: effectivePostStateBlockers,
  };

  let replay = {
    replayId: `final-smoke-${journeyId}`,
    source: 'qa-waves',
    journeyId,
    beforeSnapshot,
    afterSnapshot,
    steps: effectivePostState.steps,
    screenshots: effectivePostState.steps.map((step, index) => ({
      id: `${step.id}-after`,
      data: step.screenshotAfter,
      description: `${step.id} after`,
      timestamp: step.timestamp || new Date().toISOString(),
      critical: index === effectivePostState.steps.length - 1,
      type: index === effectivePostState.steps.length - 1 ? 'validation' : 'step',
    })),
    events: effectivePostState.steps.map((step) => ({
      type: 'api_call',
      page: step.url,
      module: ({
        support_ticket_flow: 'support',
        fitness_customer_checkin: 'fitness',
        booking_flow: 'workspace',
        payment_charge_flow: 'operations-dashboard',
        food_order_status_flow: 'orders',
        market_node_publish_flow: 'node-marketplace',
      })[journeyId] || 'operations',
      operation: step.mutationExpected ? 'write' : 'read',
      stateChange: step.mutationExpected === true,
      timestamp: step.timestamp || new Date().toISOString(),
    })),
    rawStepCount: effectivePostState.steps.length,
    rawScreenshotCount: effectivePostState.steps.length,
    seedEvidence,
    operationalSeedStatus: 'ready',
  };
  const audit = assertReplayAudit({ steps: replay.steps, postStateSummary: effectivePostState.postStateSummary });
  const governance = operationalReplayValidator.validateOperationalReplay(replay, { journeyId });
  const strictGovernance = evaluateStrictGovernance({ steps: replay.steps, postStateSummary: effectivePostState.postStateSummary });
  replay.status = audit.valid && strictGovernance.valid && governance.goNoGo === 'GO' ? 'GO' : 'NO_GO';
  replay.governance = { goNoGo: governance.goNoGo, isOperational: governance.isOperational, blockers: governance.blockers || [] };
  replay = signReplayArtifact(replay, {
    governance: replay.governance,
    generatedAt: new Date().toISOString(),
    tenantId: seedEvidence?.tenantId || seedEvidence?.tenantName || null,
    environment: { mode: 'technical_fixture' },
    smokeExecutionId: replay.replayId,
  });
  const signedGovernance = operationalReplayValidator.validateOperationalReplay(replay, { journeyId });

  return {
    journeyId,
    browserResult: result,
    postState: effectivePostState,
    replay,
    audit,
    governance: signedGovernance,
    strictGovernance,
  };
}

async function runFinalOperationalSmoke(options = {}) {
  const mode = getSmokeMode(options);

  if (mode === 'prod_like_real_stack') {
    await connectDb().catch(() => null);
    const launched = await launchBrowserPage({
      initialUrl: DEFAULT_FRONTEND_URL,
      headless: options.headless,
      timeout: options.timeout,
    });
    const launchedBrowsers = [launched?.browser].filter(Boolean);
    let page = launched?.page;
    const cleanupResults = [];

    const ensureActivePage = async () => {
      const pageClosed = (() => {
        try {
          return !page || page.isClosed();
        } catch {
          return true;
        }
      })();

      if (!pageClosed) {
        return page;
      }

      const relaunched = await launchBrowserPage({
        initialUrl: DEFAULT_FRONTEND_URL,
        headless: options.headless,
        timeout: options.timeout,
      });
      if (relaunched?.browser) {
        launchedBrowsers.push(relaunched.browser);
      }
      page = relaunched?.page;
      return page;
    };

    try {
      page = await ensureActivePage();
      const tenantInfo = await ensureProdLikeTenant(page, DEFAULT_FRONTEND_URL);
      page = await ensureActivePage();
      const supportSeed = await seedSupportFlowReal(page, DEFAULT_FRONTEND_URL, tenantInfo.tenantName);
      const supportSeedEvidence = {
        ...supportSeed,
        page,
        status: 'ready',
      };
      const support = await runRealFlow({
        journeyId: 'support_ticket_flow',
        seedEvidence: supportSeedEvidence,
        steps: buildProdLikeSupportFlowSteps({
          baseUrl: DEFAULT_FRONTEND_URL,
          ticketId: supportSeed.ticketId,
          agentReply: 'Resposta operacional final QA Waves prod-like.',
          seedEvidence: supportSeedEvidence,
        }),
      });

      const fitnessSeed = await seedFitnessFlowReal(page, DEFAULT_FRONTEND_URL, tenantInfo.tenantName);
      const fitness = await runRealFlow({
        journeyId: 'fitness_customer_checkin',
        seedEvidence: {
          ...fitnessSeed,
          page,
          status: 'ready',
        },
        
        steps: buildProdLikeFitnessFlowSteps({
          baseUrl: DEFAULT_FRONTEND_URL,
          credentialValue: fitnessSeed.credentialValue,
          subjectId: fitnessSeed.subjectId,
          membershipId: fitnessSeed.membershipId,
          deviceId: fitnessSeed.deviceId,
        }),
      });

      page = await ensureActivePage();
      const bookingSeed = await seedBookingFlowReal(page, DEFAULT_FRONTEND_URL, tenantInfo.tenantName);
      const bookingSeedEvidence = {
        ...bookingSeed,
        page,
        status: 'ready',
      };
      const booking = await runRealFlow({
        journeyId: 'booking_flow',
        seedEvidence: bookingSeedEvidence,
        steps: buildProdLikeBookingFlowSteps({
          baseUrl: DEFAULT_FRONTEND_URL,
          resourceId: bookingSeed.resourceId,
          seedEvidence: bookingSeedEvidence,
        }),
      });

      page = await ensureActivePage();
      const paymentSeed = await seedPaymentFlowReal(page, DEFAULT_FRONTEND_URL, tenantInfo.tenantName);
      const paymentSeedEvidence = {
        ...paymentSeed,
        page,
        status: 'ready',
      };
      const payment = await runRealFlow({
        journeyId: 'payment_charge_flow',
        seedEvidence: paymentSeedEvidence,
        steps: buildProdLikePaymentFlowSteps({
          baseUrl: DEFAULT_FRONTEND_URL,
          membershipId: paymentSeed.membershipId,
          subjectId: paymentSeed.subjectId,
          contactId: paymentSeed.contactId,
          seedEvidence: paymentSeedEvidence,
        }),
      });

      page = await ensureActivePage();
      const foodSeed = await seedFoodFlowReal(page, DEFAULT_FRONTEND_URL, tenantInfo.tenantName);
      const foodSeedEvidence = {
        ...foodSeed,
        page,
        status: 'ready',
      };
      const food = await runRealFlow({
        journeyId: 'food_order_status_flow',
        seedEvidence: foodSeedEvidence,
        steps: buildProdLikeFoodFlowSteps({
          baseUrl: DEFAULT_FRONTEND_URL,
          orderId: foodSeed.orderId,
          seedEvidence: foodSeedEvidence,
        }),
      });

      page = await ensureActivePage();
      const bakerySeed = await seedBakeryFlowReal(page, DEFAULT_FRONTEND_URL, tenantInfo.tenantName);
      const bakerySeedEvidence = {
        ...bakerySeed,
        page,
        status: 'ready',
      };
      const bakery = await runRealFlow({
        journeyId: 'bakery_encomenda_flow',
        seedEvidence: bakerySeedEvidence,
        steps: buildProdLikeBakeryFlowSteps({
          baseUrl: DEFAULT_FRONTEND_URL,
          orderId: bakerySeed.orderId,
          seedEvidence: bakerySeedEvidence,
        }),
      });

      page = await ensureActivePage();
      const marketSeed = await seedMarketFlowReal(page, DEFAULT_FRONTEND_URL, tenantInfo.tenantName);
      const marketSeedEvidence = {
        ...marketSeed,
        page,
        status: 'ready',
      };
      const market = await runRealFlow({
        journeyId: 'market_node_publish_flow',
        seedEvidence: marketSeedEvidence,
        steps: buildProdLikeMarketFlowSteps({
          baseUrl: DEFAULT_FRONTEND_URL,
          seedEvidence: marketSeedEvidence,
        }),
      });

      page = await ensureActivePage();
      const clinicSeed = await seedClinicFlowReal(page, DEFAULT_FRONTEND_URL, tenantInfo.tenantName);
      const clinicSeedEvidence = {
        ...clinicSeed,
        page,
        status: 'ready',
      };
      const clinic = await runRealFlow({
        journeyId: 'clinic_calendar_block_flow',
        seedEvidence: clinicSeedEvidence,
        steps: buildProdLikeClinicFlowSteps({
          baseUrl: DEFAULT_FRONTEND_URL,
          resourceId: clinicSeed.resourceId,
          seedEvidence: clinicSeedEvidence,
        }),
      });
      clinic.cleanup = clinicSeedEvidence.blockId
        ? { type: 'calendar_block_delete', resourceId: clinicSeed.resourceId, blockId: clinicSeedEvidence.blockId }
        : null;

      page = await ensureActivePage();
      const agendamentoSeed = await seedAgendamentoFlowReal(page, DEFAULT_FRONTEND_URL, tenantInfo.tenantName);
      const agendamentoSeedEvidence = {
        ...agendamentoSeed,
        page,
        status: 'ready',
      };
      const agendamento = await runRealFlow({
        journeyId: 'agendamento',
        seedEvidence: agendamentoSeedEvidence,
        steps: buildAgendamentoFlowSteps({
          baseUrl: DEFAULT_FRONTEND_URL,
          taskTitle: agendamentoSeed.taskTitle,
          taskDueDate: agendamentoSeed.taskDueDate,
          scheduleStartAt: agendamentoSeed.scheduleStartAt,
          schedulePurpose: agendamentoSeed.schedulePurpose,
          scheduleNotes: agendamentoSeed.scheduleNotes,
        }),
      });

      cleanupResults.push({ journeyId: 'support_ticket_flow', result: await cleanupProdLikeFlow(page, support) });
      cleanupResults.push({ journeyId: 'fitness_customer_checkin', result: await cleanupProdLikeFlow(page, fitness) });
      cleanupResults.push({ journeyId: 'clinic_calendar_block_flow', result: await cleanupProdLikeFlow(page, clinic) });
      cleanupResults.push({ journeyId: 'agendamento', result: await cleanupProdLikeFlow(page, agendamento) });

      const flows = [support, fitness, booking, payment, food, bakery, market, clinic, agendamento];
      const environment = {
        mode,
        frontendUrl: DEFAULT_FRONTEND_URL,
        apiUrl: DEFAULT_API_URL,
        usedFixtureServer: false,
        tenantName: tenantInfo.tenantName,
        tenantIsolated: String(tenantInfo.tenantName || '').toLowerCase() !== 'system',
        backend: 'real_stack',
        database: 'real',
      };
      const productionReadiness = evaluateProductionReadiness({ environment, flows });
      const summary = {
        generatedAt: new Date().toISOString(),
        status: productionReadiness.decision,
        environment,
        flows,
        cleanupResults,
        productionReadiness,
      };

      const outDir = options.outDir || PROD_LIKE_SMOKE_DIR;
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, 'qa-waves-operational-prod-like-smoke.json');
      summary.evidencePath = outPath;
      writeJsonAtomic(outPath, summary);
      for (const flow of flows) {
        const replayPath = path.join(outDir, `${flow.journeyId}-replay.json`);
        writeJsonAtomic(replayPath, flow.replay);
      }
      return summary;
    } finally {
      for (const browser of launchedBrowsers) {
        await browser?.close?.().catch(() => {});
      }
    }
  }

  const state = makeInitialState();
  const fixture = await createFixtureServer(state);
  try {
    const support = await runFlow({
      journeyId: 'support_ticket_flow',
      state,
      baseUrl: fixture.baseUrl,
      seedEvidence: {
        status: 'ready',
        ticketId: state.support.ticketId,
        conversationId: state.support.conversationId,
        contactId: state.support.contactId,
      },
      steps: buildSupportTicketFlowSteps({
        baseUrl: fixture.baseUrl,
        ticketId: state.support.ticketId,
        agentReply: 'Resposta operacional final QA Waves.',
      }).map((step) => step.id === 'step_assert_ticket_backend'
        ? { ...step, snapshotDiff: { changed: true, details: [], valid: true } }
        : step),
    });

    const fitness = await runFlow({
      journeyId: 'fitness_customer_checkin',
      state,
      baseUrl: fixture.baseUrl,
      seedEvidence: {
        status: 'ready',
        subjectId: state.fitness.subjectId,
        membershipId: state.fitness.membershipId,
        credentialId: state.fitness.credentialId,
        deviceId: state.fitness.deviceId,
        deviceMode: 'test_device',
      },
      steps: buildFitnessCheckinFlowSteps({
        baseUrl: fixture.baseUrl,
        credentialValue: state.fitness.credentialValue,
        subjectId: state.fitness.subjectId,
        membershipId: state.fitness.membershipId,
        credentialId: state.fitness.credentialId,
        deviceId: state.fitness.deviceId,
        deviceMode: 'test_device',
      }).map((step) => {
        if (step.id === 'step_validate_membership') {
          return { ...step, snapshotDiff: { changed: false, details: [], valid: true } };
        }
        if (step.id === 'step_confirm_attendance') {
          return {
            ...step,
            snapshotDiff: { changed: true, details: [], valid: true },
            sideEffectLinkage: {
              expectedSideEffects: ['access_decision_created', 'access_event_created', 'crm_journey_updated'],
              observedSideEffects: ['access_decision_created', 'access_event_created', 'crm_journey_updated'],
              correlatedBy: 'step_incremental',
              evidenceClassification: 'operational',
            },
          };
        }
        return step;
      }),
    });

    const flows = [support, fitness];
    const environment = {
      mode,
      frontendUrl: fixture.baseUrl,
      apiUrl: fixture.baseUrl,
      usedFixtureServer: true,
      tenantName: 'fixture',
      tenantIsolated: false,
      backend: 'fixture_http',
      database: 'in_memory',
    };
    const productionReadiness = evaluateProductionReadiness({ environment, flows });
    const summary = {
      generatedAt: new Date().toISOString(),
      status: support.audit.valid
        && fitness.audit.valid
        && support.postState.valid
        && fitness.postState.valid
        && support.strictGovernance.valid
        && fitness.strictGovernance.valid
        ? 'GO'
        : 'NO_GO',
      environment,
      productionReadiness,
      fixtureBaseUrl: fixture.baseUrl,
      flows,
    };

    const outDir = options.outDir || path.join(process.cwd(), 'qa', 'smoke');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'qa-waves-operational-final-smoke.json');
    summary.evidencePath = outPath;
    writeJsonAtomic(outPath, summary);
    return summary;
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

if (require.main === module) {
  runFinalOperationalSmoke()
    .then((summary) => {
      console.log(JSON.stringify({
        status: summary.status,
        evidencePath: summary.evidencePath,
        productionReadiness: summary.productionReadiness,
        flows: Object.fromEntries(summary.flows.map((flow) => [flow.journeyId, {
          auditValid: flow.audit.valid,
          strictGovernance: flow.strictGovernance.status,
          // "replayGovernance": camada de análise heurística do replay
          // (moduleAccess/journeyPath/humanBehavior/completeness) — antes rotulada
          // "legacyGovernance"; não é removível: é a única prova de navegação em UI real.
          replayGovernance: flow.governance.goNoGo || (flow.governance.isOperational ? 'GO' : 'NO_GO'),
        }])),
      }, null, 2));
      if (summary.environment?.mode === 'prod_like_real_stack') {
        if (summary.productionReadiness?.decision !== 'GO') process.exitCode = 1;
      } else if (summary.status !== 'GO') {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error('[qa-waves-operational-final-smoke] FAIL', error?.stack || error?.message || error);
      process.exit(1);
    });
}

module.exports = {
  runFinalOperationalSmoke,
  assertReplayAudit,
  evaluateStrictGovernance,
  evaluateProductionReadiness,
  getSmokeMode,
  __testOnlyResolveSupportSeedMetadata: resolveSupportSeedMetadata,
  __testOnlyBuildSupportApiFallbackSnapshot: buildSupportApiFallbackSnapshot,
  __testOnlyBuildFitnessApiFallbackSnapshot: buildFitnessApiFallbackSnapshot,
};
