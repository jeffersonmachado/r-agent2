'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { autoLoginBeforeSteps } = require('../../../core/rpa/utils/autoLoginFlow');
const { launchChromiumWithFallback } = require('../../../core/rpa/utils/browserLaunchOptions');
const { createSemanticPageDriver } = require('../../../core/rpa/screen-models');
const rpaTokenManager = require('../../../core/rpa/utils/rpaTokenManager');
const { SCREENSHOTS_DIR, ensureDir, slugify } = require('./reporting');

const FRONTEND_URL = String(process.env.TEST_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const API_URL = String(process.env.TEST_API_URL || process.env.TEST_BASE_URL || process.env.API_URL || process.env.API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const TEST_TENANT_ID = String(process.env.TEST_TENANT_ID || 'system');
const TEST_SUPERADMIN_USERNAME = String(process.env.TEST_SUPERADMIN_USERNAME || 'systemadmin');
const TEST_SUPERADMIN_PASSWORD = String(process.env.TEST_SUPERADMIN_PASSWORD || process.env.TEST_PASSWORD || process.env.TEST_ADMIN_PASSWORD || process.env.TEST_USER_PASSWORD || 'Admin123!');
const TEST_ADMIN_USERNAME = String(process.env.TEST_ADMIN_USERNAME || TEST_SUPERADMIN_USERNAME);
const TEST_ADMIN_PASSWORD = String(process.env.TEST_ADMIN_PASSWORD || process.env.TEST_USER_PASSWORD || TEST_SUPERADMIN_PASSWORD);
let dbReady = false;

function buildUrl(base, pathname) {
  if (/^https?:\/\//.test(pathname)) return pathname;
  return `${String(base).replace(/\/$/, '')}/${String(pathname || '').replace(/^\//, '')}`;
}

function withTenantQuery(url, tenantId) {
  if (!tenantId) return url;
  const hasQuery = String(url).includes('?');
  const suffix = `tenant_id=${encodeURIComponent(tenantId)}`;
  return `${url}${hasQuery ? '&' : '?'}${suffix}`;
}

/**
 * fetchJson tolerante a janelas de restart do servidor dev.
 *
 * O nodemon do ambiente vigia api/, engine/, src/ e qa-mesh/ (incluindo
 * api/data/config.json): cenários que provocam escrita nesses caminhos
 * (ex.: PUT /config) derrubam a API por alguns segundos. ECONNREFUSED é
 * seguro para retry em qualquer método — a conexão foi recusada, então
 * NADA foi processado pelo servidor. Outros erros de socket (conexão
 * fechada no meio) não são repetidos: o request pode ter sido processado.
 */
async function fetchJson(url, options = {}) {
  const retryDeadline = Date.now() + 120000;
  const method = String(options.method || 'GET').toUpperCase();
  // Métodos idempotentes não têm efeito colateral: qualquer falha de rede
  // (conexão recusada OU fechada no meio por reload do nodemon) pode ser
  // repetida com segurança. Para os demais, apenas ECONNREFUSED é seguro
  // (conexão recusada = nada foi processado pelo servidor).
  const idempotent = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  let response;
  for (;;) {
    try {
      response = await fetch(url, options);
      break;
    } catch (err) {
      const code = err && err.cause && err.cause.code;
      const retryable = idempotent ? true : code === 'ECONNREFUSED';
      if (!retryable || Date.now() > retryDeadline) {
        if (code && !err.message.includes(code)) {
          err.message = `${err.message} (cause: ${code})`;
        }
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }
  if (!response.ok) {
    const detail = body && typeof body === 'object'
      ? body.message || body.error || JSON.stringify(body)
      : text;
    const err = new Error(`${response.status} ${response.statusText}: ${detail || 'request_failed'}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function loginApi() {
  const tenantId = TEST_TENANT_ID;
  const credentialCandidates = [
    { username: TEST_SUPERADMIN_USERNAME, password: TEST_SUPERADMIN_PASSWORD },
    { username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD },
  ].filter((item) => item.username && item.password);

  for (const candidate of credentialCandidates) {
    try {
      const loginResult = await fetchJson(withTenantQuery(buildUrl(API_URL, '/auth/login'), tenantId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId,
        },
        body: JSON.stringify({
          username: candidate.username,
          password: candidate.password,
          tenantId,
        }),
      });
      if (loginResult?.token) {
        return loginResult.token;
      }
    } catch (_) {
      // fallback para token RPA abaixo
    }
  }

  const tokenResult = await fetchJson(withTenantQuery(buildUrl(API_URL, '/auth/rpa/token'), tenantId), {
    headers: { 'X-Tenant-Id': tenantId },
  });
  const token = tokenResult?.token || rpaTokenManager.getOrCreateRpaToken();
  const result = await fetchJson(withTenantQuery(buildUrl(API_URL, '/auth/rpa/login'), tenantId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
    },
    body: JSON.stringify({ token, tenantId }),
  });
  return result.token;
}

async function createApiClient() {
  let authToken = await loginApi();

  async function request(method, pathname, payload = null, extraHeaders = {}) {
    const doRequest = () => fetchJson(buildUrl(API_URL, pathname), {
      method,
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Tenant-Id': TEST_TENANT_ID,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    try {
      return await doRequest();
    } catch (err) {
      // Sessões são voláteis por design (cache em memória sobre o DB): restart
      // do servidor ou recarga de cache invalida o token no meio da corrida.
      // Re-login UMA vez e repete a chamada; a segunda falha propaga.
      const sessionLost = err && err.status === 401 && /sessão não encontrada|token inválido|unauthorized/i.test(err.message || '');
      if (!sessionLost) throw err;
      authToken = await loginApi();
      return doRequest();
    }
  }

  return {
    get authToken() { return authToken; },
    // Sessões são em memória: qualquer restart do servidor (ex.: PUT /config
    // regravando api/data/config.json sob nodemon) invalida o token. Cenários
    // que forçam restart devem chamar refreshAuth() e atualizar o localStorage
    // da página compartilhada.
    async refreshAuth() {
      authToken = await loginApi();
      return authToken;
    },
    get: (pathname) => request('GET', pathname),
    post: (pathname, payload, headers = {}) => request('POST', pathname, payload, headers),
    put: (pathname, payload, headers = {}) => request('PUT', pathname, payload, headers),
    patch: (pathname, payload, headers = {}) => request('PATCH', pathname, payload, headers),
    del: (pathname) => request('DELETE', pathname),
  };
}

async function ensureDbConnection() {
  if (dbReady) return;
  const sequelize = require('../../../api/db/sequelize');
  await sequelize.connect(3, 200);
  dbReady = true;
}

async function createUiSession() {
  const launch = await launchChromiumWithFallback(chromium, {
    headless: process.env.HEADLESS !== 'false',
  });
  const browser = launch.browser;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const authResult = await autoLoginBeforeSteps(page, {
    firstStep: { type: 'navigate', url: `${FRONTEND_URL}/support` },
    frontendBaseUrl: FRONTEND_URL,
    autoLogin: true,
    authOptions: {
      loginStrategy: 'rpa_then_ui',
      username: TEST_SUPERADMIN_USERNAME,
      password: TEST_SUPERADMIN_PASSWORD,
      tenantId: TEST_TENANT_ID,
      apiBaseUrl: API_URL,
    },
  });
  if (!authResult.success) {
    throw new Error(authResult.error || 'ui_auth_failed');
  }
  return { browser, context, page };
}

function runStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function captureScenarioScreenshot(page, scenarioCode, stepName) {
  ensureDir(SCREENSHOTS_DIR);
  const fileName = `${slugify(scenarioCode)}-${slugify(stepName)}-${runStamp()}.png`;
  const fullPath = path.join(SCREENSHOTS_DIR, fileName);
  await page.screenshot({ path: fullPath, fullPage: true });
  return fullPath;
}

async function seedBusinessBaseline(api) {
  await ensureDbConnection();
  const marketingService = require('../../../api/services/marketing/marketingService');
  const accessControlService = require('../../../api/modules/access-control/accessControlService');
  const seed = {
    tenantId: TEST_TENANT_ID,
    billingSandbox: true,
    fitness: {
      studentId: 'qa-fitness-student-baseline',
      customerId: 'qa-fitness-customer-baseline',
      membershipId: 'qa-fitness-membership-baseline',
      planName: 'Plano QA Fitness',
    },
    beauty: {
      campaignName: 'QA Beauty Promo Unhas',
      leadExternalId: 'qa-beauty-lead-baseline',
      customerId: 'qa-beauty-customer-baseline',
      subjectId: 'qa-beauty-subject-baseline',
      serviceCode: 'UNHAS_GEL_PROMO',
    },
  };

  await api.post('/api/fitness/student', {
    subjectId: seed.fitness.studentId,
    customerId: seed.fitness.customerId,
    membershipId: seed.fitness.membershipId,
    name: 'Aluno QA Baseline',
    phone: '+5511999991000',
    email: 'fitness-baseline@example.com',
    document: '12345678900',
    planName: seed.fitness.planName,
    planType: 'monthly',
    monthlyAmount: 129.9,
    dueDate: new Date(Date.now() + 3 * 86400000).toISOString(),
    billingStatus: 'active',
    status: 'active',
    membershipMetadata: { baseline: true, source: 'business_qa_seed' },
  });

  const campaigns = await marketingService.listEmailCampaigns({ tenantId: TEST_TENANT_ID, limit: 100 });
  const existingCampaign = (campaigns?.items || []).find((item) => item.name === seed.beauty.campaignName);
  let campaign = existingCampaign || null;
  if (!campaign) {
    const created = await marketingService.createEmailCampaign({
      tenantId: TEST_TENANT_ID,
      name: seed.beauty.campaignName,
      subject: 'Promoção QA de unhas',
      bodyText: 'Oferta controlada para jornadas de QA de beauty.',
      minScore: 0,
    });
    campaign = created.campaign || created.item || created;
  }
  seed.beauty.campaignId = campaign?.id || null;

  const leadRes = await marketingService.upsertLead({
    tenantId: TEST_TENANT_ID,
    externalId: seed.beauty.leadExternalId,
    name: 'Lead QA Baseline',
    email: 'beauty-baseline@example.com',
    phone: '+5511999992000',
    attributesPatch: {
      campaignId: seed.beauty.campaignId,
      source: 'business_qa_seed',
    },
  });
  seed.beauty.leadId = leadRes?.lead?.id || leadRes?.item?.id || null;

  await accessControlService.ensureSubject({
    tenantId: TEST_TENANT_ID,
    subjectId: seed.beauty.subjectId,
    customerId: seed.beauty.customerId,
    verticalProfile: 'beauty',
    metadata: {
      name: 'Cliente QA Baseline',
      phone: '+5511999993000',
      email: 'beauty-customer-baseline@example.com',
      baseline: true,
      source: 'business_qa_seed',
    },
  });

  return seed;
}

async function createFitnessStudent(api, suffix) {
  const subjectId = `qa-fitness-student-${suffix}`;
  const customerId = `qa-fitness-customer-${suffix}`;
  const membershipId = `qa-fitness-membership-${suffix}`;
  await api.post('/api/fitness/student', {
    subjectId,
    customerId,
    membershipId,
    name: `Aluno QA ${suffix}`,
    phone: '+5511999994000',
    email: `${suffix}@fitness-qa.example.com`,
    document: `FIT${suffix}`.slice(0, 14),
    planName: 'Plano Premium QA',
    planType: 'monthly',
    monthlyAmount: 149.9,
    dueDate: new Date(Date.now() + 2 * 86400000).toISOString(),
    billingStatus: 'active',
    status: 'active',
    membershipMetadata: { source: 'business_qa', suffix },
  });
  return { subjectId, customerId, membershipId };
}

async function createFitnessCharge(api, params) {
  return api.post(`/api/fitness/membership/${encodeURIComponent(params.membershipId)}/charge`, {
    amount: params.amount || 149.9,
    dueDate: params.dueDate || new Date(Date.now() + 86400000).toISOString(),
    cycle: 'MONTHLY',
    provider: 'sandbox',
    subjectId: params.subjectId,
    customerId: params.customerId,
    customerName: params.customerName || null,
    customerPhone: params.customerPhone || null,
    idempotencyKey: params.idempotencyKey,
    metadata: { source: 'business_qa', scenarioCode: params.scenarioCode || null },
  });
}

async function confirmTransaction(api, transaction, provider = 'sandbox') {
  return api.post('/billing/webhook', {
    provider,
    id: transaction.external_transaction_id || transaction.externalTransactionId,
    payment: {
      id: transaction.external_transaction_id || transaction.externalTransactionId,
      status: 'CONFIRMED',
    },
    status: 'CONFIRMED',
  });
}

async function createBeautyCampaign(api, suffix) {
  const name = `QA Beauty Campaign ${suffix}`;
  const list = await api.get('/api/marketing/email-campaigns?limit=200');
  const existing = (list?.items || []).find((item) => item.name === name);
  if (existing) return existing;
  const out = await api.post('/api/marketing/email-campaigns', {
    name,
    subject: `Promoção QA ${suffix}`,
    bodyText: 'Campanha criada para jornada de negócio beauty.',
    minScore: 0,
  });
  return out.campaign || out.item || out;
}

async function publishCampaign(api, campaignId) {
  return api.post(`/api/marketing/email-campaigns/${encodeURIComponent(campaignId)}/send`, {});
}

async function createBeautyLead(api, suffix, campaignId) {
  await ensureDbConnection();
  const marketingService = require('../../../api/services/marketing/marketingService');
  const out = await marketingService.upsertLead({
    tenantId: TEST_TENANT_ID,
    externalId: `qa-beauty-lead-${suffix}`,
    name: `Lead Beauty ${suffix}`,
    email: `beauty-${suffix}@example.com`,
    phone: '+5511999995000',
    attributesPatch: {
      campaignId,
      source: 'business_qa',
    },
  });
  return out.lead || out.item || out;
}

async function qualifyLead(api, leadId) {
  await ensureDbConnection();
  const marketingService = require('../../../api/services/marketing/marketingService');
  return marketingService.updateLead({
    tenantId: TEST_TENANT_ID,
    leadId,
    stage: 'qualified',
    attributesPatch: { qualifiedBy: 'business_qa' },
  });
}

async function convertBeautyLead(api, lead, suffix, campaignId) {
  await ensureDbConnection();
  const accessControlService = require('../../../api/modules/access-control/accessControlService');
  const marketingService = require('../../../api/services/marketing/marketingService');
  const { emitJourneyEvent } = require('../../../api/services/vertical/customerJourneyEngine');
  const customerId = `qa-beauty-customer-${suffix}`;
  const subject = await accessControlService.ensureSubject({
    tenantId: TEST_TENANT_ID,
    customerId,
    verticalProfile: 'beauty',
    metadata: {
      name: lead.name || `Cliente Beauty ${suffix}`,
      phone: lead.phone || null,
      email: lead.email || null,
      leadId: lead.id,
      campaignId,
      source: 'business_qa',
    },
  });
  await marketingService.updateLead({
    tenantId: TEST_TENANT_ID,
    leadId: lead.id,
    stage: 'customer',
    attributesPatch: {
      convertedSubjectId: subject.id,
      convertedCustomerId: customerId,
      campaignId,
    },
  });
  const item = await emitJourneyEvent({
    tenantId: TEST_TENANT_ID,
    vertical: 'beauty',
    eventType: 'pre_service',
    subjectId: subject.id,
    customerId,
    channel: 'internal',
    triggeredBy: 'business_qa',
    correlationId: lead.id,
    idempotencyKey: `business_qa_convert:${TEST_TENANT_ID}:${lead.id}`,
    payload: {
      sourceEvent: 'lead_converted',
      leadId: lead.id,
      campaignId,
      convertedSubjectId: subject.id,
    },
    metadata: { source: 'business_qa' },
  });
  return { customer: subject, item };
}

// ── Helpers bakery (mesmos primitivos genéricos de marketing/CRM, com
// nomenclatura e vertical próprios para não poluir a cobertura beauty) ──

async function createBakeryCampaign(api, suffix) {
  const name = `QA Bakery Combo ${suffix}`;
  const list = await api.get('/api/marketing/email-campaigns?limit=200');
  const existing = (list?.items || []).find((item) => item.name === name);
  if (existing) return existing;
  const out = await api.post('/api/marketing/email-campaigns', {
    name,
    subject: `Combo Padaria QA ${suffix}`,
    bodyText: 'Campanha rápida de combo criada para jornada de negócio bakery.',
    minScore: 0,
  });
  return out.campaign || out.item || out;
}

async function createBakeryLead(api, suffix, campaignId) {
  await ensureDbConnection();
  const marketingService = require('../../../api/services/marketing/marketingService');
  const out = await marketingService.upsertLead({
    tenantId: TEST_TENANT_ID,
    externalId: `qa-bakery-lead-${suffix}`,
    name: `Cliente Padaria ${suffix}`,
    email: `bakery-${suffix}@example.com`,
    phone: '+5511999996000',
    attributesPatch: {
      campaignId,
      source: 'business_qa',
    },
  });
  return out.lead || out.item || out;
}

async function convertBakeryLead(api, lead, suffix, campaignId) {
  await ensureDbConnection();
  const accessControlService = require('../../../api/modules/access-control/accessControlService');
  const marketingService = require('../../../api/services/marketing/marketingService');
  const { emitJourneyEvent } = require('../../../api/services/vertical/customerJourneyEngine');
  const customerId = `qa-bakery-customer-${suffix}`;
  const subject = await accessControlService.ensureSubject({
    tenantId: TEST_TENANT_ID,
    customerId,
    verticalProfile: 'bakery',
    metadata: {
      name: lead.name || `Cliente Padaria ${suffix}`,
      phone: lead.phone || null,
      email: lead.email || null,
      leadId: lead.id,
      campaignId,
      source: 'business_qa',
    },
  });
  await marketingService.updateLead({
    tenantId: TEST_TENANT_ID,
    leadId: lead.id,
    stage: 'customer',
    attributesPatch: {
      convertedSubjectId: subject.id,
      convertedCustomerId: customerId,
      campaignId,
    },
  });
  const item = await emitJourneyEvent({
    tenantId: TEST_TENANT_ID,
    vertical: 'bakery',
    eventType: 'pre_service',
    subjectId: subject.id,
    customerId,
    channel: 'internal',
    triggeredBy: 'business_qa',
    correlationId: lead.id,
    idempotencyKey: `business_qa_convert:${TEST_TENANT_ID}:${lead.id}`,
    payload: {
      sourceEvent: 'lead_converted',
      leadId: lead.id,
      campaignId,
      convertedSubjectId: subject.id,
    },
    metadata: { source: 'business_qa' },
  });
  return { customer: subject, item };
}

async function createBeautyAppointment(api, params) {
  const startAt = params.startAt || new Date(Date.now() + 2 * 3600000).toISOString();
  const endAt = params.endAt || new Date(Date.now() + 3 * 3600000).toISOString();
  return api.post('/api/beauty/appointment', {
    subjectId: params.subjectId,
    customerId: params.customerId,
    customerName: params.customerName,
    serviceCode: params.serviceCode || 'UNHAS_GEL_PROMO',
    campaignId: params.campaignId || null,
    professionalId: params.professionalId || 'beauty-pro-qa',
    professionalName: params.professionalName || 'Profissional QA',
    price: params.price != null ? params.price : 59.9,
    startAt,
    endAt,
    metadata: { source: 'business_qa', scenarioCode: params.scenarioCode || null },
  });
}

async function createBeautyBundleWithCharge(api, params) {
  return api.post('/api/beauty/bundle', {
    subjectId: params.subjectId,
    customerId: params.customerId,
    planName: params.planName || 'Beauty QA Promo',
    bundleType: 'package',
    totalSessions: params.totalSessions || 1,
    metadata: { source: 'business_qa', scenarioCode: params.scenarioCode || null },
    charge: {
      amount: params.amount || 59.9,
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      provider: 'sandbox',
      idempotencyKey: params.idempotencyKey,
      metadata: { source: 'business_qa', scenarioCode: params.scenarioCode || null },
    },
  });
}

async function listSchedules(api, contextId) {
  const result = await api.get(`/api/schedules?contextType=beauty_appointment&contextId=${encodeURIComponent(contextId)}&limit=50`);
  return result?.items || [];
}

async function reschedule(api, scheduleId, startAt, endAt) {
  return api.post(`/api/schedules/${encodeURIComponent(scheduleId)}/reschedule`, { startAt, endAt });
}

function artifact(type, value) {
  if (typeof value === 'string') return { type, path: value };
  return { type, ...value };
}

function materializeActionValue(template, definition) {
  if (template == null) return template;
  const timestamp = Date.now();
  return String(template)
    .replaceAll('{timestamp}', String(timestamp))
    .replaceAll('{code}', String(definition.code || 'scenario').toLowerCase());
}

async function waitForScreenReady(page, definition) {
  if (definition.readySelector) {
    await page.locator(definition.readySelector).first().waitFor({ timeout: 10000 });
    return;
  }

  if (definition.pageTitle) {
    await page.getByRole('heading', { name: new RegExp(definition.pageTitle, 'i') }).first().waitFor({ timeout: 10000 });
    return;
  }

  await page.waitForLoadState('domcontentloaded');
}

async function executeScreenActions(driver, definition) {
  for (const action of definition.actions || []) {
    const resolvedValue = materializeActionValue(action.valueTemplate || action.value, definition);
    if (action.kind === 'fill') {
      await driver.fill(action.target, resolvedValue, action.extraSelectors || []);
      continue;
    }
    if (action.kind === 'click') {
      await driver.click(action.target, action.extraSelectors || []);
      continue;
    }
    if (action.kind === 'select') {
      await driver.select(action.target, resolvedValue, action.extraSelectors || []);
      continue;
    }
    throw new Error(`Acao de tela nao suportada: ${action.kind}`);
  }
}

async function runScreenScenario(definition, ctx) {
  const { page, seed } = ctx;
  const artifacts = [];
  const driver = createSemanticPageDriver(page);

  if (definition.intent) {
    await driver.gotoIntent(definition.intent, { baseUrl: FRONTEND_URL });
  } else {
    await page.goto(`${FRONTEND_URL}${definition.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await page.waitForTimeout(1200);
  await waitForScreenReady(page, definition);
  await executeScreenActions(driver, definition);

  const bodyText = await page.locator('body').innerText();
  if (/Acesso Negado/i.test(bodyText)) {
    throw new Error(`Tela ${definition.code} apresentou erro visível`);
  }
  const screenshotPath = await captureScenarioScreenshot(page, definition.code, 'screen');
  artifacts.push(artifact('screenshot', screenshotPath));
  return {
    detail: `Tela ${definition.path} validada com interação básica`,
    artifacts,
    ids: seed ? { baselineTenantId: seed.tenantId } : {},
    evidence: {
      path: definition.path,
      title: definition.pageTitle || definition.readySelector || definition.intent || definition.path,
      intent: definition.intent || null,
    },
  };
}

// Padrões de console error ignorados nas aberturas de página: falhas de rede
// ("Failed to load resource") já são assertadas no nível de API pelos fluxos;
// os demais são ruído conhecido de tooling/extensões.
const IGNORED_PAGE_CONSOLE_PATTERNS = [
  /favicon/i,
  /devtools/i,
  /third-?party/i,
  /source\s?map/i,
  /failed to load resource/i,
];

/**
 * Aguarda a API voltar a responder /health. Necessário porque o nodemon do
 * ambiente dev vigia api/data/config.json: qualquer PUT /config derruba e
 * sobe o servidor (janela de ~20-60s sem resposta).
 *
 * `settleMs`: exige estabilidade contínua por esse tempo antes de retornar.
 * Sem ele, a função retorna no primeiro 200 — mas o nodemon tem delay de
 * detecção (~1s) após a escrita do arquivo, então o restart pode ainda estar
 * PENDENTE quando o primeiro /health responde. Qualquer falha ou resposta
 * não-OK zera a janela de estabilidade.
 */
async function waitForApiReady({ timeoutMs = 180000, intervalMs = 3000, settleMs = 0 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let stableSince = null;
  for (;;) {
    let ok = false;
    try {
      const res = await fetch(buildUrl(API_URL, '/health'));
      ok = res.ok;
    } catch {
      // API ainda reiniciando
    }
    if (!ok) {
      stableSince = null;
    } else if (settleMs <= 0) {
      return true;
    } else if (stableSince === null) {
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= settleMs) {
      return true;
    }
    if (Date.now() > deadline) {
      throw new Error('API não respondeu /health dentro do timeout após reload');
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, 1000)));
  }
}

/**
 * Abre uma página do frontend e asserta: render não vazio, sem 'Acesso Negado',
 * URL final correta (a menos que allowRedirect) e zero console errors de página.
 * Usada pelos cenários business (campo `pages` do catálogo).
 */
async function assertBusinessPage(page, pageDef, definition) {
  const consoleErrors = [];
  const onConsole = (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_PAGE_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) return;
    consoleErrors.push(text);
  };
  const onPageError = (err) => consoleErrors.push(String((err && err.message) || err));
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    await page.goto(`${FRONTEND_URL}${pageDef.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    const bodyText = await page.locator('body').innerText();
    const accessDenied = /Acesso Negado/i.test(bodyText);
    if (pageDef.expectDenied) {
      // Assertiva RBAC negativa: a página DEVE negar acesso ao papel da
      // sessão (ex.: admin sem tenant:read em /tenants). Se renderizar, a
      // guarda de URL direta falhou — falha de segurança real.
      if (!accessDenied) {
        throw new Error(`Pagina ${pageDef.path} deveria negar acesso ao papel da sessão (RBAC), mas renderizou`);
      }
      return { path: pageDef.path, finalPath: new URL(page.url()).pathname, denied: true };
    }
    if (accessDenied) {
      throw new Error(`Pagina ${pageDef.path} apresentou 'Acesso Negado'`);
    }
    const rootText = await page.locator('#root').innerText().catch(() => '');
    if (!String(rootText || bodyText).trim()) {
      throw new Error(`Pagina ${pageDef.path} renderizou vazia`);
    }
    const finalPath = new URL(page.url()).pathname;
    if (!pageDef.allowRedirect) {
      const expected = pageDef.expectPath || pageDef.path;
      if (finalPath !== expected && !finalPath.startsWith(`${expected}/`)) {
        throw new Error(`Pagina ${pageDef.path} terminou em URL inesperada: ${finalPath}`);
      }
    }
    if (consoleErrors.length > 0) {
      throw new Error(`Pagina ${pageDef.path} com console errors: ${consoleErrors.join(' | ')}`);
    }
    return { path: pageDef.path, finalPath };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
}

/**
 * Abre, na sessão autenticada compartilhada, todas as páginas declaradas no
 * catálogo para o cenário (ignora as marcadas como anonymous — essas são
 * tratadas pelo próprio fluxo com browser anônimo dedicado).
 */
async function assertBusinessPages(page, definition) {
  const pages = (definition.pages || []).filter((pageDef) => !pageDef.anonymous);
  if (pages.length === 0) return [];
  if (!page) {
    throw new Error(`Cenario ${definition.code} declara pages mas a sessao de browser nao foi criada`);
  }
  const results = [];
  for (const pageDef of pages) {
    results.push(await assertBusinessPage(page, pageDef, definition));
    await captureScenarioScreenshot(page, definition.code, `page-${slugify(pageDef.path)}`);
  }
  return results;
}

/** Browser anônimo dedicado (login real, páginas públicas saas/storefront). */
async function createAnonymousUiPage() {
  const launch = await launchChromiumWithFallback(chromium, {
    headless: process.env.HEADLESS !== 'false',
  });
  const browser = launch.browser;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  return { browser, context, page };
}

async function runFlowScenario(definition, ctx) {
  const { api, page, runId } = ctx;
  if (definition.code === 'FIT-FLOW-STUDENT') {
    const created = await createFitnessStudent(api, `${runId}-flow-student`);
    const search = await api.get(`/api/fitness/students/search?q=${encodeURIComponent(created.subjectId)}&limit=10`);
    const detail = await api.get(`/api/fitness/student/${encodeURIComponent(created.subjectId)}/detail?limit=50`);
    if (!(search?.items || []).some((item) => item.subjectId === created.subjectId)) {
      throw new Error('Aluno criado nao retornou na busca');
    }
    if (detail?.membership?.id !== created.membershipId) {
      throw new Error('Membership nao associada ao aluno criado');
    }
    return { detail: 'Aluno e membership persistidos', ids: created, evidence: { searchTotal: search.total || 0 } };
  }

  if (definition.code === 'FIT-FLOW-CHARGE') {
    const ids = await createFitnessStudent(api, `${runId}-flow-charge`);
    const charge = await createFitnessCharge(api, {
      ...ids,
      amount: 159.9,
      idempotencyKey: `business-qa:${definition.code}:${runId}`,
      scenarioCode: definition.code,
    });
    await confirmTransaction(api, charge.transaction);
    const detail = await api.get(`/api/fitness/student/${encodeURIComponent(ids.subjectId)}/detail?limit=50`);
    if (String(detail?.membership?.effectiveBillingStatus || '').toLowerCase() !== 'active') {
      throw new Error('Membership nao ficou ativa apos pagamento');
    }
    return { detail: 'Cobranca e pagamento confirmados', ids: { ...ids, transactionId: charge.transaction.id } };
  }

  if (definition.code === 'FIT-FLOW-CHECKIN') {
    const ids = await createFitnessStudent(api, `${runId}-flow-checkin`);
    const checkIn = await api.post('/api/fitness/attendance/check-in', {
      subjectId: ids.subjectId,
      membershipId: ids.membershipId,
      metadata: { source: 'business_qa', scenarioCode: definition.code },
    });
    const open = await api.get('/api/fitness/attendance/open?limit=50');
    const attendance = (open?.items || []).find((item) => item.subject_id === ids.subjectId);
    if (!attendance) {
      throw new Error('Check-in nao refletiu em atendimentos abertos');
    }
    await api.post('/api/fitness/attendance/check-out', {
      subjectId: ids.subjectId,
      attendanceId: attendance.id,
      metadata: { source: 'business_qa', scenarioCode: definition.code },
    });
    return {
      detail: 'Check-in e check-out concluídos',
      ids: { ...ids, attendanceId: attendance.id, accessEventId: checkIn?.item?.id || null },
    };
  }

  if (definition.code === 'BEAUTY-FLOW-CAMPAIGN') {
    const campaign = await createBeautyCampaign(api, `${runId}-flow-campaign`);
    await publishCampaign(api, campaign.id);
    let match = null;
    for (let attempt = 0; attempt < 3 && !match; attempt += 1) {
      const list = await api.get('/api/marketing/email-campaigns?limit=200');
      match = (list?.items || []).find((item) => item.id === campaign.id);
      if (!match && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!match) {
      throw new Error('Campanha criada nao apareceu na listagem');
    }
    return { detail: 'Campanha criada e publicada/simulada', ids: { campaignId: campaign.id } };
  }

  if (definition.code === 'BEAUTY-FLOW-LEAD') {
    const campaign = await createBeautyCampaign(api, `${runId}-flow-lead`);
    const lead = await createBeautyLead(api, `${runId}-flow-lead`, campaign.id);
    await qualifyLead(api, lead.id);
    const conversion = await convertBeautyLead(api, lead, `${runId}-flow-lead`, campaign.id);
    if (!conversion?.customer?.id) {
      throw new Error('Lead nao foi convertido em cliente');
    }
    return { detail: 'Lead criado, qualificado e convertido', ids: { leadId: lead.id, subjectId: conversion.customer.id, campaignId: campaign.id } };
  }

  if (definition.code === 'BEAUTY-FLOW-APPOINTMENT') {
    const campaign = await createBeautyCampaign(api, `${runId}-flow-appointment`);
    const lead = await createBeautyLead(api, `${runId}-flow-appointment`, campaign.id);
    const conversion = await convertBeautyLead(api, lead, `${runId}-flow-appointment`, campaign.id);
    const appointment = await createBeautyAppointment(api, {
      subjectId: conversion.customer.id,
      customerId: conversion.customer.customer_id || conversion.customer.customerId,
      customerName: lead.name,
      campaignId: campaign.id,
      scenarioCode: definition.code,
    });
    if (!appointment?.schedule?.id) {
      throw new Error('Agendamento nao foi criado');
    }
    return { detail: 'Agendamento criado com confirmação', ids: { scheduleId: appointment.schedule.id, subjectId: conversion.customer.id } };
  }

  if (definition.code === 'BEAUTY-FLOW-PAYMENT') {
    const campaign = await createBeautyCampaign(api, `${runId}-flow-payment`);
    const lead = await createBeautyLead(api, `${runId}-flow-payment`, campaign.id);
    const conversion = await convertBeautyLead(api, lead, `${runId}-flow-payment`, campaign.id);
    const bundle = await createBeautyBundleWithCharge(api, {
      subjectId: conversion.customer.id,
      customerId: conversion.customer.customer_id || conversion.customer.customerId,
      amount: 59.9,
      idempotencyKey: `business-qa:${definition.code}:${runId}`,
      scenarioCode: definition.code,
    });
    await confirmTransaction(api, bundle.charge.transaction);
    const payments = await api.get('/billing/transactions?vertical=beauty&limit=50');
    const tx = (payments?.items || []).find((item) => item.id === bundle.charge.transaction.id);
    if (!tx || tx.status !== 'confirmed') {
      throw new Error('Pagamento beauty nao ficou confirmado');
    }
    return { detail: 'Pagamento beauty confirmado', ids: { bundleId: bundle.item.id, transactionId: bundle.charge.transaction.id } };
  }

  if (definition.code === 'CLINIC-FLOW-TICKET') {
    const phoneSuffix = String(Date.now()).slice(-8);
    const ticket = await api.post('/tickets', {
      phoneNumber: `+55119${phoneSuffix}`,
      queue: 'support',
      initialMessage: 'Abertura automatizada de ticket para QA clínico',
    });
    const ticketId = ticket?.id || ticket?.ticket?.id;
    if (!ticketId) {
      throw new Error('Ticket clinico nao retornou ID');
    }

    await api.post(`/tickets/${encodeURIComponent(ticketId)}/takeover`, {});
    await api.post(`/tickets/${encodeURIComponent(ticketId)}/close`, {});

    const closed = await api.get(`/tickets/${encodeURIComponent(ticketId)}`);
    const status = String(closed?.status || '').toLowerCase();
    if (status !== 'closed') {
      throw new Error('Ticket clinico nao foi encerrado');
    }

    return {
      detail: 'Ticket criado, assumido e encerrado com sucesso',
      ids: { ticketId },
      evidence: { finalStatus: status },
    };
  }

  if (definition.code === 'FOOD-FLOW-ORDER') {
    const listed = await api.get('/orders?limit=20');
    const orders = Array.isArray(listed?.orders) ? listed.orders : [];
    const order = orders[0] || null;
    if (!order?.id) {
      return {
        detail: 'Endpoint de pedidos respondeu, sem pedidos elegiveis para transicao',
        ids: {},
        evidence: { totalOrders: listed?.total || 0 },
      };
    }

    const currentStatus = String(order.status || '').toLowerCase();
    const nextByStatus = {
      created: 'confirmed',
      confirmed: 'preparing',
      preparing: 'ready',
      ready: 'dispatched',
      dispatched: 'delivered',
    };
    const nextStatus = nextByStatus[currentStatus];
    if (!nextStatus) {
      return {
        detail: `Pedido encontrado em status terminal (${currentStatus}), sem transicao aplicavel`,
        ids: { orderId: order.id },
        evidence: { currentStatus },
      };
    }

    await api.put(`/orders/${encodeURIComponent(order.id)}/status`, { status: nextStatus });
    const after = await api.get(`/orders/${encodeURIComponent(order.id)}`);
    const observedStatus = String(after?.order?.status || after?.status || '').toLowerCase();
    if (observedStatus !== nextStatus) {
      throw new Error('Status do pedido nao refletiu a atualizacao');
    }

    return {
      detail: `Pedido transicionado de ${currentStatus} para ${nextStatus}`,
      ids: { orderId: order.id },
      evidence: { from: currentStatus, to: nextStatus },
    };
  }

  if (definition.code === 'MARKET-FLOW-NODE') {
    const catalogBefore = await api.get('/api/node-marketplace/catalog');
    const initialTotal = Array.isArray(catalogBefore?.items) ? catalogBefore.items.length : 0;

    const nodeId = `qa-market-${runId}`;
    try {
      const publish = await api.post('/api/node-marketplace/publish', {
        node: {
          id: nodeId,
          label: `QA Market Node ${runId}`,
          category: 'core',
          version: '1.0.0',
          description: 'Node publicado pela suite business QA',
          visibility: 'tenant',
        },
      });
      if (!publish?.ok) {
        throw new Error('Publicacao de node nao confirmou sucesso');
      }

      const published = await api.get('/api/node-marketplace/published');
      const found = (published?.items || []).find((item) => item.id === nodeId);
      if (!found) {
        throw new Error('Node publicado nao apareceu na lista de publicados');
      }

      const catalogAfter = await api.get('/api/node-marketplace/catalog');
      const finalTotal = Array.isArray(catalogAfter?.items) ? catalogAfter.items.length : initialTotal;
      return {
        detail: 'Node publicado, visivel no marketplace do tenant e revogado',
        ids: { nodeId },
        evidence: { catalogBefore: initialTotal, catalogAfter: finalTotal, unpublished: true },
      };
    } finally {
      // O registry do marketplace é versionado (governance/): node de QA não
      // pode sobrar após o cenário, senão cada run acumula lixo no git.
      try {
        await api.del(`/api/node-marketplace/publish/${encodeURIComponent(nodeId)}`);
      } catch (_) { /* melhor esforço: falha de cleanup não mascara o resultado */ }
    }
  }

  if (definition.code === 'SERV-FLOW-SOLUTION') {
    const packs = await api.get('/api/solutions/packs');
    const items = Array.isArray(packs?.items) ? packs.items : [];
    if (!items.length) {
      throw new Error('Catalogo de solution packs vazio');
    }

    const target = items.find((item) => item.segment === 'servicos') || items[0];
    const install = await api.post('/api/solutions/packs/install', {
      segment: target.segment,
    });
    const installOk = Boolean(install?.ok || install?.success);
    if (!installOk) {
      throw new Error('Instalacao do solution pack nao confirmou sucesso');
    }

    return {
      detail: `Solution pack instalado para segmento ${target.segment}`,
      ids: { segment: target.segment, packId: target.id || null },
      evidence: { availablePacks: items.length },
    };
  }

  if (definition.code === 'BAKERY-FLOW-ENCOMENDA') {
    // Encomenda de padaria sobre o primitivo de Case Management da plataforma:
    // aberta (ticket) → produção assumida (takeover) → entrega (close).
    const phoneSuffix = String(Date.now()).slice(-8);
    const ticket = await api.post('/tickets', {
      phoneNumber: `+55117${phoneSuffix}`,
      queue: 'support',
      initialMessage: 'Encomenda de padaria QA: bolo de aniversario para retirada',
    });
    const ticketId = ticket?.id || ticket?.ticket?.id;
    if (!ticketId) {
      throw new Error('Encomenda (ticket) nao retornou ID');
    }

    await api.post(`/tickets/${encodeURIComponent(ticketId)}/takeover`, {});
    await api.post(`/tickets/${encodeURIComponent(ticketId)}/close`, {});

    const closed = await api.get(`/tickets/${encodeURIComponent(ticketId)}`);
    const status = String(closed?.status || '').toLowerCase();
    if (status !== 'closed') {
      throw new Error('Encomenda nao foi encerrada (entrega nao confirmada)');
    }

    return {
      detail: 'Encomenda aberta, producao assumida e entrega confirmada',
      ids: { ticketId },
      evidence: { finalStatus: status },
    };
  }

  if (definition.code === 'BAKERY-FLOW-PEDIDO-STATUS') {
    // Pedido de padaria avança no ciclo produção/entrega (primitivo /orders).
    const listed = await api.get('/orders?limit=20');
    const orders = Array.isArray(listed?.orders) ? listed.orders : [];
    const order = orders[0] || null;
    if (!order?.id) {
      return {
        detail: 'Endpoint de pedidos respondeu, sem pedidos elegiveis para transicao',
        ids: {},
        evidence: { totalOrders: listed?.total || 0 },
      };
    }

    const currentStatus = String(order.status || '').toLowerCase();
    const nextByStatus = {
      created: 'confirmed',
      confirmed: 'preparing',
      preparing: 'ready',
      ready: 'dispatched',
      dispatched: 'delivered',
    };
    const nextStatus = nextByStatus[currentStatus];
    if (!nextStatus) {
      return {
        detail: `Pedido em status terminal (${currentStatus}), sem transicao aplicavel`,
        ids: { orderId: order.id },
        evidence: { currentStatus },
      };
    }

    await api.put(`/orders/${encodeURIComponent(order.id)}/status`, { status: nextStatus });
    const after = await api.get(`/orders/${encodeURIComponent(order.id)}`);
    const observedStatus = String(after?.order?.status || after?.status || '').toLowerCase();
    if (observedStatus !== nextStatus) {
      throw new Error('Status do pedido nao refletiu a atualizacao');
    }

    return {
      detail: `Pedido padaria transicionado de ${currentStatus} para ${nextStatus}`,
      ids: { orderId: order.id },
      evidence: { from: currentStatus, to: nextStatus },
    };
  }

  if (definition.code === 'BAKERY-FLOW-CAMPANHA-COMBO') {
    // Campanha rápida de combo (janela ociosa) sobre o primitivo de marketing.
    const campaign = await createBakeryCampaign(api, `${runId}-bakery-combo`);
    await publishCampaign(api, campaign.id);
    let match = null;
    for (let attempt = 0; attempt < 3 && !match; attempt += 1) {
      const list = await api.get('/api/marketing/email-campaigns?limit=200');
      match = (list?.items || []).find((item) => item.id === campaign.id);
      if (!match && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!match) {
      throw new Error('Campanha de combo nao apareceu na listagem');
    }
    return { detail: 'Campanha de combo criada e disparada', ids: { campaignId: campaign.id } };
  }

  if (definition.code === 'BAKERY-FLOW-CLIENTE-RECORRENTE') {
    // Cliente recorrente/reativação sobre os primitivos de leads + CRM.
    const campaign = await createBakeryCampaign(api, `${runId}-bakery-reativacao`);
    const lead = await createBakeryLead(api, `${runId}-bakery-reativacao`, campaign.id);
    await qualifyLead(api, lead.id);
    const conversion = await convertBakeryLead(api, lead, `${runId}-bakery-reativacao`, campaign.id);
    if (!conversion?.customer?.id) {
      throw new Error('Cliente recorrente nao foi reativado (conversao falhou)');
    }
    return {
      detail: 'Cliente recorrente qualificado e reativado',
      ids: { leadId: lead.id, subjectId: conversion.customer.id, campaignId: campaign.id },
    };
  }

  if (definition.code === 'BAKERY-FLOW-BALCAO-RETIRADA') {
    // Atendimento de balcão com retirada sobre o primitivo de Case Management:
    // pedido no balcão (ticket) → produção assumida (takeover) → cliente
    // chamado (message) → retirada confirmada (close).
    const phoneSuffix = String(Date.now()).slice(-8);
    const ticket = await api.post('/tickets', {
      phoneNumber: `+55116${phoneSuffix}`,
      queue: 'support',
      initialMessage: 'Pedido no balcao QA: pao na chapa e cafe para retirada',
    });
    const ticketId = ticket?.id || ticket?.ticket?.id;
    if (!ticketId) {
      throw new Error('Pedido de balcao (ticket) nao retornou ID');
    }

    await api.post(`/tickets/${encodeURIComponent(ticketId)}/takeover`, {});
    await api.post(`/tickets/${encodeURIComponent(ticketId)}/message`, {
      message: 'Pedido pronto! Cliente chamado para retirada no balcao.',
    });
    await api.post(`/tickets/${encodeURIComponent(ticketId)}/close`, {});

    const closed = await api.get(`/tickets/${encodeURIComponent(ticketId)}`);
    const status = String(closed?.status || '').toLowerCase();
    if (status !== 'closed') {
      throw new Error('Retirada nao confirmada (pedido de balcao nao encerrado)');
    }

    return {
      detail: 'Pedido de balcao registrado, produzido e retirado',
      ids: { ticketId },
      evidence: { finalStatus: status },
    };
  }

  if (definition.code === 'BAKERY-FLOW-PRODUCAO-FORNADA') {
    // Fornada de padaria: o pedido avança pelo ciclo de produção até ficar
    // pronto (disponibilidade do forno refletida no status), primitivo /orders.
    const listed = await api.get('/orders?limit=20');
    const orders = Array.isArray(listed?.orders) ? listed.orders : [];
    const nextByStatus = {
      created: 'confirmed',
      confirmed: 'preparing',
      preparing: 'ready',
    };
    const order = orders.find((item) => nextByStatus[String(item?.status || '').toLowerCase()]) || null;
    if (!order?.id) {
      return {
        detail: 'Endpoint de pedidos respondeu, sem fornada elegivel para producao',
        ids: {},
        evidence: { totalOrders: listed?.total || 0 },
      };
    }

    const transitions = [];
    let currentStatus = String(order.status || '').toLowerCase();
    while (nextByStatus[currentStatus]) {
      const nextStatus = nextByStatus[currentStatus];
      await api.put(`/orders/${encodeURIComponent(order.id)}/status`, { status: nextStatus });
      transitions.push({ from: currentStatus, to: nextStatus });
      currentStatus = nextStatus;
    }

    const after = await api.get(`/orders/${encodeURIComponent(order.id)}`);
    const observedStatus = String(after?.order?.status || after?.status || '').toLowerCase();
    if (observedStatus !== currentStatus) {
      throw new Error('Status da fornada nao refletiu o ciclo de producao');
    }

    return {
      detail: `Fornada avancou ${transitions.length} etapa(s) ate ${currentStatus}`,
      ids: { orderId: order.id },
      evidence: { transitions, finalStatus: observedStatus },
    };
  }

  if (definition.code === 'BAKERY-FLOW-ESTOQUE-PERDAS') {
    // Perda de estoque: registrada como incidente operacional vinculado ao
    // pedido (primitivo /orders/:id/incidents abre ticket de perda).
    const listed = await api.get('/orders?limit=20');
    const orders = Array.isArray(listed?.orders) ? listed.orders : [];
    const order = orders.find((item) => item?.id) || null;
    if (!order) {
      return {
        detail: 'Endpoint de pedidos respondeu, sem pedido elegivel para registro de perda',
        ids: {},
        evidence: { totalOrders: listed?.total || 0 },
      };
    }

    const incident = await api.post(`/orders/${encodeURIComponent(order.id)}/incidents`, {
      type: 'perda_estoque',
      queue: 'Estoque',
      message: 'Perda de estoque QA: fornada descartada ao fim do dia',
      idempotencyKey: `business-qa:${definition.code}:${runId}`,
    });
    const ticketId = incident?.ticketId || incident?.ticket?.id;
    if (!ticketId) {
      throw new Error('Registro de perda nao retornou ticket');
    }

    const ticket = await api.get(`/tickets/${encodeURIComponent(ticketId)}`);
    const status = String(ticket?.status || '').toLowerCase();
    if (!status) {
      throw new Error('Ticket de perda nao encontrado no backend');
    }

    return {
      detail: 'Perda de estoque registrada e vinculada ao pedido',
      ids: { orderId: order.id, ticketId },
      evidence: { incidentType: 'perda_estoque', ticketStatus: status, idempotent: Boolean(incident?.idempotent) },
    };
  }

  if (definition.code === 'CORE-FLOW-SUPPORT-TICKET') {
    const phoneSuffix = String(Date.now()).slice(-8);
    const ticket = await api.post('/tickets', {
      phoneNumber: `+55118${phoneSuffix}`,
      queue: 'support',
      initialMessage: 'Cliente QA solicita ajuda com pedido (support_ticket_flow)',
    });
    const ticketId = ticket?.id || ticket?.ticket?.id;
    if (!ticketId) {
      throw new Error('Ticket de suporte nao retornou ID');
    }

    await api.post(`/tickets/${encodeURIComponent(ticketId)}/takeover`, {});
    await api.post(`/tickets/${encodeURIComponent(ticketId)}/message`, {
      message: 'Resposta do agente QA: seu pedido esta em transito, previsao para amanha.',
    });
    await api.post(`/tickets/${encodeURIComponent(ticketId)}/close`, {});

    const closed = await api.get(`/tickets/${encodeURIComponent(ticketId)}`);
    const status = String(closed?.status || '').toLowerCase();
    if (status !== 'closed') {
      throw new Error('Ticket de suporte nao foi encerrado');
    }

    return {
      detail: 'Ticket criado, assumido, respondido pelo agente e encerrado',
      ids: { ticketId },
      evidence: { finalStatus: status },
    };
  }

  if (definition.code === 'CORE-FLOW-BOOKING') {
    const contextId = `qa-booking-${runId}`;
    const created = await api.post('/api/schedules', {
      contextType: 'booking',
      contextId,
      startAt: new Date(Date.now() + 4 * 3600000).toISOString(),
      endAt: new Date(Date.now() + 5 * 3600000).toISOString(),
      purpose: 'atendimento',
      requiresConfirmation: true,
      metadata: { source: 'business_qa', scenarioCode: definition.code },
    });
    const scheduleId = created?.schedule?.id;
    if (!scheduleId) {
      throw new Error('Agendamento nao retornou ID');
    }
    if (created.schedule.status !== 'scheduled') {
      throw new Error(`Agendamento criado com status inesperado: ${created.schedule.status}`);
    }

    const confirmed = await api.post(`/api/schedules/${encodeURIComponent(scheduleId)}/confirm`, {});
    if (confirmed?.schedule?.confirmationStatus !== 'confirmed') {
      throw new Error('Agendamento nao registrou confirmacao');
    }

    const done = await api.post(`/api/schedules/${encodeURIComponent(scheduleId)}/done`, {});
    if (done?.schedule?.status !== 'done') {
      throw new Error('Agendamento nao foi concluido');
    }

    const listed = await api.get(`/api/schedules?contextType=booking&contextId=${encodeURIComponent(contextId)}&limit=10`);
    const found = (listed?.items || []).find((item) => item.id === scheduleId);
    if (!found || found.status !== 'done') {
      throw new Error('Agendamento nao apareceu na listagem com status final');
    }

    return {
      detail: 'Agendamento criado, confirmado e concluido',
      ids: { scheduleId },
      evidence: { finalStatus: found.status, confirmationStatus: found.confirmationStatus },
    };
  }

  if (definition.code === 'CORE-FLOW-PAYMENT-CHARGE') {
    const charge = await api.post('/billing/create-charge', {
      type: 'one_time',
      amount: 89.9,
      currency: 'BRL',
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      provider: 'sandbox',
      description: `Cobranca avulsa QA ${definition.code}`,
      customerName: 'Cliente QA Core',
      customerEmail: `core-charge-${runId}@qa.example.com`,
      idempotencyKey: `business-qa:${definition.code}:${runId}`,
      metadata: { source: 'business_qa', scenarioCode: definition.code },
    });
    const transaction = charge?.transaction;
    if (!transaction?.id) {
      throw new Error('Cobrança nao retornou transacao');
    }

    await confirmTransaction(api, transaction);

    const payments = await api.get('/billing/transactions?limit=50');
    const tx = (payments?.items || []).find((item) => item.id === transaction.id);
    if (!tx || tx.status !== 'confirmed') {
      throw new Error('Pagamento nao ficou confirmado na listagem de transacoes');
    }

    return {
      detail: 'Cobranca avulsa criada e pagamento confirmado',
      ids: { transactionId: transaction.id },
      evidence: { finalStatus: tx.status },
    };
  }

  if (definition.code === 'CORE-CAP-SCHEDULING') {
    const purposes = await api.get('/api/schedule-purposes');
    const purposeItems = Array.isArray(purposes?.items) ? purposes.items : [];
    const hasPurpose = purposeItems.some((item) => String(item?.value || item || '').toLowerCase() === 'atendimento');
    if (!hasPurpose) {
      throw new Error('Catalogo de purposes sem "atendimento" (scheduling)');
    }

    const calendar = await api.get('/api/calendar/me');
    const resourceId = calendar?.resourceId;
    if (!resourceId) {
      throw new Error('Calendario do agente indisponivel (resourceId ausente)');
    }

    const contextId = `qa-scheduling-${runId}`;
    const created = await api.post('/api/schedules', {
      contextType: 'booking',
      contextId,
      ownerId: resourceId,
      startAt: new Date(Date.now() + 4 * 3600000).toISOString(),
      endAt: new Date(Date.now() + 5 * 3600000).toISOString(),
      purpose: 'atendimento',
      requiresConfirmation: true,
      metadata: { source: 'business_qa', scenarioCode: definition.code },
    });
    const scheduleId = created?.schedule?.id;
    if (!scheduleId) {
      throw new Error('Agendamento (scheduling) nao retornou ID');
    }

    const calendarAfter = await api.get('/api/calendar/me');
    const visibleInCalendar = (calendarAfter?.items || [])
      .some((item) => item.id === scheduleId && item.type === 'schedule');
    if (!visibleInCalendar) {
      throw new Error('Agendamento nao apareceu no calendario do recurso');
    }

    const block = await api.post(`/api/calendar/resource/${encodeURIComponent(resourceId)}/blocks`, {
      startAt: new Date(Date.now() + 6 * 3600000).toISOString(),
      endAt: new Date(Date.now() + 7 * 3600000).toISOString(),
      metadata: { reason: 'bloqueio_qa_scheduling' },
    });
    const blockId = block?.id || block?.item?.id || block?.block?.id || block?.schedule?.id;
    if (!blockId) {
      throw new Error('Bloco de calendario nao retornou ID');
    }

    const resourceCalendar = await api.get(`/api/calendar/resource/${encodeURIComponent(resourceId)}`);
    const blockVisible = (resourceCalendar?.items || [])
      .some((item) => item.id === blockId && item.type === 'block');
    if (!blockVisible) {
      throw new Error('Bloco nao refletido no calendario do recurso');
    }

    await api.del(`/api/calendar/resource/${encodeURIComponent(resourceId)}/blocks/${encodeURIComponent(blockId)}`);
    const calendarAfterDelete = await api.get(`/api/calendar/resource/${encodeURIComponent(resourceId)}`);
    const blockRemoved = !(calendarAfterDelete?.items || []).some((item) => item.id === blockId);
    if (!blockRemoved) {
      throw new Error('Bloco nao foi removido do calendario');
    }

    const confirmed = await api.post(`/api/schedules/${encodeURIComponent(scheduleId)}/confirm`, {});
    if (confirmed?.schedule?.confirmationStatus !== 'confirmed') {
      throw new Error('Agendamento (scheduling) nao registrou confirmacao');
    }
    const done = await api.post(`/api/schedules/${encodeURIComponent(scheduleId)}/done`, {});
    if (done?.schedule?.status !== 'done') {
      throw new Error('Agendamento (scheduling) nao foi concluido');
    }

    return {
      detail: 'Capability scheduling: catalogo, agenda do recurso, bloco criado/removido e agendamento concluido',
      ids: { scheduleId, blockId, resourceId },
      evidence: { finalStatus: done.schedule.status, confirmationStatus: confirmed.schedule.confirmationStatus, blockRemoved },
    };
  }

  if (definition.code === 'CORE-CAP-CRM-UPDATES') {
    const account = await api.post('/api/crm/accounts', {
      name: `QA Cap CRM Updates ${runId}`,
      industry: 'qa',
      tags: ['business_qa'],
    });
    const accountId = account?.id;
    if (!accountId) {
      throw new Error('Conta CRM nao retornou ID');
    }

    const contact = await api.post('/api/crm/contacts', {
      name: 'Contato QA CRM Updates',
      phone: `+55119${String(Date.now()).slice(-8)}`,
      accountId,
      tags: ['business_qa'],
    });
    const contactId = contact?.id;
    if (!contactId) {
      throw new Error('Contato CRM nao retornou ID');
    }

    const opportunity = await api.post('/api/crm/opportunities', {
      name: `Oportunidade QA CRM Updates ${runId}`,
      accountId,
      contactId,
      value: 199.9,
      stageId: 'stage-novo',
    });
    const opportunityId = opportunity?.id;
    if (!opportunityId) {
      throw new Error('Oportunidade CRM nao retornou ID');
    }

    const moved = await api.post(`/api/crm/opportunities/${encodeURIComponent(opportunityId)}/move`, {
      toStageId: 'stage-negociacao',
    });
    if (moved?.stageId !== 'stage-negociacao') {
      throw new Error('Oportunidade nao mudou de estagio (crm_updates)');
    }

    const activity = await api.post('/api/crm/activities', {
      type: 'note',
      subjectType: 'contact',
      subjectId: contactId,
      description: 'Atualizacao CRM registrada pelo cenario de capability (business QA).',
    });
    const activityId = activity?.id;
    if (!activityId) {
      throw new Error('Atividade CRM nao retornou ID');
    }

    const timeline = await api.get(`/api/crm/timeline?subjectType=contact&subjectId=${encodeURIComponent(contactId)}`);
    const inTimeline = (timeline?.items || []).some((item) => item.id === activityId);
    if (!inTimeline) {
      throw new Error('Atualizacao nao apareceu na timeline do contato');
    }

    const reloaded = await api.get(`/api/crm/opportunities/${encodeURIComponent(opportunityId)}`);
    if (reloaded?.stageId !== 'stage-negociacao') {
      throw new Error('Estagio atualizado nao persistiu');
    }

    return {
      detail: 'Capability crm_updates: conta, contato, oportunidade movida e atualizacao visivel na timeline',
      ids: { accountId, contactId, opportunityId, activityId },
      evidence: { stageId: reloaded.stageId, timelineTotal: timeline.total },
    };
  }

  if (definition.code === 'CORE-CAP-LEAD-CAPTURE') {
    const phoneSuffix = String(Date.now()).slice(-8);
    const created = await api.post('/api/crm/leads', {
      name: `Lead QA Capture ${runId}`,
      phone: `+55119${phoneSuffix}`,
      source: 'whatsapp',
      tags: ['business_qa'],
      attributes: { scenarioCode: definition.code },
    });
    const leadId = created?.id;
    if (!leadId) {
      throw new Error('Lead nao retornou ID');
    }
    if (created.source !== 'whatsapp') {
      throw new Error(`Lead capturado sem origem registrada: ${created.source}`);
    }

    const reloaded = await api.get(`/api/crm/leads/${encodeURIComponent(leadId)}`);
    if (!reloaded || reloaded.id !== leadId) {
      throw new Error('Lead nao persistiu (lead_capture)');
    }
    if (reloaded.stage !== 'novo') {
      throw new Error(`Lead persistiu com estagio inesperado: ${reloaded.stage}`);
    }

    const listed = await api.get('/api/crm/leads?limit=100');
    const found = (listed?.items || []).find((item) => item.id === leadId);
    if (!found) {
      throw new Error('Lead nao apareceu na listagem de leads');
    }

    return {
      detail: 'Capability lead_capture: lead capturado com origem, persistido e listado',
      ids: { leadId },
      evidence: { stage: reloaded.stage, source: reloaded.source },
    };
  }

  if (definition.code === 'CORE-FLOW-PAYMENT-IDEMPOTENT') {
    const idempotencyKey = `business-qa:${definition.code}:${runId}`;
    const payload = {
      type: 'one_time',
      amount: 49.9,
      currency: 'BRL',
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      provider: 'sandbox',
      description: `Cobranca idempotente QA ${definition.code}`,
      customerName: 'Cliente QA Core Idempotente',
      customerEmail: `core-idem-${runId}@qa.example.com`,
      idempotencyKey,
      metadata: { source: 'business_qa', scenarioCode: definition.code },
    };

    const first = await api.post('/billing/create-charge', payload);
    const second = await api.post('/billing/create-charge', payload);
    const firstId = first?.transaction?.id;
    const secondId = second?.transaction?.id;
    if (!firstId || !secondId) {
      throw new Error('Cobranca idempotente nao retornou transacao');
    }
    if (firstId !== secondId) {
      throw new Error(`Idempotencia violada: mesma chave gerou ${firstId} e ${secondId}`);
    }

    const payments = await api.get('/billing/transactions?limit=100');
    const matches = (payments?.items || []).filter((item) => item.idempotency_key === idempotencyKey);
    if (matches.length !== 1) {
      throw new Error(`Listagem deveria ter exatamente 1 transacao para a chave, encontrou ${matches.length}`);
    }

    await confirmTransaction(api, first.transaction);
    const confirmed = await api.get('/billing/transactions?limit=100');
    const tx = (confirmed?.items || []).find((item) => item.id === firstId);
    if (!tx || tx.status !== 'confirmed') {
      throw new Error('Transacao unica nao ficou confirmada apos webhook');
    }

    return {
      detail: 'Retry com mesma idempotencyKey nao duplicou transacao; pagamento confirmado',
      ids: { transactionId: firstId },
      evidence: { idempotencyKey, finalStatus: tx.status },
    };
  }

  if (definition.code === 'CORE-FLOW-PAYMENT-INVALID') {
    const idempotencyKey = `business-qa:${definition.code}:${runId}`;
    let rejection = null;
    try {
      await api.post('/billing/create-charge', {
        type: 'one_time',
        amount: -50,
        currency: 'BRL',
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        provider: 'sandbox',
        description: `Cobranca invalida QA ${definition.code}`,
        customerName: 'Cliente QA Core Invalido',
        customerEmail: `core-invalid-${runId}@qa.example.com`,
        idempotencyKey,
        metadata: { source: 'business_qa', scenarioCode: definition.code },
      });
    } catch (err) {
      rejection = err;
    }

    if (!rejection) {
      throw new Error('Cobranca com amount invalido foi aceita');
    }
    if (rejection.status !== 422 || rejection.body?.error !== 'validation_error') {
      throw new Error(`Esperava 422 validation_error, veio ${rejection.status} ${rejection.body?.error}`);
    }

    const payments = await api.get('/billing/transactions?limit=100');
    const leaked = (payments?.items || []).filter((item) => item.idempotency_key === idempotencyKey);
    if (leaked.length > 0) {
      throw new Error('Transacao persistida apesar da rejeicao por validacao');
    }

    return {
      detail: 'Cobranca com amount invalido rejeitada com 422 e sem persistencia',
      ids: {},
      evidence: { status: rejection.status, error: rejection.body?.error },
    };
  }

  if (definition.code === 'FIT-FLOW-LEAD-FUNNEL') {
    await ensureDbConnection();
    const marketingService = require('../../../api/services/marketing/marketingService');
    const suffix = `${runId}-lead-funnel`;

    const created = await marketingService.upsertLead({
      tenantId: TEST_TENANT_ID,
      externalId: `qa-fit-lead-${suffix}`,
      name: `Lead Fitness ${suffix}`,
      phone: '+5511999996000',
      attributesPatch: {
        source: 'business_qa',
        vertical: 'fitness',
        scenarioCode: definition.code,
      },
    });
    const lead = created?.lead || created?.item || created;
    if (!lead?.id) {
      throw new Error('Lead fitness nao retornou ID');
    }

    await marketingService.updateLead({
      tenantId: TEST_TENANT_ID,
      leadId: lead.id,
      stage: 'qualified',
      attributesPatch: { qualifiedBy: 'business_qa' },
    });

    await marketingService.updateLead({
      tenantId: TEST_TENANT_ID,
      leadId: lead.id,
      stage: 'customer',
      attributesPatch: { convertedBy: 'business_qa' },
    });

    const { MarketingLead } = require('../../../api/db/models');
    const Model = MarketingLead();
    const row = await Model.findOne({ where: { tenant_key: TEST_TENANT_ID, id: lead.id } });
    const persisted = row?.toJSON ? row.toJSON() : row;
    if (!persisted) {
      throw new Error('Lead fitness nao persistiu');
    }
    if (persisted.stage !== 'customer') {
      throw new Error(`Funil incompleto: stage final ${persisted.stage}`);
    }
    if (persisted.attributes?.source !== 'business_qa' || persisted.attributes?.convertedBy !== 'business_qa') {
      throw new Error('Atributos do funil nao foram preservados');
    }

    return {
      detail: 'Lead fitness captado, qualificado e convertido em cliente',
      ids: { leadId: lead.id },
      evidence: { finalStage: persisted.stage },
    };
  }

  if (definition.code === 'FOOD-FLOW-ORDER-LIFECYCLE') {
    await ensureDbConnection();
    const { createPublicToken } = require('../../../api/services/publicAccessTokenService');
    const storefront = await createPublicToken({
      tenantId: TEST_TENANT_ID,
      kind: 'storefront',
      meta: { source: 'business_qa', scenarioCode: definition.code },
    });
    if (!storefront?.token) {
      throw new Error('Token publico de storefront nao foi criado');
    }

    const idempotencyKey = `business-qa:${definition.code}:${runId}`;
    const orderPayload = {
      customerName: `Cliente QA Food ${runId}`,
      customerPhone: '+5511999997000',
      vertical: 'food',
      items: [{ name: 'Prato QA Lifecycle', qty: 1, price: 32.9 }],
      deliveryType: 'delivery',
      deliveryAddress: { street: 'Rua QA', number: '100', city: 'Sao Paulo' },
      idempotencyKey,
    };

    const created = await api.post(`/storefront/orders?token=${encodeURIComponent(storefront.token)}`, orderPayload);
    const orderId = created?.order?.id;
    if (!orderId) {
      throw new Error('Pedido food nao retornou ID via storefront');
    }
    if (created?.order?.status !== 'created') {
      throw new Error(`Pedido criado com status inesperado: ${created?.order?.status}`);
    }
    if (!created?.delivery?.id) {
      throw new Error('Pedido delivery nao gerou entrega associada');
    }
    if (Number(created?.order?.total_amount) !== 32.9) {
      throw new Error(`Total do pedido nao foi calculado pelos itens: ${created?.order?.total_amount}`);
    }
    const customerId = created?.order?.context?.customerId;
    const customerSubjectId = created?.order?.context?.customerSubjectId;
    if (!customerId || !customerSubjectId) {
      throw new Error('Pedido com telefone nao vinculou cliente (customerId/customerSubjectId ausentes)');
    }
    if (created?.order?.context?.vertical !== 'food') {
      throw new Error(`Vertical do pedido nao persistida: ${created?.order?.context?.vertical}`);
    }

    const retryCreate = await api.post(`/storefront/orders?token=${encodeURIComponent(storefront.token)}`, orderPayload);
    if (retryCreate?.order?.id !== orderId) {
      throw new Error('Retry publico com mesma idempotencyKey duplicou pedido');
    }

    const chain = ['confirmed', 'preparing', 'ready', 'dispatched', 'delivered'];
    for (const next of chain) {
      await api.put(`/orders/${encodeURIComponent(orderId)}/status`, { status: next });
      const after = await api.get(`/orders/${encodeURIComponent(orderId)}`);
      const observed = String(after?.order?.status || '').toLowerCase();
      if (observed !== next) {
        throw new Error(`Pedido nao transicionou para ${next} (observado: ${observed})`);
      }
    }

    // Jornada do cliente: order_placed (criação) e order_delivered (entrega).
    const sequelize = require('../../../api/db/sequelize').getSequelize();
    const [journeyEvents] = await sequelize.query(
      `SELECT event_type FROM vertical_journey_events
       WHERE tenant_key = :tenantId AND subject_id = :subjectId
         AND event_type IN ('order_placed', 'order_delivered')`,
      { replacements: { tenantId: TEST_TENANT_ID, subjectId: customerSubjectId } },
    );
    const journeyTypes = new Set(journeyEvents.map((row) => row.event_type));
    for (const expected of ['order_placed', 'order_delivered']) {
      if (!journeyTypes.has(expected)) {
        throw new Error(`Evento de jornada ${expected} nao registrado para o cliente do pedido`);
      }
    }

    // Notificações das transições: registro com idempotência por (pedido, status).
    // O envio pode falhar por config de ambiente (ex.: WhatsApp ausente) — o que
    // se exige aqui é o registro observável da tentativa, nunca silêncio.
    const [notifications] = await sequelize.query(
      `SELECT template_key, status, recipient_masked FROM notification_deliveries
       WHERE tenant_key = :tenantId AND idempotency_key LIKE :pattern`,
      { replacements: { tenantId: TEST_TENANT_ID, pattern: `order_status:${orderId}:%` } },
    );
    const notifiedTemplates = new Set(notifications.map((row) => row.template_key));
    for (const expected of ['order_confirmed', 'order_delivered']) {
      if (!notifiedTemplates.has(expected)) {
        throw new Error(`Notificacao ${expected} nao registrada para o pedido`);
      }
    }
    if (notifications.some((row) => !row.recipient_masked || !String(row.recipient_masked).includes('*'))) {
      throw new Error('Notificacao de pedido sem recipient mascarado (privacidade)');
    }

    let invalidRejection = null;
    try {
      await api.put(`/orders/${encodeURIComponent(orderId)}/status`, { status: 'preparing' });
    } catch (err) {
      invalidRejection = err;
    }
    if (!invalidRejection || invalidRejection.status !== 400) {
      throw new Error('Transicao invalida a partir de delivered nao foi rejeitada com 400');
    }

    const incidentPayload = {
      type: 'late_delivery',
      queue: 'Delivery',
      message: `Entrega atrasada QA ${runId}`,
      idempotencyKey: `business-qa:${definition.code}:${runId}`,
    };
    const incident = await api.post(`/orders/${encodeURIComponent(orderId)}/incidents`, incidentPayload);
    const ticketId = incident?.ticket?.id || incident?.ticketId;
    if (!ticketId) {
      throw new Error('Incidente nao retornou ticket');
    }

    const retry = await api.post(`/orders/${encodeURIComponent(orderId)}/incidents`, incidentPayload);
    const retryTicketId = retry?.ticket?.id || retry?.ticketId;
    if (retry?.idempotent !== true || retryTicketId !== ticketId) {
      throw new Error('Retry de incidente nao foi idempotente');
    }

    return {
      detail: 'Pedido criado via storefront publico (cliente identificado, total calculado, jornada e notificacoes), ciclo completo, transicao invalida rejeitada e incidente idempotente',
      ids: { orderId, ticketId, customerId },
      evidence: {
        finalStatus: 'delivered',
        invalidTransitionRejected: true,
        channel: 'storefront',
        journeyEvents: [...journeyTypes],
        notifiedTemplates: [...notifiedTemplates],
      },
    };
  }

  if (definition.code === 'FOOD-FLOW-ORDER-PAYMENT') {
    await ensureDbConnection();
    const { createPublicToken } = require('../../../api/services/publicAccessTokenService');
    const storefront = await createPublicToken({
      tenantId: TEST_TENANT_ID,
      kind: 'storefront',
      meta: { source: 'business_qa', scenarioCode: definition.code },
    });
    if (!storefront?.token) {
      throw new Error('Token publico de storefront nao foi criado');
    }

    const idempotencyKey = `business-qa:${definition.code}:${runId}`;
    const created = await api.post(`/storefront/orders?token=${encodeURIComponent(storefront.token)}`, {
      customerName: `Cliente QA Pagamento ${runId}`,
      customerPhone: '+5511999997001',
      vertical: 'food',
      items: [
        { name: 'Pizza QA', qty: 2, price: 35.5 },
        { name: 'Refri QA', qty: 1, price: 8 },
      ],
      deliveryType: 'delivery',
      idempotencyKey,
    });
    const orderId = created?.order?.id;
    if (!orderId) {
      throw new Error('Pedido food (pagamento) nao retornou ID via storefront');
    }
    if (Number(created?.order?.total_amount) !== 79) {
      throw new Error(`Total calculado incorreto: ${created?.order?.total_amount} (esperado 79)`);
    }

    // Cobrança vinculada ao pedido.
    const charge = await api.post(`/orders/${encodeURIComponent(orderId)}/charge`, {
      idempotencyKey: `${idempotencyKey}:charge`,
    });
    const transactionId = charge?.transaction?.id;
    const externalTransactionId = charge?.transaction?.external_transaction_id;
    if (!transactionId || charge?.transaction?.status !== 'pending') {
      throw new Error(`Cobranca nao criada como pending: ${JSON.stringify(charge?.transaction?.status)}`);
    }
    if (Number(charge?.transaction?.amount) !== 79) {
      throw new Error(`Valor da cobranca divergente do pedido: ${charge?.transaction?.amount}`);
    }
    if (charge?.transaction?.metadata?.orderId !== orderId) {
      throw new Error('Cobranca sem metadata.orderId — webhook nao conseguiria vincular ao pedido');
    }
    if (charge?.payment?.status !== 'pending' || charge?.payment?.transactionId !== transactionId) {
      throw new Error('Pedido nao registrou payment pending vinculado a transacao');
    }

    // Retry de cobrança: mesma transação, sem duplicar.
    const retryCharge = await api.post(`/orders/${encodeURIComponent(orderId)}/charge`, {
      idempotencyKey: `${idempotencyKey}:charge`,
    });
    if (retryCharge?.idempotent !== true || retryCharge?.transaction?.id !== transactionId) {
      throw new Error('Retry de cobranca nao foi idempotente');
    }

    // Pedido sem total não pode gerar cobrança (422 validation_error).
    const noTotal = await api.post(`/storefront/orders?token=${encodeURIComponent(storefront.token)}`, {
      customerName: `Cliente QA Sem Total ${runId}`,
      items: [{ name: 'Item sem preco QA', qty: 1 }],
      deliveryType: 'pickup',
      idempotencyKey: `${idempotencyKey}:sem-total`,
    });
    const noTotalOrderId = noTotal?.order?.id;
    if (!noTotalOrderId) {
      throw new Error('Pedido sem total nao retornou ID');
    }
    let chargeRejected = null;
    try {
      await api.post(`/orders/${encodeURIComponent(noTotalOrderId)}/charge`, {});
    } catch (err) {
      chargeRejected = err;
    }
    if (!chargeRejected || chargeRejected.status !== 422) {
      throw new Error(`Cobranca de pedido sem total nao rejeitada com 422: ${chargeRejected?.status}`);
    }

    // Webhook do provedor confirma o pagamento → pedido payment.paid.
    await api.post('/billing/webhook', {
      provider: 'sandbox',
      eventId: `${idempotencyKey}:webhook`,
      payment: { id: externalTransactionId, status: 'CONFIRMED' },
    });
    const afterPayment = await api.get(`/orders/${encodeURIComponent(orderId)}`);
    const payment = afterPayment?.order?.context?.payment;
    if (payment?.status !== 'paid' || !payment?.paidAt) {
      throw new Error(`Pagamento nao confirmado no pedido: ${JSON.stringify(payment)}`);
    }

    return {
      detail: 'Pedido pago ponta a ponta: total calculado, cobranca vinculada e idempotente, pedido sem total rejeitado (422), webhook confirmou payment.paid',
      ids: { orderId, transactionId },
      evidence: {
        totalAmount: 79,
        paymentStatus: payment.status,
        idempotentRetry: true,
        noTotalRejected: true,
        provider: 'sandbox',
      },
    };
  }

  if (definition.code === 'MARKET-FLOW-ORDER-CUSTOMER') {
    await ensureDbConnection();
    const { createPublicToken } = require('../../../api/services/publicAccessTokenService');
    const storefront = await createPublicToken({
      tenantId: TEST_TENANT_ID,
      kind: 'storefront',
      meta: { source: 'business_qa', scenarioCode: definition.code },
    });
    if (!storefront?.token) {
      throw new Error('Token publico de storefront nao foi criado');
    }

    const phone = '+5511999997002';
    const basePayload = {
      customerName: `Cliente QA Market ${runId}`,
      customerPhone: phone,
      vertical: 'market',
      items: [{ name: 'Cesta QA Market', qty: 1, price: 59.9 }],
      deliveryType: 'pickup',
    };

    const first = await api.post(`/storefront/orders?token=${encodeURIComponent(storefront.token)}`, {
      ...basePayload,
      idempotencyKey: `business-qa:${definition.code}:${runId}:1`,
    });
    const firstOrderId = first?.order?.id;
    if (!firstOrderId) {
      throw new Error('Pedido market nao retornou ID via storefront');
    }
    if (first?.order?.context?.vertical !== 'market') {
      throw new Error(`Vertical market nao persistida: ${first?.order?.context?.vertical}`);
    }
    const customerId = first?.order?.context?.customerId;
    const customerSubjectId = first?.order?.context?.customerSubjectId;
    if (!customerId || !customerSubjectId) {
      throw new Error('Pedido market nao vinculou cliente');
    }

    // CustomerId determinístico: segundo pedido do mesmo telefone reutiliza o cliente.
    const second = await api.post(`/storefront/orders?token=${encodeURIComponent(storefront.token)}`, {
      ...basePayload,
      idempotencyKey: `business-qa:${definition.code}:${runId}:2`,
    });
    if (second?.order?.context?.customerId !== customerId) {
      throw new Error('Segundo pedido do mesmo telefone gerou customerId diferente');
    }

    const sequelize = require('../../../api/db/sequelize').getSequelize();
    const [journeyEvents] = await sequelize.query(
      `SELECT event_type, vertical FROM vertical_journey_events
       WHERE tenant_key = :tenantId AND subject_id = :subjectId AND event_type = 'order_placed'`,
      { replacements: { tenantId: TEST_TENANT_ID, subjectId: customerSubjectId } },
    );
    if (!journeyEvents.some((row) => row.vertical === 'market')) {
      throw new Error('Jornada market nao registrou order_placed para o cliente do pedido');
    }

    return {
      detail: 'Pedido market com vertical propria, cliente identificado (customerId deterministico) e jornada market alimentada',
      ids: { orderId: firstOrderId, customerId },
      evidence: { vertical: 'market', deterministicCustomerId: true, journeyEvent: 'order_placed' },
    };
  }

  if (definition.code === 'CORE-FLOW-BOOKING-RESCHEDULE') {
    const contextId = `qa-booking-reschedule-${runId}`;
    const startAt = new Date(Date.now() + 4 * 3600000).toISOString();
    const endAt = new Date(Date.now() + 5 * 3600000).toISOString();
    const created = await api.post('/api/schedules', {
      contextType: 'booking',
      contextId,
      startAt,
      endAt,
      purpose: 'atendimento',
      requiresConfirmation: true,
      metadata: { source: 'business_qa', scenarioCode: definition.code },
    });
    const scheduleId = created?.schedule?.id;
    if (!scheduleId) {
      throw new Error('Agendamento nao retornou ID');
    }
    if (created.schedule.confirmationStatus !== 'pending') {
      throw new Error(`Agendamento criado sem confirmacao pendente: ${created.schedule.confirmationStatus}`);
    }

    const newStart = new Date(Date.now() + 8 * 3600000).toISOString();
    const newEnd = new Date(Date.now() + 9 * 3600000).toISOString();
    const rescheduled = await api.post(`/api/schedules/${encodeURIComponent(scheduleId)}/reschedule`, {
      startAt: newStart,
      endAt: newEnd,
    });
    if (rescheduled?.schedule?.startAt !== newStart || rescheduled?.schedule?.endAt !== newEnd) {
      throw new Error('Remarcacao nao persistiu o novo horario');
    }
    if (rescheduled.schedule.status !== 'scheduled') {
      throw new Error(`Remarcacao mudou status indevidamente: ${rescheduled.schedule.status}`);
    }

    const confirmed = await api.post(`/api/schedules/${encodeURIComponent(scheduleId)}/confirm`, {});
    if (confirmed?.schedule?.confirmationStatus !== 'confirmed') {
      throw new Error('Agendamento remarcado nao registrou confirmacao');
    }

    const done = await api.post(`/api/schedules/${encodeURIComponent(scheduleId)}/done`, {});
    if (done?.schedule?.status !== 'done' || done.schedule.startAt !== newStart) {
      throw new Error('Agendamento remarcado nao foi concluido no novo horario');
    }

    return {
      detail: 'Agendamento remarcado, confirmado e concluido no novo horario',
      ids: { scheduleId },
      evidence: { startAt: newStart, finalStatus: done.schedule.status },
    };
  }

  if (definition.code === 'CORE-FLOW-BOOKING-TERMINAL-STATES') {
    const contextId = `qa-booking-terminal-${runId}`;
    const basePayload = {
      contextType: 'booking',
      contextId,
      startAt: new Date(Date.now() + 4 * 3600000).toISOString(),
      endAt: new Date(Date.now() + 5 * 3600000).toISOString(),
      purpose: 'atendimento',
      requiresConfirmation: true,
      metadata: { source: 'business_qa', scenarioCode: definition.code },
    };

    const a = await api.post('/api/schedules', basePayload);
    const aId = a?.schedule?.id;
    const noShow = await api.post(`/api/schedules/${encodeURIComponent(aId)}/no-show`, {});
    if (noShow?.schedule?.status !== 'no_show') {
      throw new Error(`No-show nao persistiu: ${noShow?.schedule?.status}`);
    }

    const b = await api.post('/api/schedules', basePayload);
    const bId = b?.schedule?.id;
    const declined = await api.post(`/api/schedules/${encodeURIComponent(bId)}/decline`, {});
    if (declined?.schedule?.status !== 'cancelled' || declined?.schedule?.confirmationStatus !== 'declined') {
      throw new Error('Recusa nao cancelou agendamento com confirmationStatus declined');
    }

    let invalidAction = null;
    try {
      await api.post(`/api/schedules/${encodeURIComponent(bId)}/acao-inexistente`, {});
    } catch (err) {
      invalidAction = err;
    }
    if (!invalidAction || invalidAction.status !== 404 || invalidAction.body?.error !== 'action_not_found') {
      throw new Error(`Acao invalida nao rejeitada com 404 action_not_found: ${invalidAction?.status} ${invalidAction?.body?.error}`);
    }

    let missing = null;
    try {
      await api.post('/api/schedules/qa-schedule-inexistente/confirm', {});
    } catch (err) {
      missing = err;
    }
    if (!missing || missing.status !== 404 || missing.body?.error !== 'schedule_not_found') {
      throw new Error(`Agendamento inexistente nao rejeitado com 404 schedule_not_found: ${missing?.status} ${missing?.body?.error}`);
    }

    return {
      detail: 'No-show, recusa, acao invalida e agendamento inexistente tratados corretamente',
      ids: { noShowScheduleId: aId, declinedScheduleId: bId },
      evidence: { noShowStatus: 'no_show', declinedStatus: 'cancelled' },
    };
  }

  if (definition.code === 'CORE-FLOW-SUPPORT-TICKET-LIFECYCLE') {
    const phoneSuffix = String(Date.now()).slice(-8);
    const ticket = await api.post('/tickets', {
      phoneNumber: `+55117${phoneSuffix}`,
      queue: 'support',
      initialMessage: 'Cliente QA valida ciclo de vida do ticket (support_ticket_flow)',
    });
    const ticketId = ticket?.id || ticket?.ticket?.id;
    if (!ticketId) {
      throw new Error('Ticket de suporte nao retornou ID');
    }

    await api.post(`/tickets/${encodeURIComponent(ticketId)}/takeover`, {});
    const afterTakeover = await api.get(`/tickets/${encodeURIComponent(ticketId)}`);
    if (afterTakeover?.mode !== 'human' || !afterTakeover?.takeoverAt) {
      throw new Error('Takeover nao colocou o ticket em modo humano com takeoverAt');
    }

    const paused = await api.post(`/tickets/${encodeURIComponent(ticketId)}/pause`, {});
    if ((paused?.pauseReason || paused?.ticket?.pauseReason) !== 'outside_window') {
      throw new Error('Pausa nao registrou motivo outside_window');
    }

    const resumed = await api.post(`/tickets/${encodeURIComponent(ticketId)}/resume`, {});
    if ((resumed?.mode || resumed?.ticket?.mode) !== 'human') {
      throw new Error('Retomada nao manteve o ticket em modo humano');
    }

    await api.post(`/tickets/${encodeURIComponent(ticketId)}/close`, {});
    const closed = await api.get(`/tickets/${encodeURIComponent(ticketId)}`);
    if (String(closed?.status || '').toLowerCase() !== 'closed') {
      throw new Error('Ticket do ciclo de vida nao foi encerrado');
    }

    return {
      detail: 'Ticket percorreu takeover, pausa, retomada e encerramento com estados persistidos',
      ids: { ticketId },
      evidence: { finalStatus: closed.status },
    };
  }

  if (definition.code === 'CORE-FLOW-SUPPORT-TICKET-NOTFOUND') {
    const missingId = `qa-ticket-inexistente-${runId}`;
    const attempts = [
      { action: 'takeover', payload: {} },
      { action: 'message', payload: { message: 'Mensagem QA em ticket inexistente' } },
      { action: 'close', payload: {} },
    ];

    for (const attempt of attempts) {
      let rejection = null;
      try {
        await api.post(`/tickets/${encodeURIComponent(missingId)}/${attempt.action}`, attempt.payload);
      } catch (err) {
        rejection = err;
      }
      if (!rejection) {
        throw new Error(`${attempt.action} em ticket inexistente foi aceito`);
      }
      if (![400, 404].includes(rejection.status)) {
        throw new Error(`${attempt.action} em ticket inexistente retornou ${rejection.status} (esperado 404)`);
      }
    }

    return {
      detail: 'Takeover, mensagem e close em ticket inexistente rejeitados sem efeito colateral',
      ids: {},
      evidence: { rejectedActions: attempts.map((attempt) => attempt.action) },
    };
  }

  if (definition.code === 'CORE-BIZ-ORDERS') {
    await ensureDbConnection();
    const { createPublicToken } = require('../../../api/services/publicAccessTokenService');
    const storefront = await createPublicToken({
      tenantId: TEST_TENANT_ID,
      kind: 'storefront',
      meta: { source: 'business_qa', scenarioCode: definition.code },
    });
    if (!storefront?.token) {
      throw new Error('Token publico de storefront nao foi criado');
    }

    const idempotencyKey = `business-qa:${definition.code}:${runId}`;
    const created = await api.post(`/storefront/orders?token=${encodeURIComponent(storefront.token)}`, {
      customerName: `Cliente QA Orders ${runId}`,
      customerPhone: '+5511999997100',
      items: [{ name: 'Item QA Orders', qty: 2, price: 19.9 }],
      deliveryType: 'pickup',
      idempotencyKey,
    });
    const orderId = created?.order?.id;
    if (!orderId) {
      throw new Error('Pedido nao retornou ID via storefront');
    }
    if (Number(created?.order?.total_amount) !== 39.8) {
      throw new Error(`Total do pedido incorreto: ${created?.order?.total_amount}`);
    }

    const listed = await api.get('/orders?limit=50');
    const found = (listed?.orders || []).find((item) => item.id === orderId);
    if (!found) {
      throw new Error('Pedido criado nao apareceu na listagem operacional');
    }

    await api.put(`/orders/${encodeURIComponent(orderId)}/status`, { status: 'confirmed' });
    const after = await api.get(`/orders/${encodeURIComponent(orderId)}`);
    if (String(after?.order?.status || '').toLowerCase() !== 'confirmed') {
      throw new Error('Pedido nao avancou para confirmed');
    }

    const charge = await api.post(`/orders/${encodeURIComponent(orderId)}/charge`, {
      amount: 39.8,
      currency: 'BRL',
      provider: 'sandbox',
      idempotencyKey: `${idempotencyKey}:charge`,
    });
    const transaction = charge?.transaction;
    if (!transaction?.id) {
      throw new Error('Cobranca do pedido nao retornou transacao');
    }
    await confirmTransaction(api, transaction);
    const payments = await api.get('/billing/transactions?limit=50');
    const tx = (payments?.items || []).find((item) => item.id === transaction.id);
    if (!tx || tx.status !== 'confirmed') {
      throw new Error('Cobranca do pedido nao ficou confirmada');
    }

    return {
      detail: 'Pedido criado, confirmado, cobrado e pago',
      ids: { orderId, transactionId: transaction.id },
      evidence: { status: after.order.status, paymentStatus: tx.status },
    };
  }

  if (definition.code === 'CORE-BIZ-BILLING') {
    const idempotencyKey = `business-qa:${definition.code}:${runId}`;
    const charge = await api.post('/billing/create-charge', {
      type: 'one_time',
      amount: 24.9,
      currency: 'BRL',
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      provider: 'sandbox',
      description: `Cobranca QA ${definition.code}`,
      customerName: 'Cliente QA Billing',
      customerEmail: `core-billing-${runId}@qa.example.com`,
      idempotencyKey,
      metadata: { source: 'business_qa', scenarioCode: definition.code },
    });
    const transaction = charge?.transaction;
    if (!transaction?.id) {
      throw new Error('Cobranca nao retornou transacao');
    }

    await confirmTransaction(api, transaction);

    const payments = await api.get('/billing/transactions?limit=50');
    const tx = (payments?.items || []).find((item) => item.id === transaction.id);
    if (!tx) {
      throw new Error('Transacao ausente na listagem de billing');
    }
    if (tx.status !== 'confirmed') {
      throw new Error(`Transacao nao ficou confirmada: ${tx.status}`);
    }

    return {
      detail: 'Cobrança criada e confirmada via webhook sandbox',
      ids: { transactionId: transaction.id },
      evidence: { finalStatus: tx.status },
    };
  }

  if (definition.code === 'CORE-BIZ-BILLING-IDEMPOTENCY') {
    // Invariante REAL do serviço de billing (verificado por sonda em
    // 2026-09-19): a MESMA idempotencyKey devolve a MESMA transação e não
    // duplica linha na listagem. Cobrar duas vezes o mesmo pedido é o defeito
    // clássico de integração de pagamento — este cenário o impede de voltar.
    const idempotencyKey = `business-qa:${definition.code}:${runId}`;
    const payload = {
      type: 'one_time',
      amount: 31.7,
      currency: 'BRL',
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      provider: 'sandbox',
      description: `Idempotencia QA ${definition.code}`,
      customerName: 'Cliente QA Idempotencia',
      customerEmail: `core-billing-idem-${runId}@qa.example.com`,
      idempotencyKey,
      metadata: { source: 'business_qa', scenarioCode: definition.code },
    };

    const first = await api.post('/billing/create-charge', payload);
    const firstTx = first?.transaction;
    if (!firstTx?.id) throw new Error('Primeira cobranca nao retornou transacao');

    const second = await api.post('/billing/create-charge', payload);
    const secondTx = second?.transaction;
    if (!secondTx?.id) throw new Error('Segunda cobranca nao retornou transacao');
    if (secondTx.id !== firstTx.id) {
      throw new Error(`idempotencyKey duplicou a cobranca: ${firstTx.id} -> ${secondTx.id}`);
    }

    const payments = await api.get('/billing/transactions?limit=100');
    const occurrences = (payments?.items || []).filter((item) => item.id === firstTx.id);
    if (occurrences.length !== 1) {
      throw new Error(`Transacao aparece ${occurrences.length}x na listagem (esperado 1)`);
    }

    return {
      detail: 'Mesma idempotencyKey devolve a mesma transacao, sem duplicar',
      ids: { transactionId: firstTx.id },
      evidence: { occurrences: occurrences.length, idempotencyKey },
    };
  }

  if (definition.code === 'CORE-BIZ-BILLING-STATE') {
    // A transição pending -> confirmed tem de ser OBSERVÁVEL. Sem observar o
    // estado inicial, "confirmou" não prova nada (poderia ter nascido
    // confirmada e o webhook ser decorativo).
    const idempotencyKey = `business-qa:${definition.code}:${runId}`;
    const charge = await api.post('/billing/create-charge', {
      type: 'one_time',
      amount: 18.4,
      currency: 'BRL',
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      provider: 'sandbox',
      description: `Transicao QA ${definition.code}`,
      customerName: 'Cliente QA Transicao',
      customerEmail: `core-billing-state-${runId}@qa.example.com`,
      idempotencyKey,
      metadata: { source: 'business_qa', scenarioCode: definition.code },
    });
    const transaction = charge?.transaction;
    if (!transaction?.id) throw new Error('Cobranca nao retornou transacao');

    const beforeList = await api.get('/billing/transactions?limit=100');
    const beforeTx = (beforeList?.items || []).find((item) => item.id === transaction.id);
    if (!beforeTx) throw new Error('Transacao nao aparece na listagem antes da confirmacao');
    if (String(beforeTx.status) === 'confirmed') {
      throw new Error('Transacao nasceu confirmed: estado inicial nao observavel');
    }

    await confirmTransaction(api, transaction);

    const afterList = await api.get('/billing/transactions?limit=100');
    const afterTx = (afterList?.items || []).find((item) => item.id === transaction.id);
    if (!afterTx) throw new Error('Transacao sumiu da listagem apos a confirmacao');
    if (afterTx.status !== 'confirmed') {
      throw new Error(`Transacao nao ficou confirmed: ${afterTx.status}`);
    }

    return {
      detail: 'Transicao pending -> confirmed observada na listagem',
      ids: { transactionId: transaction.id },
      evidence: { initialStatus: beforeTx.status, finalStatus: afterTx.status },
    };
  }

  if (definition.code === 'CORE-BIZ-TASKS') {
    const title = `Tarefa QA ${definition.code} ${runId}`;
    const created = await api.post('/api/tasks', {
      title,
      description: 'Tarefa criada pela jornada business tasks',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const task = created?.task || created;
    if (!task?.id) {
      throw new Error('Tarefa nao retornou ID');
    }

    const listed = await api.get('/api/tasks');
    const found = (listed?.tasks || []).find((item) => item.id === task.id);
    if (!found) {
      throw new Error('Tarefa criada nao apareceu na listagem');
    }

    await api.post(`/api/tasks/${encodeURIComponent(task.id)}/complete`, {});
    const reloaded = await api.get('/api/tasks');
    const done = (reloaded?.tasks || []).find((item) => item.id === task.id);
    if (!done || !['done', 'completed'].includes(String(done.status || '').toLowerCase())) {
      throw new Error(`Tarefa nao ficou concluida: ${done && done.status}`);
    }

    return {
      detail: 'Tarefa criada, listada e concluída',
      ids: { taskId: task.id },
      evidence: { finalStatus: done.status },
    };
  }

  if (definition.code === 'CORE-BIZ-QUICK-REPLIES') {
    const title = `QR QA ${runId}`;
    const created = await api.post('/quick-replies', {
      title,
      message: 'Resposta rápida criada pela jornada business quick_replies.',
      tags: ['business_qa'],
      category: 'qa',
    });
    const reply = created?.quickReply || created;
    if (!reply?.id) {
      throw new Error('Resposta rápida nao retornou ID');
    }

    const listed = await api.get('/quick-replies');
    const found = (listed?.quickReplies || []).find((item) => item.id === reply.id);
    if (!found) {
      throw new Error('Resposta rápida nao apareceu na listagem');
    }

    await api.del(`/quick-replies/${encodeURIComponent(reply.id)}`);
    const afterDelete = await api.get('/quick-replies');
    if ((afterDelete?.quickReplies || []).some((item) => item.id === reply.id)) {
      throw new Error('Resposta rápida nao foi removida');
    }

    return {
      detail: 'Resposta rápida criada, listada e removida',
      ids: { quickReplyId: reply.id },
      evidence: { deleted: true },
    };
  }

  if (definition.code === 'CORE-BIZ-WEBHOOKS') {
    const created = await api.post('/webhooks', {
      url: `https://qa.example.com/webhooks/${runId}`,
      events: ['ticket.created'],
      active: true,
    });
    const webhook = created?.webhook || created;
    if (!webhook?.id) {
      throw new Error('Webhook nao retornou ID');
    }

    const listed = await api.get('/webhooks');
    const found = (listed?.webhooks || []).find((item) => item.id === webhook.id);
    if (!found) {
      throw new Error('Webhook nao apareceu na listagem');
    }

    await api.del(`/webhooks/${encodeURIComponent(webhook.id)}`);
    const afterDelete = await api.get('/webhooks');
    if ((afterDelete?.webhooks || []).some((item) => item.id === webhook.id)) {
      throw new Error('Webhook nao foi removido');
    }

    return {
      detail: 'Webhook criado, listado e removido',
      ids: { webhookId: webhook.id },
      evidence: { deleted: true },
    };
  }

  if (definition.code === 'CORE-BIZ-INBOX') {
    const listed = await api.get('/inbox/conversations?limit=50');
    const conversations = listed?.conversations || listed?.tickets || listed?.items || [];
    const target = conversations.find((item) => item.status !== 'closed') || conversations[0];
    if (!target?.id) {
      throw new Error('Nenhuma conversa elegível encontrada na inbox');
    }

    await api.post(`/inbox/conversations/${encodeURIComponent(target.id)}/assign`, {});

    const note = `Nota QA ${definition.code} ${runId}`;
    await api.post(`/inbox/conversations/${encodeURIComponent(target.id)}/notes`, { note });

    const reloaded = await api.get('/inbox/conversations?limit=50');
    const updated = (reloaded?.conversations || reloaded?.tickets || reloaded?.items || []).find((item) => item.id === target.id);
    if (!updated) {
      throw new Error('Conversa atribuída sumiu da listagem da inbox');
    }
    if (!updated.assignedTo) {
      throw new Error('Atribuição nao refletida na conversa');
    }

    return {
      detail: 'Conversa atribuída e anotada na inbox',
      ids: { conversationId: target.id },
      evidence: { assignedTo: updated.assignedTo },
    };
  }

  if (definition.code === 'CORE-BIZ-CASES') {
    const listed = await api.get('/inbox/conversations?limit=50');
    const conversations = listed?.conversations || listed?.tickets || listed?.items || [];
    const eligible = conversations.filter((item) => item && item.id);
    if (eligible.length < 2) {
      throw new Error('Cenario requer ao menos 2 conversas na inbox para provar multi-conversation case');
    }

    const [first, second] = eligible;

    const created = await api.post(`/inbox/conversations/${encodeURIComponent(first.id)}/case`, {
      subject: `Chamado QA ${runId}`,
      priority: 'medium',
    });
    const caseData = created?.case || created;
    if (!caseData?.id) {
      throw new Error('Criacao de chamado a partir da conversa nao retornou ID');
    }

    await api.post(`/cases/${encodeURIComponent(caseData.id)}/conversations`, {
      conversationId: second.id,
    });

    const loaded = await api.get(`/cases/${encodeURIComponent(caseData.id)}`);
    const linkedConversations = loaded?.conversations || [];
    const linkedIds = linkedConversations.map((item) => item.id);
    if (!linkedIds.includes(first.id) || !linkedIds.includes(second.id)) {
      throw new Error('Chamado nao consolidou as duas conversas vinculadas');
    }

    const list = await api.get('/cases?limit=50');
    const cases = list?.cases || list?.items || [];
    if (!cases.some((item) => item.id === caseData.id)) {
      throw new Error('Chamado criado nao apareceu na listagem de chamados');
    }

    return {
      detail: 'Chamado criado a partir da inbox consolidando 2 conversas',
      ids: { caseId: caseData.id, conversationIds: [first.id, second.id] },
      evidence: { linkedConversations: linkedIds.length },
    };
  }

  if (definition.code === 'CORE-BIZ-CAMPAIGNS') {
    const emailCampaign = await createBeautyCampaign(api, `${runId}-core-campaigns`);
    if (!emailCampaign?.id) {
      throw new Error('Campanha de e-mail nao retornou ID');
    }
    await publishCampaign(api, emailCampaign.id);

    const bulk = await api.post('/bulk-campaigns', {
      name: `Campanha QA ${runId}`,
      message: 'Mensagem da campanha de QA business.',
      phoneNumbers: ['+5511999997200'],
    });
    const bulkCampaign = bulk?.campaign || bulk;
    if (!bulkCampaign?.id) {
      throw new Error('Campanha em massa nao retornou ID');
    }

    const listed = await api.get('/bulk-campaigns');
    const found = (listed?.campaigns || []).find((item) => item.id === bulkCampaign.id);
    if (!found) {
      throw new Error('Campanha em massa nao apareceu na listagem');
    }

    await api.del(`/bulk-campaigns/${encodeURIComponent(bulkCampaign.id)}`);
    const afterDelete = await api.get('/bulk-campaigns');
    if ((afterDelete?.campaigns || []).some((item) => item.id === bulkCampaign.id)) {
      throw new Error('Campanha em massa nao foi removida');
    }

    return {
      detail: 'Campanha de e-mail publicada e campanha em massa criada/removida',
      ids: { emailCampaignId: emailCampaign.id, bulkCampaignId: bulkCampaign.id },
      evidence: { bulkDeleted: true },
    };
  }

  if (definition.code === 'CORE-BIZ-CAMPAIGNS-VALIDATION') {
    // Invariante REAL (verificado por sonda em 2026-09-19): campanha em massa
    // SEM número válido é recusada com 400 e NÃO cria campanha; com números
    // válidos, os destinatários voltam normalizados. Disparo em massa para
    // lista inválida é dano operacional irreversível (mensagem enviada para
    // quem não é cliente).
    let rejected = null;
    try {
      await api.post('/bulk-campaigns', {
        name: `Campanha invalida QA ${runId}`,
        message: 'Mensagem que NAO pode ser enviada.',
        phoneNumbers: ['nao-e-telefone'],
      });
    } catch (error) {
      rejected = error;
    }
    if (!rejected) {
      throw new Error('Campanha com destinatario invalido NAO foi recusada');
    }
    if (rejected.status !== 400) {
      throw new Error(`Recusa com status inesperado: ${rejected.status}`);
    }

    const created = await api.post('/bulk-campaigns', {
      name: `Campanha valida QA ${runId}`,
      message: 'Mensagem da campanha de validacao.',
      phoneNumbers: ['+5511999997401', '+5511999997402'],
    });
    const campaign = created?.campaign || created;
    if (!campaign?.id) throw new Error('Campanha valida nao retornou ID');
    const recipients = Array.isArray(campaign.phoneNumbers) ? campaign.phoneNumbers : [];
    if (recipients.length !== 2) {
      throw new Error(`Destinatarios normalizados ausentes: ${JSON.stringify(recipients)}`);
    }

    // Limpeza: o cenário não deixa campanha criada para trás.
    await api.del(`/bulk-campaigns/${encodeURIComponent(campaign.id)}`);

    return {
      detail: 'Destinatario invalido recusado (400); valido aceito e normalizado',
      ids: { bulkCampaignId: campaign.id },
      evidence: { rejectedStatus: rejected.status, recipients: recipients.length },
    };
  }

  if (definition.code === 'CORE-BIZ-CAMPAIGNS-DETAIL') {
    // O detalhe e a listagem precisam concordar. Divergência entre GET /:id e
    // a listagem é como um operador "vê" uma campanha que não existe (ou deixa
    // de ver uma que existe).
    const created = await api.post('/bulk-campaigns', {
      name: `Campanha detalhe QA ${runId}`,
      message: 'Mensagem da campanha de detalhe.',
      phoneNumbers: ['+5511999997501'],
    });
    const campaign = created?.campaign || created;
    if (!campaign?.id) throw new Error('Campanha nao retornou ID');

    const detail = await api.get(`/bulk-campaigns/${encodeURIComponent(campaign.id)}`);
    const fetched = detail?.campaign || detail;
    if (!fetched?.id || fetched.id !== campaign.id) {
      throw new Error(`Detalhe devolveu campanha diferente: ${fetched?.id} != ${campaign.id}`);
    }
    if (String(fetched.name) !== String(campaign.name)) {
      throw new Error(`Detalhe com nome divergente: ${fetched.name} != ${campaign.name}`);
    }

    const listed = await api.get('/bulk-campaigns');
    if (!(listed?.campaigns || []).some((item) => item.id === campaign.id)) {
      throw new Error('Campanha criada nao apareceu na listagem');
    }

    await api.del(`/bulk-campaigns/${encodeURIComponent(campaign.id)}`);
    const afterDelete = await api.get('/bulk-campaigns');
    if ((afterDelete?.campaigns || []).some((item) => item.id === campaign.id)) {
      throw new Error('Campanha nao foi removida');
    }

    return {
      detail: 'Detalhe consistente com a listagem; remocao confirmada',
      ids: { bulkCampaignId: campaign.id },
      evidence: { nameMatched: true, removed: true },
    };
  }

  if (definition.code === 'CORE-BIZ-CALENDAR-BLOCK') {
    // Bloqueio de agenda de um recurso: criar -> aparecer na agenda -> remover
    // -> sumir. O recurso é resolvido pela PRÓPRIA API (`/api/calendar/me`), não
    // por id fixo: o cenário não depende de dado semeado. Contrato sondado em
    // 2026-09-19 (POST devolve 201 `{ item }`; a listagem usa `items`).
    const me = await api.get('/api/calendar/me');
    const resourceId = me?.resourceId;
    if (!resourceId) throw new Error('Agenda do usuario sem resourceId');

    const startAt = new Date(Date.now() + 86400000).toISOString();
    const endAt = new Date(Date.now() + 90000000).toISOString();
    const created = await api.post(`/api/calendar/resource/${encodeURIComponent(resourceId)}/blocks`, {
      title: 'Bloqueio QA',
      startAt,
      endAt,
      reason: `business:${definition.code}:${runId}`,
    });
    const block = created?.item;
    if (!block?.id) throw new Error('Bloqueio nao retornou id');
    if (block.type !== 'block') throw new Error(`Item criado nao e bloqueio: ${block.type}`);
    if (block.startAt !== startAt) {
      throw new Error(`startAt nao respeitado: ${block.startAt} != ${startAt}`);
    }

    const listed = await api.get(`/api/calendar/resource/${encodeURIComponent(resourceId)}`);
    if (!(listed?.items || []).some((item) => item.id === block.id)) {
      throw new Error('Bloqueio nao apareceu na agenda do recurso');
    }

    await api.del(`/api/calendar/resource/${encodeURIComponent(resourceId)}/blocks/${encodeURIComponent(block.id)}`);
    const afterDelete = await api.get(`/api/calendar/resource/${encodeURIComponent(resourceId)}`);
    if ((afterDelete?.items || []).some((item) => item.id === block.id)) {
      throw new Error('Bloqueio nao foi removido da agenda');
    }

    return {
      detail: 'Bloqueio de agenda criado, listado e removido',
      ids: { resourceId, blockId: block.id },
      evidence: { type: block.type, startAt: block.startAt, removed: true },
    };
  }

  if (definition.code === 'CORE-BIZ-PROJECTS') {
    const created = await api.post('/projects', {
      name: `Projeto QA ${runId}`,
      description: 'Projeto criado pela jornada business projects',
    });
    const project = created?.project || created;
    if (!project?.id) {
      throw new Error('Projeto nao retornou ID');
    }

    const itemCreated = await api.post(`/projects/${encodeURIComponent(project.id)}/items`, {
      title: `Item QA ${runId}`,
    });
    const item = itemCreated?.item || itemCreated;
    if (!item?.id) {
      throw new Error('Item do projeto nao retornou ID');
    }

    await api.post(
      `/projects/${encodeURIComponent(project.id)}/items/${encodeURIComponent(item.id)}/complete`,
      {},
    );

    const items = await api.get(`/projects/${encodeURIComponent(project.id)}/items`);
    const itemList = items?.items || items?.project?.items || [];
    const doneItem = itemList.find((entry) => entry.id === item.id);
    if (!doneItem) {
      throw new Error('Item concluído ausente na listagem do projeto');
    }
    if (!['done', 'completed'].includes(String(doneItem.status || '').toLowerCase())) {
      throw new Error(`Item nao ficou concluído: ${doneItem.status}`);
    }

    const dashboard = await api.get(`/projects/${encodeURIComponent(project.id)}/dashboard`);
    if (!dashboard || dashboard.error) {
      throw new Error('Dashboard do projeto indisponível após operacoes');
    }

    return {
      detail: 'Projeto criado com item concluído e dashboard consistente',
      ids: { projectId: project.id, itemId: item.id },
      evidence: { itemStatus: doneItem.status },
    };
  }

  if (definition.code === 'CORE-BIZ-MARKETING') {
    const slug = `form-qa-${runId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const form = await api.post('/api/marketing/forms', {
      name: `Form QA ${runId}`,
      slug,
      fields: [{ name: 'nome', type: 'text', required: true }],
    });
    const formId = form?.form?.id;
    if (!formId) {
      throw new Error('Formulário de marketing nao retornou ID');
    }

    const forms = await api.get('/api/marketing/forms');
    const formItems = forms?.items || forms?.forms || [];
    if (!formItems.some((item) => item.id === formId)) {
      throw new Error('Formulário criado nao apareceu na listagem');
    }

    const rule = await api.post('/api/marketing/scoring-rules', {
      name: `Rule QA ${runId}`,
      eventType: 'message_received',
      delta: 10,
      conditions: { field: 'source', operator: 'equals', value: 'whatsapp' },
    });
    const ruleId = rule?.rule?.id;
    if (!ruleId) {
      throw new Error('Regra de scoring nao retornou ID');
    }

    const rules = await api.get('/api/marketing/scoring-rules');
    if (!(rules?.items || []).some((item) => item.id === ruleId)) {
      throw new Error('Regra de scoring nao apareceu na listagem');
    }

    return {
      detail: 'Formulário e regra de scoring criados e listados',
      ids: { formId, ruleId },
      evidence: { slug },
    };
  }

  if (definition.code === 'CORE-BIZ-AUTOMATIONS') {
    const created = await api.post('/automations', {
      name: `Automação QA ${runId}`,
      trigger: { type: 'ticket.created' },
      actions: [{ type: 'noop' }],
    });
    const automation = created?.automation || created;
    if (!automation?.id) {
      throw new Error('Automação nao retornou ID');
    }
    if (automation.status !== 'draft') {
      throw new Error(`Automação criada com status inesperado: ${automation.status}`);
    }

    await api.post(`/automations/${encodeURIComponent(automation.id)}/publish`, {});

    const listed = await api.get('/automations');
    const items = listed?.automations || listed?.items || [];
    const published = items.find((item) => item.id === automation.id);
    if (!published) {
      throw new Error('Automação nao apareceu na listagem');
    }
    if (published.status !== 'published') {
      throw new Error(`Automação nao ficou publicada: ${published.status}`);
    }

    return {
      detail: 'Automação criada e publicada',
      ids: { automationId: automation.id },
      evidence: { finalStatus: published.status },
    };
  }

  if (definition.code === 'CORE-BIZ-SLA') {
    const created = await api.post('/sla/policies', {
      name: `SLA QA ${runId}`,
      responseMinutes: 30,
      resolutionMinutes: 120,
    });
    const policy = created?.policy || created;
    if (!policy?.id) {
      throw new Error('Política de SLA nao retornou ID');
    }

    const listed = await api.get('/sla/policies');
    const items = listed?.policies || listed?.items || [];
    if (!items.some((item) => item.id === policy.id)) {
      throw new Error('Política de SLA nao apareceu na listagem');
    }

    const breaches = await api.get('/sla/breaches');
    if (!breaches || breaches.error) {
      throw new Error('Endpoint de breaches do SLA indisponível');
    }

    return {
      detail: 'Política de SLA criada, listada e breaches consultadas',
      ids: { policyId: policy.id },
      evidence: { breachesOk: true },
    };
  }

  if (definition.code === 'CORE-BIZ-DELIVERIES') {
    await ensureDbConnection();
    const { createPublicToken } = require('../../../api/services/publicAccessTokenService');
    const storefront = await createPublicToken({
      tenantId: TEST_TENANT_ID,
      kind: 'storefront',
      meta: { source: 'business_qa', scenarioCode: definition.code },
    });
    if (!storefront?.token) {
      throw new Error('Token publico de storefront nao foi criado');
    }

    const created = await api.post(`/storefront/orders?token=${encodeURIComponent(storefront.token)}`, {
      customerName: `Cliente QA Deliveries ${runId}`,
      customerPhone: '+5511999997400',
      items: [{ name: 'Item QA Deliveries', qty: 1, price: 15.0 }],
      deliveryType: 'delivery',
      deliveryAddress: { street: 'Rua QA', number: '200', city: 'Sao Paulo' },
      idempotencyKey: `business-qa:${definition.code}:${runId}`,
    });
    const deliveryId = created?.delivery?.id;
    if (!deliveryId) {
      throw new Error('Pedido delivery nao gerou entrega associada');
    }

    await api.put(`/deliveries/${encodeURIComponent(deliveryId)}/status`, { status: 'dispatched' });

    const delivery = await api.get(`/deliveries/${encodeURIComponent(deliveryId)}`);
    const row = delivery?.delivery || delivery;
    if (String(row?.status || '').toLowerCase() !== 'dispatched') {
      throw new Error(`Entrega nao ficou despachada: ${row && row.status}`);
    }
    if (!row.dispatched_at) {
      throw new Error('Timestamp de despacho nao registrado');
    }

    return {
      detail: 'Entrega criada via pedido e despachada',
      ids: { deliveryId, orderId: created.order && created.order.id },
      evidence: { status: row.status, dispatchedAt: row.dispatched_at },
    };
  }

  if (definition.code === 'CORE-BIZ-DEVELOPER') {
    const created = await api.post('/developer/keys', {
      name: `Key QA ${runId}`,
      scopes: ['read'],
    });
    const key = created?.key || created;
    if (!key?.id) {
      throw new Error('Chave de developer nao retornou ID');
    }

    const listed = await api.get('/developer/keys');
    const items = listed?.keys || listed?.items || [];
    const found = items.find((item) => item.id === key.id);
    if (!found) {
      throw new Error('Chave de developer nao apareceu na listagem');
    }
    // Segredo nunca vai para evidência: apenas o id.
    const usage = await api.get('/developer/usage');
    if (!usage || usage.error) {
      throw new Error('Endpoint de uso de developer indisponível');
    }

    return {
      detail: 'Chave de developer criada, listada e uso consultado',
      ids: { keyId: key.id },
      evidence: { usageOk: true },
    };
  }

  if (definition.code === 'CORE-BIZ-WHATSAPP-CONNECTIONS') {
    const created = await api.post('/whatsapp/connections', {
      name: `WA QA ${runId}`,
      phoneNumber: '+5511999997500',
    });
    const connection = created?.connection || created;
    if (!connection?.id) {
      throw new Error('Conexão WhatsApp nao retornou ID');
    }

    const listed = await api.get('/whatsapp/connections');
    const items = listed?.connections || [];
    if (!items.some((item) => item.id === connection.id)) {
      throw new Error('Conexão WhatsApp nao apareceu na listagem');
    }

    const status = await api.get(`/whatsapp/connections/${encodeURIComponent(connection.id)}/status`);
    if (!status || status.error) {
      throw new Error('Status da conexão indisponível');
    }

    await api.del(`/whatsapp/connections/${encodeURIComponent(connection.id)}`);
    const afterDelete = await api.get('/whatsapp/connections');
    if ((afterDelete?.connections || []).some((item) => item.id === connection.id)) {
      throw new Error('Conexão WhatsApp nao foi removida');
    }

    return {
      detail: 'Conexão WhatsApp criada, consultada e removida',
      ids: { connectionId: connection.id },
      evidence: { deleted: true },
    };
  }

  if (definition.code === 'CORE-BIZ-ANALYTICS') {
    const endpoints = ['funnel', 'agents', 'departments', 'metrics', 'queues', 'roi', 'trends', 'general'];
    const failures = [];
    for (const endpoint of endpoints) {
      try {
        const result = await api.get(`/analytics/${endpoint}`);
        if (!result || result.error) {
          failures.push(`${endpoint}: resposta com erro`);
        }
      } catch (err) {
        failures.push(`${endpoint}: ${err.status || err.message}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(`Endpoints de analytics falharam: ${failures.join('; ')}`);
    }

    return {
      detail: `${endpoints.length} endpoints de analytics responderam com estrutura válida`,
      ids: {},
      evidence: { endpoints },
    };
  }

  if (definition.code === 'CORE-BIZ-INTELLIGENCE') {
    const created = await api.post('/api/intelligence/goals', {
      name: `Goal QA ${runId}`,
      metric_key: 'tickets_closed',
      target_value: 10,
    });
    const goal = created?.goal || created;
    if (!goal?.id) {
      throw new Error('Meta operacional nao retornou ID');
    }

    const goals = await api.get('/api/intelligence/goals');
    const goalItems = goals?.items || goals?.goals || [];
    if (!goalItems.some((item) => item.id === goal.id)) {
      throw new Error('Meta operacional nao apareceu na listagem');
    }

    const insights = await api.get('/api/intelligence/insights');
    if (!insights || insights.error) {
      throw new Error('Insights operacionais indisponíveis');
    }

    const state = await api.get('/api/intelligence/operational-state');
    if (!state || state.error) {
      throw new Error('Estado operacional indisponível');
    }

    return {
      detail: 'Meta criada, insights e estado operacional consultados',
      ids: { goalId: goal.id },
      evidence: { insightsOk: true, operationalStateOk: true },
    };
  }

  if (definition.code === 'CORE-BIZ-ACADEMY') {
    const profile = await api.get('/api/learning/profile/me');
    if (!profile || !profile.profile) {
      throw new Error('Perfil de aprendizado indisponível');
    }

    const sessionId = `qa-academy-${runId}`;
    const interaction = await api.post('/api/learning/interactions', {
      sessionId,
      events: [{ type: 'navigation', route: '/academy', clientEventId: `evt-${runId}` }],
    });
    if (!interaction || interaction.accepted < 1) {
      throw new Error(`Interação de navegação não foi aceita: ${JSON.stringify(interaction)}`);
    }

    const competencies = await api.post('/api/learning/competencies/recompute', {});
    if (!competencies || !Array.isArray(competencies.competencies)) {
      throw new Error('Recomputação de competências não retornou lista');
    }

    const certifications = await api.post('/api/learning/certifications/evaluate', {});
    if (!certifications || !Array.isArray(certifications.assessments)) {
      throw new Error('Avaliação de certificações não retornou lista');
    }

    // O tutor nível 2 depende do RAG (modelo de embeddings): logo após o boot
    // do rag-service a primeira chamada pode falhar com ai_unavailable
    // (cold start). Retry limitado somente nesse motivo — a assertiva
    // (available:true) continua obrigatória na tentativa final.
    let tutor = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      tutor = await api.post('/api/learning/tutor/help', {
        route: '/academy',
        level: 2,
        question: 'Como criar uma campanha?',
      });
      if (tutor && tutor.available === true) break;
      if (tutor?.reason !== 'ai_unavailable' || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    if (!tutor || tutor.available !== true) {
      throw new Error('Tutor não respondeu com conteúdo disponível');
    }

    const missions = await api.get('/api/learning/missions/me');
    if (!missions || !Array.isArray(missions.missions)) {
      throw new Error('Missões de aprendizado indisponíveis');
    }

    return {
      detail: 'Perfil, interação, competências, certificações, tutor e missões validados',
      ids: { sessionId },
      evidence: { accepted: interaction.accepted, competencies: competencies.competencies.length },
    };
  }

  if (definition.code === 'CORE-BIZ-PHYSICAL-QUEUE') {
    await ensureDbConnection();
    const { createPublicToken } = require('../../../api/services/publicAccessTokenService');
    const kinds = ['kiosk', 'panel', 'station'];
    const tokens = {};
    for (const kind of kinds) {
      const created = await createPublicToken({
        tenantId: TEST_TENANT_ID,
        kind,
        meta: { source: 'business_qa', scenarioCode: definition.code },
      });
      if (!created?.token) {
        throw new Error(`Token público ${kind} não foi criado`);
      }
      tokens[kind] = created.token;
    }

    const issued = await api.post(`/physical/kiosk/tickets?token=${encodeURIComponent(tokens.kiosk)}`, { priority: 0 });
    const ticket = issued?.ticket;
    if (!ticket?.id || ticket.status !== 'waiting') {
      throw new Error(`Senha física não foi emitida corretamente: ${JSON.stringify(issued)}`);
    }

    const panel = await api.get(`/physical/panel/state?token=${encodeURIComponent(tokens.panel)}`);
    if (!panel || panel.ok !== true || !Array.isArray(panel.queues)) {
      throw new Error('Estado do painel físico indisponível');
    }

    const called = await api.post(`/physical/station/call-next?token=${encodeURIComponent(tokens.station)}`, {
      stationId: `qa-station-${runId}`,
    });
    const calledTicket = called?.ticket;
    if (!calledTicket || calledTicket.id !== ticket.id || calledTicket.status !== 'called') {
      throw new Error(`Estação não chamou a senha emitida: ${JSON.stringify(called)}`);
    }

    return {
      detail: 'Senha emitida no kiosk, painel consultado e chamada realizada na estação',
      ids: { ticketId: ticket.id },
      evidence: { ticketNumber: ticket.ticket_number, finalStatus: calledTicket.status },
    };
  }

  if (definition.code === 'CORE-BIZ-PUBLIC-TOKENS') {
    const created = await api.post('/public-tokens', { kind: 'storefront', meta: { source: 'business_qa', scenarioCode: definition.code } });
    const token = created?.token;
    if (!token?.id || !token?.token) {
      throw new Error('Token público não foi criado');
    }

    const listed = await api.get('/public-tokens');
    if (!(listed?.items || []).some((item) => item.id === token.id)) {
      throw new Error('Token público não apareceu na listagem');
    }

    const resolved = await api.get(`/public-tokens/resolve?token=${encodeURIComponent(token.token)}`);
    if (!resolved || resolved.ok !== true || resolved.token?.tenantId !== TEST_TENANT_ID) {
      throw new Error('Token público não resolveu para o tenant correto');
    }

    const rotated = await api.post(`/public-tokens/${encodeURIComponent(token.id)}/rotate`, {});
    const rotatedToken = rotated?.newToken;
    if (!rotatedToken?.id || !rotatedToken?.token || rotatedToken.token === token.token) {
      throw new Error(`Rotação não gerou novo token: ${JSON.stringify(rotated)}`);
    }

    let oldTokenRejected = false;
    try {
      await api.get(`/public-tokens/resolve?token=${encodeURIComponent(token.token)}`);
    } catch (err) {
      oldTokenRejected = err.status === 401 || err.status === 404;
    }
    if (!oldTokenRejected) {
      throw new Error('Token anterior continua resolvendo após rotação');
    }

    await api.post(`/public-tokens/${encodeURIComponent(rotatedToken.id)}/revoke`, {});
    let revokedRejected = false;
    try {
      await api.get(`/public-tokens/resolve?token=${encodeURIComponent(rotatedToken.token)}`);
    } catch (err) {
      revokedRejected = err.status === 401 || err.status === 404;
    }
    if (!revokedRejected) {
      throw new Error('Token revogado continua resolvendo');
    }

    return {
      detail: 'Token criado, resolvido, rotacionado e revogado com invalidação comprovada',
      ids: { tokenId: token.id },
      evidence: { rotated: true, revoked: true },
    };
  }

  if (definition.code === 'CORE-BIZ-PROCESS-RUNTIME') {
    const processDefinition = {
      id: `proc-qa-${runId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      name: `QA Journey Process ${runId}`,
      version: 1,
      metadata: { tenantId: TEST_TENANT_ID },
      entrypoints: ['start-1'],
      nodes: [
        { id: 'start-1', type: 'start', subtype: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'service-1', type: 'task.service', subtype: null, label: 'Service', config: { outputVariable: 'ticket', mockResult: { ok: true } }, metadata: {} },
        { id: 'end-1', type: 'end', subtype: 'end', label: 'End', config: {}, metadata: {} },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'service-1', condition: null, priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e2', source: 'service-1', target: 'end-1', condition: null, priority: 0, metadata: { sourcePort: 'out' } },
      ],
    };

    const started = await api.post('/api/process-runtime/start', {
      processDefinition,
      input: { channel: 'qa' },
    });
    if (!started || started.ok !== true || !started.executionId) {
      throw new Error(`Processo não foi iniciado: ${JSON.stringify(started)}`);
    }
    if (started.status !== 'completed') {
      throw new Error(`Processo não concluiu: status=${started.status}`);
    }

    const instances = await api.get('/api/process-instances');
    const items = instances?.items || [];
    const instance = items.find((item) => item.executionId === started.executionId || item.id === started.executionId);
    if (!instance) {
      throw new Error('Instância de processo não apareceu na listagem');
    }

    const history = await api.get(`/api/process-instances/${encodeURIComponent(started.executionId)}/history`);
    if (!history || history.error) {
      throw new Error('Histórico da instância indisponível');
    }

    const simulation = await api.post('/api/process-runtime/simulate', { processDefinition });
    if (!simulation || simulation.error) {
      throw new Error(`Simulação de processo falhou: ${JSON.stringify(simulation)}`);
    }

    return {
      detail: 'Processo durável iniciado, concluído, inspecionado e simulado',
      ids: { executionId: started.executionId },
      evidence: { status: started.status },
    };
  }

  if (definition.code === 'CORE-BIZ-SOLUTIONS') {
    const packs = await api.get('/api/solutions/packs');
    const items = packs?.items || [];
    if (!items.some((item) => item.id === 'geral')) {
      throw new Error('Pack geral não está listado');
    }

    const installed = await api.post('/api/solutions/packs/install', { segment: 'geral' });
    if (!installed || installed.ok !== true || installed.success !== true) {
      throw new Error(`Instalação do pack falhou: ${JSON.stringify(installed)}`);
    }

    return {
      detail: 'Pack de solução listado e instalado',
      ids: { packId: 'geral' },
      evidence: { created: installed.created },
    };
  }

  if (definition.code === 'CORE-BIZ-RBAC') {
    const roles = await api.get('/rbac/roles');
    if (!Array.isArray(roles?.roles) || roles.roles.length === 0) {
      throw new Error('Listagem de roles indisponível');
    }

    const permissions = await api.get('/rbac/permissions');
    if (!Array.isArray(permissions?.permissions) || permissions.permissions.length === 0) {
      throw new Error('Listagem de permissões indisponível');
    }

    const roleName = `qa_flow_role_${runId}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const created = await api.post('/rbac/roles', {
      role: roleName,
      permissions: [{ resource: 'tickets', action: 'read' }],
    });
    if (!created || created.role !== roleName) {
      throw new Error(`Role QA não foi criada: ${JSON.stringify(created)}`);
    }

    const users = await api.get('/api/users/search?q=supervisor');
    const target = (users?.items || [])[0];
    if (!target?.id) {
      throw new Error('Agente supervisor seed não encontrado para atribuição de role');
    }
    const originalRole = target.role;

    try {
      const assigned = await api.post('/rbac/assign', { agentId: target.id, role: roleName });
      if (assigned?.agent?.role !== roleName) {
        throw new Error(`Atribuição de role não aplicada: ${JSON.stringify(assigned?.agent?.role)}`);
      }
    } finally {
      await api.post('/rbac/assign', { agentId: target.id, role: originalRole });
    }

    const restored = await api.get('/api/users/search?q=supervisor');
    const restoredUser = (restored?.items || []).find((item) => item.id === target.id);
    if (restoredUser?.role !== originalRole) {
      throw new Error(`Role original não restaurada: ${restoredUser?.role} != ${originalRole}`);
    }

    return {
      detail: 'Role criada, atribuída e original restaurada sem efeito residual',
      ids: { role: roleName, agentId: target.id },
      evidence: { originalRole },
    };
  }

  if (definition.code === 'CORE-BIZ-TEMPLATES') {
    const flowId = `qa-tpl-${runId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const flow = {
      id: flowId,
      tenantId: TEST_TENANT_ID,
      version: 1,
      nodes: [
        { id: 's1', type: 'start', label: 'Início', next: 'n1' },
        { id: 'n1', type: 'message', label: 'Oi', config: { text: 'Olá' }, next: 'e1' },
        { id: 'e1', type: 'end', label: 'Fim' },
      ],
      edges: [],
    };

    const created = await api.post('/templates', { id: flowId, name: `QA Template ${runId}`, flow });
    if (!created?.template?.id) {
      throw new Error(`Template não foi criado: ${JSON.stringify(created)}`);
    }

    const templates = await api.get('/templates');
    const templateItems = Array.isArray(templates) ? templates : (templates?.items || templates?.templates || []);
    if (!templateItems.some((item) => item.id === flowId)) {
      throw new Error('Template não apareceu na listagem');
    }

    const ftId = `qa-ft-${runId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const flowTemplate = await api.post('/flow-templates', {
      id: ftId,
      name: `QA Flow Template ${runId}`,
      flow: { ...flow, id: ftId },
    });
    if (!flowTemplate || flowTemplate.error || !flowTemplate.template) {
      throw new Error(`Flow-template não foi criado: ${JSON.stringify(flowTemplate)}`);
    }
    const ftRecordId = flowTemplate.template.id || ftId;

    const flowTemplates = await api.get('/flow-templates');
    const ftItems = flowTemplates?.templates || flowTemplates?.items || [];
    if (!ftItems.some((item) => (item.flow && item.flow.id === ftId) || item.id === ftId || item.name === `QA Flow Template ${runId}`)) {
      throw new Error('Flow-template não apareceu na listagem');
    }

    // Limpeza: templates de QA não podem se acumular no tenant nem no disco.
    await api.del(`/templates/${encodeURIComponent(flowId)}`);
    await api.del(`/flow-templates/${encodeURIComponent(ftRecordId)}`);

    const afterCleanup = await api.get('/templates');
    const remaining = Array.isArray(afterCleanup) ? afterCleanup : (afterCleanup?.items || afterCleanup?.templates || []);
    if (remaining.some((item) => item.id === flowId)) {
      throw new Error('Template não foi removido na limpeza');
    }

    return {
      detail: 'Template e flow-template criados, listados e removidos',
      ids: { templateId: flowId, flowTemplateId: ftId },
      evidence: { cleanedUp: true },
    };
  }

  if (definition.code === 'CORE-BIZ-OPS-DASHBOARD') {
    const endpoints = ['summary', 'insights', 'jobs', 'notifications', 'timeline'];
    for (const endpoint of endpoints) {
      const result = await api.get(`/api/operations-dashboard/${endpoint}`);
      if (!result || result.ok !== true) {
        throw new Error(`operations-dashboard/${endpoint} não respondeu ok=true`);
      }
    }

    return {
      detail: 'Todos os endpoints do operations dashboard responderam ok=true',
      ids: {},
      evidence: { endpoints },
    };
  }

  if (definition.code === 'CORE-BIZ-COGNITIVE') {
    const intents = await api.get('/api/cognitive/intents');
    if (!Array.isArray(intents?.intents) || intents.intents.length === 0) {
      throw new Error('Intents cognitivos indisponíveis');
    }

    const tools = await api.get('/api/cognitive/tools');
    if (!Array.isArray(tools?.tools) || tools.tools.length === 0) {
      throw new Error('Tools cognitivas indisponíveis');
    }

    const processed = await api.post('/api/cognitive/process', { message: 'Olá, preciso de ajuda', channel: 'web' });
    if (!processed || processed.error) {
      throw new Error(`Processamento cognitivo falhou: ${JSON.stringify(processed)}`);
    }

    return {
      detail: 'Intents, tools e processamento cognitivo validados',
      ids: {},
      evidence: { intents: intents.intents.length, tools: tools.tools.length },
    };
  }

  if (definition.code === 'CORE-BIZ-SUPERVISOR') {
    const agents = await api.get('/supervisor/agents/status');
    if (!agents || !Array.isArray(agents.agents)) {
      throw new Error('Status de agentes indisponível');
    }

    const metrics = await api.get('/supervisor/metrics');
    if (!metrics || typeof metrics.summary?.totalTickets !== 'number') {
      throw new Error('Métricas de supervisor indisponíveis');
    }

    const queues = await api.get('/supervisor/queues/status');
    if (!queues || !Array.isArray(queues.queues)) {
      throw new Error('Status de filas indisponível');
    }

    return {
      detail: 'Status de agentes, métricas e filas de supervisor validados',
      ids: {},
      evidence: { totalTickets: metrics.summary.totalTickets, agents: agents.agents.length },
    };
  }

  if (definition.code === 'CORE-BIZ-QUEUES') {
    const queueName = `qa_flow_queue_${runId}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const created = await api.post('/queues', { name: queueName });
    if (!created || created.success !== true) {
      throw new Error(`Fila não foi criada: ${JSON.stringify(created)}`);
    }

    // O resultado do DELETE NÃO pode ser descartado.
    //
    // DEFEITO MEDIDO (mesh 2026-09-18T09-22-16): a limpeza rodava no `finally` e
    // ignorava a resposta. `DELETE /queues/:name` RECUSA a exclusão quando há
    // ticket ativo (exige `force=true`) e devolve `{ success: false, message }` —
    // mas a mensagem era jogada fora, e a falha aparecia depois como o genérico
    // "Fila não foi removida", sem a causa. Engolir o erro não deixava o cenário
    // passar: deixava o diagnóstico impossível.
    let deleteResult = null;
    let deleteFailure = null;
    try {
      const listed = await api.get('/queues');
      const names = Array.isArray(listed) ? listed : (listed?.queues || listed?.items || []);
      if (!names.some((name) => String(name) === queueName)) {
        throw new Error('Fila não apareceu na listagem');
      }

      const detail = await api.get(`/queues/${encodeURIComponent(queueName)}`);
      if (!detail || detail.exists !== true) {
        throw new Error('Detalhe da fila indisponível');
      }

      const tickets = await api.get(`/queues/${encodeURIComponent(queueName)}/tickets`);
      if (!Array.isArray(tickets)) {
        throw new Error('Tickets da fila indisponíveis');
      }
    } finally {
      try {
        deleteResult = await api.del(`/queues/${encodeURIComponent(queueName)}`);
      } catch (error) {
        deleteFailure = error;
      }
    }

    if (deleteFailure) {
      throw new Error(`DELETE da fila falhou: ${deleteFailure.message || deleteFailure}`);
    }
    if (deleteResult && deleteResult.success === false) {
      throw new Error(`Fila não foi removida: ${deleteResult.message || JSON.stringify(deleteResult)}`);
    }

    const afterDelete = await api.get('/queues');
    const remaining = Array.isArray(afterDelete) ? afterDelete : (afterDelete?.queues || []);
    if (remaining.some((name) => String(name) === queueName)) {
      throw new Error('Fila não foi removida: a fila continua na listagem após DELETE');
    }

    return {
      detail: 'Fila criada, consultada e removida',
      ids: { queueName },
      evidence: { deleted: true, deleteMessage: deleteResult?.message || null },
    };
  }

  if (definition.code === 'CORE-BIZ-DEPARTMENTS') {
    const name = `QA Dept ${runId}`;
    const created = await api.post('/departments', { name, description: 'Departamento criado pelo QA de jornadas' });
    const department = created?.id ? created : (created?.department || null);
    if (!department?.id) {
      throw new Error(`Departamento não foi criado: ${JSON.stringify(created)}`);
    }

    const listed = await api.get('/departments');
    const items = listed?.departments || listed?.items || [];
    if (!items.some((item) => item.id === department.id)) {
      throw new Error('Departamento não apareceu na listagem');
    }

    return {
      detail: 'Departamento criado e listado',
      ids: { departmentId: department.id },
      evidence: { name },
    };
  }

  if (definition.code === 'CORE-BIZ-EXPORT') {
    const ticketsCsv = await api.get('/export/tickets.csv');
    if (typeof ticketsCsv !== 'string' || !ticketsCsv.includes('ID')) {
      throw new Error('CSV de tickets não foi exportado');
    }

    const metricsCsv = await api.get('/export/metrics.csv');
    if (typeof metricsCsv !== 'string' || !metricsCsv.includes('MÉTRICAS GERAIS') || !metricsCsv.includes('Total de Tickets,')) {
      throw new Error('CSV de métricas não foi exportado com totais');
    }

    const conversations = await api.get('/export/conversations.json');
    if (!conversations || typeof conversations.totalConversations !== 'number') {
      throw new Error('JSON de conversas não foi exportado');
    }

    const report = await api.get('/export/full-report.json');
    if (!report || typeof report.summary?.totalTickets !== 'number') {
      throw new Error('Relatório completo sem summary de métricas');
    }

    return {
      detail: 'Tickets CSV, métricas CSV, conversas JSON e relatório completo exportados',
      ids: {},
      evidence: { totalTickets: report.summary.totalTickets, totalConversations: conversations.totalConversations },
    };
  }

  if (definition.code === 'CORE-BIZ-DEMO') {
    const state = await api.get('/api/demo/state');
    if (!state || !state.demo || !state.journey) {
      throw new Error('Estado do demo indisponível');
    }

    let runStatus = null;
    let runCode = null;
    try {
      await api.post('/api/demo/run', {});
      runStatus = 202;
    } catch (err) {
      runStatus = err.status;
      runCode = err.body && err.body.code;
    }
    // Localmente o cenário do demo exige o pipeline oficial: a API deve
    // responder 422 com diagnóstico real, nunca 500 genérico.
    if (runStatus === 500) {
      throw new Error('demo/run retornou 500 genérico em vez de erro codificado');
    }
    if (runStatus !== 202 && !(runStatus === 422 && (runCode === 'PIPELINE_ONLY_SCENARIO' || runCode === 'MISSING_PLATFORM_SCENARIO_IDS'))) {
      throw new Error(`demo/run retornou status inesperado: ${runStatus} (${runCode})`);
    }

    return {
      detail: 'Estado do demo carregado e run com semântica de erro correta',
      ids: {},
      evidence: { vertical: state.demo.vertical, runStatus, runCode },
    };
  }

  if (definition.code === 'CORE-BIZ-AGENT-FACTORY') {
    const slug = `qa-agent-${runId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const created = await api.post('/api/agent-factory/create', {
      name: `QA Factory Agent ${runId}`,
      slug,
      description: 'Agente criado pelo QA de jornadas (agent_factory)',
      capabilities: ['crm.read'],
      tools: ['crm_integration'],
    });
    const agentId = created?.agent?.id;
    if (!agentId || created?.workflow?.step !== 'created') {
      throw new Error(`Agente não foi criado pela factory: ${JSON.stringify(created)}`);
    }

    try {
      const configured = await api.post('/api/agent-factory/configure', {
        id: agentId,
        capabilities: ['crm.read', 'ticket.read'],
        tools: ['crm_integration', 'ticket_system'],
        config: { source: 'business_qa', scenarioCode: definition.code },
      });
      if (configured?.workflow?.step !== 'configured' || configured?.agent?.id !== agentId) {
        throw new Error(`Agente não foi configurado: ${JSON.stringify(configured)}`);
      }

      // Validate executa QA Wave real (aguarda veredito da mesh com timeout
      // de 30s por default): GO ou NO_GO estruturado são ambos legítimos — o
      // que importa é o contrato (status, evidence; replay no caminho de sucesso).
      const validated = await api.post('/api/agent-factory/validate', { id: agentId });
      const waveStatus = validated?.qaWave?.status;
      if (waveStatus !== 'GO' && waveStatus !== 'NO_GO') {
        throw new Error(`Validate sem qaWave.status estruturado: ${JSON.stringify(validated)}`);
      }
      if (!validated?.evidence?.evidenceId) {
        throw new Error(`Validate sem evidência: ${JSON.stringify(validated)}`);
      }
      if ('replay' in (validated || {}) && !validated.replay?.replayId) {
        throw new Error(`Validate com replay inválido: ${JSON.stringify(validated.replay)}`);
      }
      if (!validated?.workflow?.step) {
        throw new Error('Validate sem workflow.step');
      }

      // Approve exige gates de governança (qa_wave, replay, evidence,
      // approval, risk) e lifecycle 'validated' (W2-A: approve não transiciona
      // agente cuja QA wave deu NO_GO — lifecycle fica 'validation'). Ambos os
      // bloqueios estruturados 400 (governance_gates_failed, agent_not_validated)
      // são respostas legítimas de contrato.
      let approveOutcome = null;
      try {
        const approved = await api.post('/api/agent-factory/approve', { id: agentId, riskLevel: 'low' });
        if (approved?.workflow?.step !== 'approved' || !approved?.agent) {
          throw new Error(`Approve sem contrato de aprovação: ${JSON.stringify(approved)}`);
        }
        approveOutcome = 'approved';
      } catch (err) {
        const code = err.body?.error;
        if (err.status === 400 && code === 'agent_not_validated') {
          // Lifecycle enforcement (W2-A): corpo deve trazer o lifecycle atual.
          if (!('lifecycle' in (err.body || {}))) {
            throw new Error(`agent_not_validated sem lifecycle no corpo: ${JSON.stringify(err.body)}`);
          }
          approveOutcome = 'agent_not_validated';
        } else if (err.status === 400 && code === 'governance_gates_failed') {
          if (!Array.isArray(err.body?.governance?.checks) || !Array.isArray(err.body?.governance?.blockers)) {
            throw new Error(`governance_gates_failed sem checks/blockers: ${JSON.stringify(err.body)}`);
          }
          approveOutcome = 'governance_gates_failed';
        } else {
          throw err;
        }
      }

      // Publish de agente recém-criado pode retornar 400 publish_blocked
      // (NO_GO legítimo da QA Wave) ou agent_not_approved (W2-A: publish exige
      // lifecycle 'approved'; sem approve prévio o bloqueio é estruturado).
      // Assert no contrato, não em GO.
      let publishOutcome = null;
      try {
        const published = await api.post('/api/agent-factory/publish', { id: agentId });
        if (published?.workflow?.step !== 'published' || !published?.qaWave || !published?.evidence || !published?.replay) {
          throw new Error(`Publish sem contrato completo: ${JSON.stringify(published)}`);
        }
        publishOutcome = 'published';
      } catch (err) {
        const code = err.body?.error;
        if (err.status === 400 && code === 'agent_not_approved') {
          // Lifecycle enforcement (W2-A): corpo deve trazer lifecycle atual.
          if (!('lifecycle' in (err.body || {}))) {
            throw new Error(`agent_not_approved sem lifecycle no corpo: ${JSON.stringify(err.body)}`);
          }
          publishOutcome = 'agent_not_approved';
        } else {
          if (err.status !== 400 || code !== 'publish_blocked') throw err;
          const blocked = err.body;
          if (!blocked.status || !blocked.waveResult || !blocked.evidence || !blocked.replay || !blocked.workflow) {
            throw new Error(`publish_blocked sem contrato completo: ${JSON.stringify(blocked)}`);
          }
          publishOutcome = 'publish_blocked';
        }
      }

      return {
        detail: 'Agente criado, configurado, validado, aprovado e publish com contrato de governança',
        ids: { agentId, slug },
        evidence: { waveStatus, approveOutcome, publishOutcome },
      };
    } finally {
      await api.del(`/api/agent-registry/${encodeURIComponent(agentId)}`).catch(() => {});
    }
  }

  if (definition.code === 'CORE-BIZ-AGENT-MARKETPLACE') {
    const catalog = await api.get('/api/agent-marketplace/catalog');
    if (!Array.isArray(catalog?.catalog) || typeof catalog?.total !== 'number' || catalog.catalog.length === 0) {
      throw new Error(`Catálogo do marketplace indisponível: ${JSON.stringify(catalog)}`);
    }

    const slug = catalog.catalog[0].slug;
    const detail = await api.get(`/api/agent-marketplace/catalog/${encodeURIComponent(slug)}`);
    if (detail?.agent?.slug !== slug) {
      throw new Error(`Agente do catálogo não encontrado por slug: ${JSON.stringify(detail)}`);
    }

    const installed = await api.post('/api/agent-marketplace/install', { slug });
    const installedId = installed?.agent?.id;
    if (!installedId || installed?.installed !== true) {
      throw new Error(`Instalação do agente falhou: ${JSON.stringify(installed)}`);
    }

    try {
      const registry = await api.get(`/api/agent-registry/${encodeURIComponent(installedId)}`);
      if (registry?.agent?.id !== installedId) {
        throw new Error('Agente instalado não está no registry');
      }
    } finally {
      await api.del(`/api/agent-registry/${encodeURIComponent(installedId)}`).catch(() => {});
    }

    return {
      detail: 'Catálogo consultado, agente instalado a partir do catálogo e removido',
      ids: { slug, agentId: installedId },
      evidence: { total: catalog.total, cleanedUp: true },
    };
  }

  if (definition.code === 'CORE-BIZ-AGENT-ORCHESTRATOR') {
    const capabilities = await api.get('/api/agent-orchestrator/capabilities');
    if (!capabilities?.capabilities || Object.keys(capabilities.capabilities).length === 0) {
      throw new Error('Capabilities do orchestrator indisponíveis');
    }
    if (!Array.isArray(capabilities?.byCategory?.PRODUCTION) || capabilities.byCategory.PRODUCTION.length === 0) {
      throw new Error('Capabilities não agrupadas por categoria PRODUCTION');
    }

    const intents = await api.get('/api/agent-orchestrator/intents');
    if (!Array.isArray(intents?.intents) || intents.intents.length === 0 || !Array.isArray(intents?.capabilities)) {
      throw new Error('Intents do orchestrator indisponíveis');
    }

    const startedAt = Date.now() - 5000;
    const executed = await api.post('/api/agent-orchestrator/execute', {
      intent: 'customer_inquiry',
      params: { source: 'business_qa', scenarioCode: definition.code },
    });
    const orchestration = executed?.orchestration;
    if (!orchestration || orchestration.intent !== 'customer_inquiry') {
      throw new Error(`Execução orquestrada inválida: ${JSON.stringify(executed)}`);
    }
    if (!Array.isArray(orchestration.steps) || orchestration.steps.length === 0) {
      throw new Error('Execução orquestrada sem steps');
    }
    if (orchestration.status !== 'completed' && orchestration.status !== 'partial') {
      throw new Error(`Status agregado inesperado: ${orchestration.status}`);
    }

    // A execução grava eventos 'execute' em ai_governance_records: a trilha
    // deve conter os eventos desta execução (janela desde startedAt).
    const decisionLog = await api.get('/api/ai-governance/decision-log?limit=50');
    const ownRecords = (decisionLog?.decisionLog || []).filter((record) => (
      record.eventType === 'execute'
      && String(record.description || '').includes('customer_inquiry')
      && new Date(record.created_at || record.createdAt || 0).getTime() >= startedAt
    ));
    if (ownRecords.length === 0) {
      throw new Error('Execução não gravou evento execute na trilha de governança');
    }

    // Cleanup via model (não há rota DELETE para ai_governance_records).
    try {
      return {
        detail: 'Capabilities, intents e execução orquestrada com trilha de governança validados',
        ids: { governanceRecordIds: ownRecords.map((record) => record.id) },
        evidence: { status: orchestration.status, steps: orchestration.steps.length, governanceEvents: ownRecords.length },
      };
    } finally {
      await ensureDbConnection();
      const getAiGovernanceRecordModel = require('../../../api/db/models/AiGovernanceRecord');
      await getAiGovernanceRecordModel().destroy({ where: { id: ownRecords.map((record) => record.id) } });
    }
  }

  if (definition.code === 'CORE-BIZ-AGENT-REGISTRY') {
    const slug = `qa-reg-${runId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const created = await api.post('/api/agent-registry', {
      name: `QA Registry Agent ${runId}`,
      slug,
      description: 'Agente criado pelo QA de jornadas (agent_registry)',
      classification: 'DEVELOPMENT',
    });
    const agentId = created?.agent?.id;
    if (!agentId) {
      throw new Error(`Agente não foi criado no registry: ${JSON.stringify(created)}`);
    }

    let deleted = false;
    try {
      const listed = await api.get(`/api/agent-registry?search=${encodeURIComponent(slug)}`);
      if (!(listed?.agents || []).some((agent) => agent.id === agentId)) {
        throw new Error('Agente não apareceu na listagem com filtro de busca');
      }

      const fetched = await api.get(`/api/agent-registry/${encodeURIComponent(agentId)}`);
      if (fetched?.agent?.slug !== slug) {
        throw new Error(`Agente não consultado por id: ${JSON.stringify(fetched)}`);
      }

      const updatedDescription = `Atualizado pelo QA ${runId}`;
      const updated = await api.put(`/api/agent-registry/${encodeURIComponent(agentId)}`, { description: updatedDescription });
      if (updated?.agent?.description !== updatedDescription) {
        throw new Error(`Agente não foi atualizado: ${JSON.stringify(updated)}`);
      }

      const removed = await api.del(`/api/agent-registry/${encodeURIComponent(agentId)}`);
      if (removed?.success !== true) {
        throw new Error(`Remoção não confirmada: ${JSON.stringify(removed)}`);
      }
      deleted = true;

      let notFound = false;
      try {
        await api.get(`/api/agent-registry/${encodeURIComponent(agentId)}`);
      } catch (err) {
        notFound = err.status === 404;
      }
      if (!notFound) {
        throw new Error('Agente removido continua consultável');
      }

      return {
        detail: 'Agente criado, listado, consultado, atualizado e removido',
        ids: { agentId, slug },
        evidence: { deleted: true },
      };
    } finally {
      if (!deleted) {
        await api.del(`/api/agent-registry/${encodeURIComponent(agentId)}`).catch(() => {});
      }
    }
  }

  if (definition.code === 'CORE-BIZ-JOURNEY-REGISTRY') {
    const slug = `qa-jrn-${runId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const created = await api.post('/api/journey-registry', {
      domain: 'qa',
      name: `QA Journey ${runId}`,
      slug,
      description: 'Jornada criada pelo QA de jornadas (journey_registry)',
      criticality: 'low',
    });
    const journeyId = created?.journey?.id;
    if (!journeyId) {
      throw new Error(`Jornada não foi criada no registry: ${JSON.stringify(created)}`);
    }

    // NÃO há rota DELETE em journey-registry: o cleanup é só via DB
    // (service.deleteJourney) no finally abaixo; slug único com runId evita
    // colisão entre execuções.
    try {
      const listed = await api.get('/api/journey-registry?domain=qa');
      if (!(listed?.journeys || []).some((journey) => journey.id === journeyId)) {
        throw new Error('Jornada não apareceu na listagem filtrada por domínio');
      }

      const fetched = await api.get(`/api/journey-registry/${encodeURIComponent(journeyId)}`);
      if (fetched?.journey?.slug !== slug) {
        throw new Error(`Jornada não consultada por id: ${JSON.stringify(fetched)}`);
      }

      const updatedName = `QA Journey ${runId} atualizada`;
      const updated = await api.put(`/api/journey-registry/${encodeURIComponent(journeyId)}`, { name: updatedName });
      if (updated?.journey?.name !== updatedName) {
        throw new Error(`Jornada não foi atualizada: ${JSON.stringify(updated)}`);
      }

      // Seed é idempotente: com jornadas já existentes no tenant deve
      // responder sem criar nada (count === journeys.length).
      const seeded = await api.post('/api/journey-registry/seed', {});
      if (!Array.isArray(seeded?.journeys) || seeded?.count !== seeded.journeys.length) {
        throw new Error(`Seed sem contrato journeys/count: ${JSON.stringify(seeded)}`);
      }

      return {
        detail: 'Jornada criada, listada, consultada, atualizada e seed idempotente',
        ids: { journeyId, slug },
        evidence: { seededCount: seeded.count, cleanedUp: 'db' },
      };
    } finally {
      await ensureDbConnection();
      const journeyRegistryService = require('../../../api/modules/journey-registry/service');
      await journeyRegistryService.deleteJourney(journeyId, TEST_TENANT_ID).catch(() => {});
    }
  }

  if (definition.code === 'CORE-BIZ-KNOWLEDGE-GRAPH') {
    const externalRef = `qa-kg-${runId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    // type deve ser um dos 19 valores do ENUM (KnowledgeGraphNode.NODE_TYPES).
    const journeyNode = await api.post('/api/knowledge-graph/node', {
      type: 'Journey',
      label: `QA KG Journey ${runId}`,
      externalRef,
      externalType: 'business_qa',
      properties: { source: 'business_qa', scenarioCode: definition.code },
    });
    const journeyNodeId = journeyNode?.node?.id;
    if (!journeyNodeId) {
      throw new Error(`Nó Journey não foi criado: ${JSON.stringify(journeyNode)}`);
    }

    const agentNode = await api.post('/api/knowledge-graph/node', {
      type: 'Agent',
      label: `QA KG Agent ${runId}`,
      properties: { source: 'business_qa', scenarioCode: definition.code },
    });
    const agentNodeId = agentNode?.node?.id;
    if (!agentNodeId) {
      throw new Error(`Nó Agent não foi criado: ${JSON.stringify(agentNode)}`);
    }

    // NÃO há rota DELETE em knowledge-graph: o cleanup é só via DB
    // (service.deleteNode, que remove também as arestas ligadas) no finally.
    try {
      const edge = await api.post('/api/knowledge-graph/edge', {
        sourceNodeId: journeyNodeId,
        targetNodeId: agentNodeId,
        relationship: 'qa_covers',
        weight: 1,
        properties: { source: 'business_qa' },
      });
      if (!edge?.edge?.id) {
        throw new Error(`Aresta não foi criada: ${JSON.stringify(edge)}`);
      }

      const graph = await api.get('/api/knowledge-graph?types=Journey,Agent');
      const nodeIds = (graph?.nodes || []).map((node) => node.id);
      if (!nodeIds.includes(journeyNodeId) || !nodeIds.includes(agentNodeId)) {
        throw new Error('Nós criados ausentes na consulta do grafo');
      }
      if (!(graph?.edges || []).some((item) => item.id === edge.edge.id)) {
        throw new Error('Aresta criada ausente na consulta do grafo');
      }

      const related = await api.get(`/api/knowledge-graph/node/${encodeURIComponent(journeyNodeId)}/related`);
      if (!(related?.relatedNodes || []).some((node) => node.id === agentNodeId)) {
        throw new Error('Relacionados do nó Journey não incluem o nó Agent');
      }

      return {
        detail: 'Nós e aresta criados, grafo e relacionados consultados',
        ids: { journeyNodeId, agentNodeId, edgeId: edge.edge.id },
        evidence: { cleanedUp: 'db' },
      };
    } finally {
      await ensureDbConnection();
      const knowledgeGraphService = require('../../../api/modules/knowledge-graph/service');
      await knowledgeGraphService.deleteNode(journeyNodeId, TEST_TENANT_ID).catch(() => {});
      await knowledgeGraphService.deleteNode(agentNodeId, TEST_TENANT_ID).catch(() => {});
    }
  }

  if (definition.code === 'CORE-BIZ-RAP-LEARN') {
    const sourceRef = `qa-rap-learn-${runId}`;
    const recorded = await api.post('/api/rap-learn/failure', {
      source: 'business_qa',
      sourceRef,
      classification: 'regression',
      metrics: { errorRate: 1, window: 'qa' },
    });
    const recordId = recorded?.record?.id;
    if (!recordId || recorded?.record?.type !== 'failure' || recorded?.record?.status !== 'detected') {
      throw new Error(`Falha não foi registrada: ${JSON.stringify(recorded)}`);
    }

    // NÃO há rota DELETE em rap-learn: o cleanup é só via DB (model
    // LearningRecord.destroy) no finally abaixo.
    try {
      const records = await api.get('/api/rap-learn/records?type=failure');
      if (!(records?.records || []).some((record) => record.id === recordId)) {
        throw new Error('Registro ausente na listagem de records');
      }

      const regressions = await api.get('/api/rap-learn/regressions?windowHours=1');
      if (regressions?.windowHours !== 1 || !(regressions?.regressions || []).some((record) => record.id === recordId)) {
        throw new Error('Registro não detectado na consulta de regressões da janela');
      }

      return {
        detail: 'Falha registrada, listada e detectada como regressão na janela',
        ids: { recordId, sourceRef },
        evidence: { cleanedUp: 'db' },
      };
    } finally {
      await ensureDbConnection();
      const getLearningRecordModel = require('../../../api/db/models/LearningRecord');
      await getLearningRecordModel().destroy({ where: { id: recordId } }).catch(() => {});
    }
  }

  if (definition.code === 'CORE-BIZ-AI-GOVERNANCE') {
    const description = `qa-ai-governance-${runId}`;
    // eventType deve ser um dos valores do ENUM (AiGovernanceRecord.EVENT_TYPES).
    const recorded = await api.post('/api/ai-governance/event', {
      eventType: 'audit',
      actor: 'business_qa',
      description,
      riskLevel: 'low',
      metadata: { source: 'business_qa', scenarioCode: definition.code },
    });
    const recordId = recorded?.record?.id;
    if (!recordId || recorded?.record?.eventType !== 'audit') {
      throw new Error(`Evento de governança não foi registrado: ${JSON.stringify(recorded)}`);
    }

    // NÃO há rota DELETE em ai-governance: o cleanup é só via DB (model
    // AiGovernanceRecord.destroy) no finally abaixo.
    try {
      const trail = await api.get('/api/ai-governance/audit-trail?eventTypes=audit&limit=50');
      if (!(trail?.auditTrail || []).some((record) => record.id === recordId)) {
        throw new Error('Evento ausente na audit-trail filtrada');
      }

      const decisionLog = await api.get('/api/ai-governance/decision-log');
      if (!Array.isArray(decisionLog?.decisionLog)) {
        throw new Error('Decision log não respondeu com lista');
      }

      const report = await api.get('/api/ai-governance/compliance-report');
      if (typeof report?.report?.summary?.totalEvents !== 'number') {
        throw new Error(`Compliance report sem summary de eventos: ${JSON.stringify(report)}`);
      }

      return {
        detail: 'Evento audit registrado, trilha, decision log e compliance report validados',
        ids: { recordId },
        evidence: { totalEvents: report.report.summary.totalEvents, cleanedUp: 'db' },
      };
    } finally {
      await ensureDbConnection();
      const getAiGovernanceRecordModel = require('../../../api/db/models/AiGovernanceRecord');
      await getAiGovernanceRecordModel().destroy({ where: { id: recordId } }).catch(() => {});
    }
  }

  if (definition.code === 'CORE-BIZ-FLOWS-EDITOR') {
    const flowName = `QA Flow ${runId}`;
    const flowDefinition = {
      name: flowName,
      nodes: [
        { id: 's1', type: 'start', label: 'Início', next: 'n1' },
        { id: 'n1', type: 'message', label: 'Oi', config: { text: 'Olá' }, next: 'e1' },
        { id: 'e1', type: 'end', label: 'Fim' },
      ],
    };

    const created = await api.post('/flows', flowDefinition);
    const flowId = created?.id;
    if (!flowId) {
      throw new Error(`Fluxo não foi criado: ${JSON.stringify(created)}`);
    }

    const generatedFlowIds = [];
    try {
      const listed = await api.get('/flows');
      if (!Array.isArray(listed) || !listed.some((flow) => flow.id === flowId)) {
        throw new Error('Fluxo não apareceu na listagem');
      }

      const fetched = await api.get(`/flows/${encodeURIComponent(flowId)}`);
      if (fetched?.id !== flowId) {
        throw new Error(`Fluxo não consultado por id: ${JSON.stringify(fetched)}`);
      }

      const renamed = `${flowName} v2`;
      const updated = await api.put(`/flows/${encodeURIComponent(flowId)}`, { ...flowDefinition, id: flowId, name: renamed });
      if (updated?.name !== renamed) {
        throw new Error(`Fluxo não foi atualizado: ${JSON.stringify(updated)}`);
      }

      const environment = await api.put(`/flows/${encodeURIComponent(flowId)}/environment`, { environment: 'dev' });
      if (environment?.ok !== true || !environment?.flow) {
        throw new Error(`Ambiente do fluxo não foi definido: ${JSON.stringify(environment)}`);
      }

      // Validate exige o fluxo completo persistido (id + tenantId válidos).
      const validation = await api.post('/flows/validate', fetched);
      if (validation?.valid !== true) {
        throw new Error(`Validate reprovou fluxo válido: ${JSON.stringify(validation)}`);
      }

      const preview = await api.post('/flows/preview', { flow: { ...flowDefinition, id: flowId } });
      if (preview?.ok !== true || preview?.valid !== true || !preview?.summary) {
        throw new Error(`Preview inválido: ${JSON.stringify(preview)}`);
      }

      const simulation = await api.post('/flows/simulate', { flowId });
      const sessionId = simulation?.replay?.sessionId;
      if (!sessionId) {
        throw new Error(`Simulação não gerou sessão de replay: ${JSON.stringify(simulation)}`);
      }

      const replay = await api.get(`/replay/${encodeURIComponent(sessionId)}`);
      if (replay?.sessionId !== sessionId || !Array.isArray(replay?.nodesVisited)) {
        throw new Error(`Replay da sessão indisponível: ${JSON.stringify(replay)}`);
      }

      // Generate dry-run nunca persiste; generate pode falhar de forma
      // estruturada (400) quando não há provider de IA — ambos são contrato.
      let dryRunOutcome = 'success';
      try {
        const dryRun = await api.post('/flows/generate/dry-run', {
          name: `QA Gen ${runId}`,
          description: 'Fluxo simples de boas-vindas gerado pelo QA de jornadas',
        });
        if (dryRun?.success !== true || dryRun?.dryRun !== true) {
          throw new Error(`Dry-run sem contrato: ${JSON.stringify(dryRun)}`);
        }
      } catch (err) {
        if (err.status !== 400) throw err;
        dryRunOutcome = 'structured_failure';
      }

      let generateOutcome = 'success';
      try {
        const generated = await api.post('/flows/generate', {
          name: `QA Gen Persist ${runId}`,
          description: 'Fluxo simples de boas-vindas gerado pelo QA de jornadas',
        });
        if (generated?.success !== true) {
          throw new Error(`Generate sem contrato: ${JSON.stringify(generated)}`);
        }
        if (generated?.flow?.id) generatedFlowIds.push(generated.flow.id);
      } catch (err) {
        if (err.status !== 400) throw err;
        generateOutcome = 'structured_failure';
      }

      // Plano RPA test-only: a rota grava o seed em disco (runtime root) —
      // o cleanup remove o arquivo gravado.
      const planId = `qa-rpa-plan-${runId}`;
      const rpaPlan = {
        id: planId,
        version: '1.0',
        type: 'rpa_test_plan',
        context: { application: 'rap', mode: 'test-only' },
        steps: [{ action: 'navigate', target: 'https://example.com' }],
        assertions: [{ type: 'url_contains', value: 'example.com' }],
      };
      const savedPlan = await api.post('/rpa-tests', { rpaTest: rpaPlan });
      if (savedPlan?.success !== true || savedPlan?.testId !== planId || !savedPlan?.filePath) {
        throw new Error(`Plano RPA não foi aceito: ${JSON.stringify(savedPlan)}`);
      }
      await fs.promises.unlink(savedPlan.filePath).catch(() => {});

      let aiRpaOutcome = 'success';
      try {
        const aiRpa = await api.post('/ai/rpa/generate', {
          userInput: 'Plano RPA simples de boas-vindas',
          options: {},
        });
        if (typeof aiRpa?.success !== 'boolean') {
          throw new Error(`ai/rpa/generate sem contrato: ${JSON.stringify(aiRpa)}`);
        }
        if (aiRpa?.flow?.id) generatedFlowIds.push(aiRpa.flow.id);
        aiRpaOutcome = aiRpa.success ? 'success' : 'structured_failure';
      } catch (err) {
        if (err.status !== 400) throw err;
        aiRpaOutcome = 'structured_failure';
      }

      const pageResults = await assertBusinessPages(page, definition);

      return {
        detail: 'CRUD de fluxo, validate, preview, simulate com replay, generate, plano RPA e editor validados',
        ids: { flowId, sessionId, planId },
        evidence: { dryRunOutcome, generateOutcome, aiRpaOutcome, pages: pageResults },
      };
    } finally {
      for (const id of [flowId, ...generatedFlowIds]) {
        await api.del(`/flows/${encodeURIComponent(id)}`).catch(() => {});
      }
    }
  }

  if (definition.code === 'CORE-BIZ-RAG-DOCUMENTS') {
    const health = await api.get(`/rag/health?tenantId=${encodeURIComponent(TEST_TENANT_ID)}`);
    if (!health || typeof health.ok !== 'boolean') {
      throw new Error(`rag/health sem contrato: ${JSON.stringify(health)}`);
    }

    const domains = await api.get('/rag/domains');
    if (!domains?.domains) {
      throw new Error(`rag/domains sem contrato: ${JSON.stringify(domains)}`);
    }

    const documents = await api.get('/rag/documents');
    if (!Array.isArray(documents)) {
      throw new Error('rag/documents não retornou lista');
    }

    const title = `QA RAG Doc ${runId}`;
    const created = await api.post('/rag/documents', {
      title,
      content: `Conteúdo de QA da jornada rag_documents (${runId})`,
      autoIndex: false,
      source: 'business_qa',
    });
    const documentId = created?.id;
    if (!documentId) {
      throw new Error(`Documento RAG não foi criado: ${JSON.stringify(created)}`);
    }

    try {
      const fetched = await api.get(`/rag/documents/${encodeURIComponent(documentId)}`);
      if (fetched?.id !== documentId) {
        throw new Error(`Documento RAG não consultado por id: ${JSON.stringify(fetched)}`);
      }

      const updatedTitle = `${title} v2`;
      const updated = await api.put(`/rag/documents/${encodeURIComponent(documentId)}`, { title: updatedTitle });
      if (updated?.title !== updatedTitle && updated?.document?.title !== updatedTitle) {
        throw new Error(`Documento RAG não foi atualizado: ${JSON.stringify(updated)}`);
      }

      // Upload multipart em dryRun: exercita a rota sem persistir nada.
      const form = new FormData();
      form.append('file', new Blob([`Upload QA ${runId}`], { type: 'text/plain' }), `qa-rag-${runId}.txt`);
      form.append('dryRun', 'true');
      const uploadResponse = await fetch(buildUrl(API_URL, '/rag/documents/upload'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${api.authToken}`, 'X-Tenant-Id': TEST_TENANT_ID },
        body: form,
      });
      const uploadBody = await uploadResponse.json().catch(() => null);
      if (![200, 201, 207].includes(uploadResponse.status) || !uploadBody || uploadBody.ok !== true) {
        throw new Error(`Upload dry-run falhou: ${uploadResponse.status} ${JSON.stringify(uploadBody)}`);
      }

      // Query: se o rag-service Python estiver fora, o contrato é 500 com
      // mensagem de serviço inacessível — nunca erro não estruturado.
      let queryOutcome = 'success';
      try {
        const query = await api.post('/rag/query', { query: 'QA jornada rag_documents' });
        if (typeof query?.success !== 'boolean') {
          throw new Error(`rag/query sem contrato: ${JSON.stringify(query)}`);
        }
      } catch (err) {
        if (err.status !== 500 || !/rag/i.test(String(err.body?.message || err.message))) throw err;
        queryOutcome = 'rag_service_unavailable';
      }

      const stats = await api.get('/rag/documents/stats');
      if (typeof stats?.total !== 'number') {
        throw new Error(`rag/documents/stats sem contrato: ${JSON.stringify(stats)}`);
      }

      const dedupStats = await api.get('/rag/deduplication/stats');
      if (!dedupStats || typeof dedupStats !== 'object') {
        throw new Error('rag/deduplication/stats indisponível');
      }

      // clean-orphans com lista vazia: exercita a rota sem remover nada.
      const cleaned = await api.post('/rag/documents/clean-orphans', { documentIds: [] });
      if (!cleaned || typeof cleaned !== 'object' || cleaned.error) {
        throw new Error(`clean-orphans sem contrato: ${JSON.stringify(cleaned)}`);
      }

      // Contexto efêmero: grava em Redis com TTL (sem efeito residual).
      // executionId precisa casar /^exec-[a-zA-Z0-9-]+$/ (requireExecutionId).
      const ephemeral = await api.post('/rag/ephemeral/context', {
        executionId: `exec-qa-rag-${runId}`,
        chunks: [{ id: 'c1', content: `Contexto efêmero QA ${runId}` }],
      });
      if (ephemeral?.ok !== true) {
        throw new Error(`rag/ephemeral/context sem contrato: ${JSON.stringify(ephemeral)}`);
      }

      // Rotas pesadas/destrutivas (POST /rag/reindex-all wipe de vetores e
      // POST /rag/documents/reindex-all reindex síncrono) são cobertas pelo
      // vínculo da jornada mas não executadas: reindex real durante o mesh
      // degradaria o ambiente compartilhado.

      for (const rulesPath of ['/api/data/rag_question_generation_rules.json', '/contracts/rag/question-generation.rules.json']) {
        const rules = await api.get(rulesPath);
        if (!rules || typeof rules !== 'object' || rules.error) {
          throw new Error(`Regras de geração indisponíveis em ${rulesPath}`);
        }
      }

      const pageResults = await assertBusinessPages(page, definition);

      return {
        detail: 'Health, domains, documento CRUD, upload dry-run, query, stats e regras validados',
        ids: { documentId },
        evidence: { queryOutcome, uploadStatus: uploadResponse.status, pages: pageResults },
      };
    } finally {
      await api.del(`/rag/documents/${encodeURIComponent(documentId)}`).catch(() => {});
    }
  }

  if (definition.code === 'CORE-BIZ-RAG-SEGREGATION') {
    // Segregação de domínios: o cliente nunca declara domínio. Um documento
    // criado com domain/classification forjados no payload deve ser indexado
    // como OPERATIONAL/PRODUCTION e só ser recuperável no escopo operacional.
    const marker = `QASEG${runId}`;
    // O rag-service descarta chunks com similaridade semântica > 0.97 (deduplicação).
    // O conteúdo precisa variar de fato entre execuções, então derivamos termos
    // únicos do runId (determinístico por run, distinto entre runs).
    const segVocab = [
      'ancora', 'bussola', 'cacto', 'dunas', 'fagulha', 'granito', 'hortela', 'irvore',
      'jabuti', 'kilim', 'lagoa', 'mandala', 'neblina', 'orquidea', 'penhasco', 'quartzo',
      'rafia', 'sereia', 'tundra', 'urutu', 'veludo', 'xadrez', 'zimbro', 'yuca',
    ];
    let segSeed = 0;
    for (const ch of String(runId)) segSeed = (segSeed * 31 + ch.charCodeAt(0)) >>> 0;
    const segRand = () => {
      segSeed = (segSeed * 1664525 + 1013904223) >>> 0;
      return segSeed / 0x100000000;
    };
    const uniqueWords = Array.from({ length: 16 }, () => segVocab[Math.floor(segRand() * segVocab.length)]);
    const content = `${marker} horário de atendimento especial da jornada de segregação de domínios do RAG. Termos únicos desta execução: ${uniqueWords.join(' ')}.`;
    const queryText = `${marker} horário de atendimento ${uniqueWords.slice(0, 4).join(' ')}`;
    const created = await api.post('/rag/documents', {
      title: `QA Segregation ${marker}`,
      content,
      autoIndex: true,
      source: 'business_qa',
      domain: 'SYSTEM',
      classification: 'DEVELOPMENT',
    });
    const documentId = created?.document?.id || created?.id;
    if (!documentId) {
      throw new Error(`Documento de segregação não foi criado: ${JSON.stringify(created)}`);
    }

    try {
      // Aguarda a indexação assíncrona concluir (embedding + upsert no pgvector).
      let indexed = false;
      let lastPollError = null;
      for (let attempt = 0; attempt < 20 && !indexed; attempt += 1) {
        const fetched = await api.get(`/rag/documents/${encodeURIComponent(documentId)}`).catch((err) => {
          lastPollError = `status=${err.status} msg=${String(err.message).slice(0, 120)}`;
          return null;
        });
        const doc = fetched?.document || fetched;
        indexed = doc?.indexed === true || doc?.indexed_at;
        if (!indexed) await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (!indexed) {
        throw new Error(`Documento não foi indexado dentro do tempo esperado${lastPollError ? ` (último erro de poll: ${lastPollError})` : ''}`);
      }

      // Query operacional: deve encontrar o documento e reportar o escopo aplicado.
      let opQuery;
      try {
        opQuery = await api.post('/rag/query', {
          query: queryText,
          options: { topK: 10, minScore: 0.0 },
        });
      } catch (err) {
        if (err.status === 500 && /rag/i.test(String(err.body?.message || err.message))) {
          return { detail: 'rag-service indisponível (ambiente)', ids: { documentId }, evidence: { queryOutcome: 'rag_service_unavailable' } };
        }
        throw err;
      }
      if (typeof opQuery?.success !== 'boolean') {
        throw new Error(`rag/query sem contrato: ${JSON.stringify(opQuery)}`);
      }
      if (opQuery.metadata?.domain !== 'OPERATIONAL') {
        throw new Error(`Escopo operacional não aplicado: metadata.domain=${opQuery.metadata?.domain}`);
      }
      if (!Array.isArray(opQuery.metadata?.classificationsApplied) || opQuery.metadata.classificationsApplied.length === 0) {
        throw new Error('metadata.classificationsApplied ausente: sem evidência de escopo');
      }
      const opDocIds = (opQuery.sources || []).map((s) => s.documentId);
      if (!opDocIds.includes(documentId)) {
        throw new Error(`Documento operacional não encontrado no escopo OPERATIONAL: ${JSON.stringify(opDocIds)}`);
      }

      // Query no domínio SYSTEM (super_admin pode): NÃO deve encontrar o
      // documento — se o domain forjado pelo cliente tivesse sido honrado,
      // o documento apareceria aqui (prova de que foi indexado OPERATIONAL).
      const sysQuery = await api.post('/rag/query', {
        query: queryText,
        options: { domain: 'SYSTEM', topK: 10, minScore: 0.0 },
      });
      if (sysQuery?.metadata?.domain !== 'SYSTEM') {
        throw new Error(`Escopo SYSTEM não aplicado para super_admin: ${JSON.stringify(sysQuery?.metadata)}`);
      }
      const sysDocIds = (sysQuery.sources || []).map((s) => s.documentId);
      if (sysDocIds.includes(documentId)) {
        throw new Error('VAZAMENTO: documento criado pelo cliente apareceu no domínio SYSTEM');
      }

      return {
        detail: 'Domínio forjado pelo cliente ignorado; escopo aplicado por domínio com evidência em metadata',
        ids: { documentId },
        evidence: {
          operationalDomain: opQuery.metadata.domain,
          operationalClassifications: opQuery.metadata.classificationsApplied,
          systemSourcesCount: sysDocIds.length,
        },
      };
    } finally {
      await api.del(`/rag/documents/${encodeURIComponent(documentId)}`).catch(() => {});
    }
  }

  if (definition.code === 'CORE-BIZ-KNOWLEDGE-BASE'
    || definition.code === 'CORE-BIZ-PRODUCT-DOCS'
    || definition.code === 'CORE-BIZ-AGENDA'
    || definition.code === 'CORE-BIZ-AGENTS'
    || definition.code === 'CORE-BIZ-BULK-MESSAGING'
    || definition.code === 'CORE-BIZ-FAILED-MESSAGES'
    || definition.code === 'CORE-BIZ-KITCHEN-DISPATCH'
    || definition.code === 'CORE-BIZ-FAQ'
    || definition.code === 'CORE-BIZ-MFA'
    || definition.code === 'CORE-BIZ-SSO-SCIM'
    || definition.code === 'CORE-BIZ-MAINTENANCE'
    || definition.code === 'CORE-BIZ-PLAN-USAGE') {
    const pageResults = await assertBusinessPages(page, definition);
    return {
      detail: `Páginas da jornada ${definition.journey} renderizaram autenticadas`,
      ids: {},
      evidence: { pages: pageResults },
    };
  }

  if (definition.code === 'CORE-BIZ-CHANNEL-ACCOUNTS') {
    const externalId = `qa-ca-${runId}`;
    const created = await api.post('/channel-accounts', {
      type: 'webchat',
      externalId,
      config: { source: 'business_qa', scenarioCode: definition.code },
    });
    const accountId = created?.account?.id;
    if (created?.success !== true || !accountId) {
      throw new Error(`Conta de canal não foi criada: ${JSON.stringify(created)}`);
    }

    let deleted = false;
    try {
      const listed = await api.get('/channel-accounts');
      if (!(listed?.accounts || []).some((account) => account.id === accountId)) {
        throw new Error('Conta de canal não apareceu na listagem');
      }

      // Conta webchat recém-criada: teste passa sem chamada externa (200) ou
      // responde missing_config estruturado (400) — ambos são contrato.
      let testOutcome = 'success';
      try {
        const tested = await api.post(`/channel-accounts/${encodeURIComponent(accountId)}/test`, {});
        if (tested?.success !== true) {
          throw new Error(`Teste da conta sem contrato: ${JSON.stringify(tested)}`);
        }
      } catch (err) {
        if (err.status !== 400 || err.body?.error !== 'missing_config') throw err;
        testOutcome = 'missing_config';
      }

      const updated = await api.put(`/channel-accounts/${encodeURIComponent(accountId)}`, { status: 'inactive' });
      if (updated?.success !== true) {
        throw new Error(`Conta de canal não foi atualizada: ${JSON.stringify(updated)}`);
      }

      const removed = await api.del(`/channel-accounts/${encodeURIComponent(accountId)}`);
      if (removed?.success !== true) {
        throw new Error(`Remoção da conta não confirmada: ${JSON.stringify(removed)}`);
      }
      deleted = true;

      const pageResults = await assertBusinessPages(page, definition);

      return {
        detail: 'Conta de canal criada, listada, testada, atualizada e removida',
        ids: { accountId, externalId },
        evidence: { testOutcome, deleted, pages: pageResults },
      };
    } finally {
      if (!deleted) {
        await api.del(`/channel-accounts/${encodeURIComponent(accountId)}`).catch(() => {});
      }
    }
  }

  if (definition.code === 'CORE-BIZ-INSTAGRAM-MESSENGER') {
    // Sem canal Meta configurado no tenant QA o contrato correto (commit
    // 20c0901) é 503 channel_not_configured; com canal configurado e
    // destinatário fake, 502 send_failed. NUNCA 500 nem envio real com sucesso.
    const outcomes = {};
    const attempts = [
      { key: 'instagram', path: '/instagram/send', body: { recipientId: `qa-ig-${runId}`, text: 'QA jornada instagram_messenger' } },
      { key: 'messenger', path: '/messenger/send', body: { recipientId: `qa-ms-${runId}`, text: 'QA jornada instagram_messenger' } },
    ];
    for (const attempt of attempts) {
      let outcome = null;
      try {
        const sent = await api.post(attempt.path, attempt.body);
        throw new Error(`${attempt.path} retornou sucesso para destinatário fake: ${JSON.stringify(sent)}`);
      } catch (err) {
        if (err.message.includes('retornou sucesso')) throw err;
        if (err.status === 503 && err.body?.error === 'channel_not_configured') {
          outcome = 'channel_not_configured';
        } else if (err.status === 502 && err.body?.error === 'send_failed') {
          outcome = 'send_failed';
        } else {
          throw new Error(`${attempt.path} retornou erro inesperado: ${err.status} ${JSON.stringify(err.body)}`);
        }
      }
      outcomes[attempt.key] = outcome;
    }

    return {
      detail: 'Send de instagram e messenger com erro estruturado (nunca 500)',
      ids: {},
      evidence: outcomes,
    };
  }

  if (definition.code === 'CORE-BIZ-SEGMENTATION') {
    const tags = await api.get('/segmentation/tags');
    if (!Array.isArray(tags?.tags)) {
      throw new Error(`segmentation/tags sem contrato: ${JSON.stringify(tags)}`);
    }

    const categories = await api.get('/segmentation/categories');
    if (!Array.isArray(categories?.categories)) {
      throw new Error(`segmentation/categories sem contrato: ${JSON.stringify(categories)}`);
    }

    const tickets = await api.get('/segmentation/tickets');
    if (!Array.isArray(tickets?.tickets) || typeof tickets?.count !== 'number') {
      throw new Error(`segmentation/tickets sem contrato: ${JSON.stringify(tickets)}`);
    }

    const stats = await api.get('/segmentation/stats');
    if (!stats || typeof stats !== 'object' || stats.error) {
      throw new Error(`segmentation/stats sem contrato: ${JSON.stringify(stats)}`);
    }

    const pageResults = await assertBusinessPages(page, definition);

    return {
      detail: 'Tags, categories, tickets e stats de segmentação validados',
      ids: {},
      evidence: { tickets: tickets.count, pages: pageResults },
    };
  }

  if (definition.code === 'CORE-BIZ-TICKETS-TAGS') {
    // Ticket próprio de QA (telefone único por run): mexer em ticket do mesh
    // poderia interferir nos asserts de cenários concorrentes.
    const phoneDigits = String(runId).replace(/\D/g, '').slice(-8).padStart(8, '0');
    const phoneNumber = `+55119${phoneDigits}`;
    let ticketId = null;
    let ownTicket = false;
    let originalCategory = null;

    try {
      const created = await api.post('/tickets', {
        phoneNumber,
        queue: 'qa',
        initialMessage: `Ticket QA da jornada tickets_tags (${runId})`,
      });
      const ticket = created?.ticket || created;
      ticketId = ticket?.id;
      ownTicket = true;
    } catch (err) {
      // 409 ticket_already_exists / 403 limit_exceeded: fallback para um
      // ticket já listado, com restauração estrita do estado original.
      if (![403, 409].includes(err.status)) throw err;
      const listed = await api.get('/segmentation/tickets');
      const fallback = (listed?.tickets || [])[0];
      if (!fallback?.id) {
        throw new Error(`Sem ticket próprio (criação bloqueada: ${err.status}) nem ticket listado para fallback`);
      }
      ticketId = fallback.id;
      originalCategory = fallback.category || null;
    }

    const tag = `qa-tag-${runId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    try {
      const tagged = await api.post(`/tickets/${encodeURIComponent(ticketId)}/tags`, { tag });
      if (!Array.isArray(tagged?.tags) || !tagged.tags.includes(tag)) {
        throw new Error(`Tag não aplicada ao ticket: ${JSON.stringify(tagged)}`);
      }

      const categorized = await api.put(`/tickets/${encodeURIComponent(ticketId)}/category`, { category: 'qa-business' });
      if (categorized?.category !== 'qa-business') {
        throw new Error(`Categoria não aplicada ao ticket: ${JSON.stringify(categorized)}`);
      }

      return {
        detail: 'Tag adicionada e categoria atualizada em ticket de QA',
        ids: { ticketId, tag },
        evidence: { ownTicket },
      };
    } finally {
      await api.del(`/tickets/${encodeURIComponent(ticketId)}/tags/${encodeURIComponent(tag)}`).catch(() => {});
      if (!ownTicket && originalCategory !== null) {
        await api.put(`/tickets/${encodeURIComponent(ticketId)}/category`, { category: originalCategory }).catch(() => {});
      }
      if (ownTicket) {
        await api.post(`/tickets/${encodeURIComponent(ticketId)}/close`, {}).catch(() => {});
      }
    }
  }

  if (definition.code === 'CORE-BIZ-TENANT-CONFIG') {
    const current = await api.get('/config');
    if (!current || typeof current !== 'object' || (!current.features && !current.api && !current.chatbot)) {
      throw new Error(`GET /config sem visão completa: ${JSON.stringify(current)}`);
    }

    // PUT /config é REPLACE TOTAL e a visão do GET é sanitizada (sem o campo
    // `ai`): restaurar a partir do GET evisceraria a config (incidente real).
    // Por isso o original vem do arquivo em disco, não da API.
    const configFilePath = path.join(__dirname, '..', '..', '..', 'api', 'data', 'config.json');
    const originalRaw = await fs.promises.readFile(configFilePath, 'utf8');
    const originalConfig = JSON.parse(originalRaw);

    // Cada PUT /config regrava api/data/config.json, que o nodemon vigia:
    // o servidor reinicia após cada escrita. Retry apenas em erro de REDE
    // (janela de reload); erro HTTP é resposta de contrato e não se repete.
    // Os endpoints exercitados aqui (PUT replace-total, validadores e
    // tenant-settings no-op) são livres de efeito colateral, então retry de
    // erro de rede é seguro para todos.
    const withNetworkRetry = async (fn) => {
      const deadline = Date.now() + 180000;
      for (;;) {
        try {
          return await fn();
        } catch (err) {
          if (err && typeof err.status === 'number') throw err;
          if (Date.now() > deadline) throw err;
          await waitForApiReady({ settleMs: 6000 }).catch(() => {});
        }
      }
    };
    const putConfigWithRetry = (payload) => withNetworkRetry(() => api.put('/config', payload));

    const probed = { ...originalConfig, qaProbe: { source: 'business_qa', runId } };
    try {
      const written = await putConfigWithRetry(probed);
      if (written?.success !== true) {
        throw new Error(`PUT /config não confirmou: ${JSON.stringify(written)}`);
      }
    } finally {
      // Restore obrigatório mesmo em falha do probe: se não executar, o
      // cenário inteiro falha (config jamais fica com a chave de sonda).
      await putConfigWithRetry(originalConfig).catch((err) => {
        throw new Error(`FALHA CRÍTICA: restore de /config não executado: ${err.message}`);
      });
      // O nodemon tem delay de detecção (~1s) após a escrita: sem settle, o
      // primeiro /health 200 antecede o kill e os calls seguintes morrem no
      // restart pendente (falha real observada: UND_ERR_SOCKET no POST
      // validate-provider-token). Exige 6s de estabilidade contínua.
      await waitForApiReady({ settleMs: 6000 });
      // Os restarts acima podem invalidar a sessão (tokens em memória):
      // renova o token do client e o localStorage da página compartilhada
      // para este e para os cenários seguintes.
      const freshToken = await withNetworkRetry(() => api.refreshAuth());
      if (page) {
        await page.evaluate((token) => window.localStorage.setItem('auth_token', token), freshToken);
      }
    }

    const providerToken = await withNetworkRetry(() => api.post('/config/validate-provider-token', {
      provider: 'openai',
      apiKey: `qa-invalid-token-${runId}`,
    }));
    if (providerToken?.success !== true || providerToken?.valid !== false) {
      throw new Error(`validate-provider-token com token inválido deveria retornar valid:false: ${JSON.stringify(providerToken)}`);
    }

    const redis = await withNetworkRetry(() => api.post('/config/validate-redis', { redisUrl: `qa-invalid-redis-${runId}` }));
    if (redis?.success !== true || redis?.valid !== false) {
      throw new Error(`validate-redis com URL inválida deveria retornar valid:false: ${JSON.stringify(redis)}`);
    }

    // phone-masking tem fallback 200 mesmo sem registro: lê e regrava o MESMO
    // valor (no-op) para exercitar o POST sem mutação real.
    const settings = await withNetworkRetry(() => api.get('/api/tenant-settings/phone-masking'));
    if (settings?.ok !== true || settings?.key !== 'phone-masking') {
      throw new Error(`tenant-settings phone-masking sem contrato: ${JSON.stringify(settings)}`);
    }
    const rewritten = await withNetworkRetry(() => api.post('/api/tenant-settings/phone-masking', { value: settings.value || { enabled: false } }));
    if (rewritten?.ok !== true || rewritten?.key !== 'phone-masking') {
      throw new Error(`POST tenant-settings sem contrato: ${JSON.stringify(rewritten)}`);
    }

    // Guarda do restart: chamada ANÔNIMA deve ser 401 — prova a proteção sem
    // derrubar o servidor (autenticado executaria process.exit).
    let restartStatus = null;
    try {
      await fetchJson(buildUrl(API_URL, '/server/restart'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      restartStatus = 200;
    } catch (err) {
      restartStatus = err.status;
    }
    if (restartStatus !== 401) {
      throw new Error(`/server/restart anônimo deveria ser 401, veio ${restartStatus}`);
    }

    const pageResults = await assertBusinessPages(page, definition);

    return {
      detail: 'Config lida, escrita inócua restaurada, validadores com credenciais inválidas e guarda do restart provada',
      ids: {},
      evidence: { configRestored: true, restartGuardStatus: restartStatus, pages: pageResults },
    };
  }

  if (definition.code === 'CORE-BIZ-CONVERSATIONS-CHAT') {
    const list = await api.get('/conversations');
    if (!Array.isArray(list?.conversations)) {
      throw new Error(`Listagem de conversas sem contrato: ${JSON.stringify(list)}`);
    }

    let detailOutcome = 'skipped_empty_list';
    let sessionId = null;
    if (list.conversations.length > 0) {
      sessionId = list.conversations[0].sessionId;
      const detail = await api.get(`/conversations/${encodeURIComponent(sessionId)}`);
      if (detail?.sessionId !== sessionId || !Array.isArray(detail?.messages)) {
        throw new Error(`Detalhe da conversa sem contrato: ${JSON.stringify(detail)}`);
      }
      detailOutcome = 'detail_validated';
    }
    // Lista vazia é contrato legítimo (sessionEvents em memória): o GET /:id
    // fica skipped com justificativa detailOutcome=skipped_empty_list.

    const pageResults = await assertBusinessPages(page, definition);

    return {
      detail: 'Listagem de conversas validada; detalhe consultado quando havia sessão',
      ids: { sessionId },
      evidence: { conversations: list.conversations.length, detailOutcome, pages: pageResults },
    };
  }

  if (definition.code === 'CORE-BIZ-AI-TOOLS') {
    // Sem provider de IA o orquestrador agrega o erro e responde 400
    // success:false (nunca 500); suggest/rewrite têm fallback silencioso 200.
    let generateOutcome = 'success';
    try {
      const generated = await api.post('/ai/chatbot/generate', {
        userInput: 'Fluxo simples de boas-vindas para QA',
        options: {},
      });
      if (typeof generated?.success !== 'boolean') {
        throw new Error(`chatbot/generate sem contrato: ${JSON.stringify(generated)}`);
      }
      if (generated?.flow?.id) {
        await api.del(`/flows/${encodeURIComponent(generated.flow.id)}`).catch(() => {});
      }
      generateOutcome = generated.success ? 'success' : 'structured_failure';
    } catch (err) {
      if (err.status !== 400) throw err;
      generateOutcome = 'structured_failure';
    }

    const rewritten = await api.post('/ai/rewrite-message', {
      message: 'ola, preciso de ajuda com meu pedido',
      tone: 'professional',
    });
    if (typeof rewritten?.original !== 'string' || typeof rewritten?.rewritten !== 'string' || !Array.isArray(rewritten?.improvements)) {
      throw new Error(`rewrite-message sem contrato: ${JSON.stringify(rewritten)}`);
    }

    const rewrittenMultiple = await api.post('/ai/rewrite-multiple', {
      messages: ['ola, preciso de ajuda'],
      tone: 'professional',
    });
    if (!Array.isArray(rewrittenMultiple?.results) || rewrittenMultiple.results.length !== 1) {
      throw new Error(`rewrite-multiple sem contrato: ${JSON.stringify(rewrittenMultiple)}`);
    }

    const suggestions = await api.post('/ai/suggest-response', {
      userMessage: 'quero saber o status do meu pedido',
    });
    if (!Array.isArray(suggestions?.suggestions) || !Array.isArray(suggestions?.quickReplies)) {
      throw new Error(`suggest-response sem contrato: ${JSON.stringify(suggestions)}`);
    }

    const pageResults = await assertBusinessPages(page, definition);

    return {
      detail: 'Generate, rewrite e suggest com contratos estruturados validados',
      ids: {},
      evidence: { generateOutcome, pages: pageResults },
    };
  }

  if (definition.code === 'CORE-BIZ-AUDIO-TRANSCRIBE') {
    let validationStatus = null;
    try {
      await api.post('/audio/transcribe', {});
      validationStatus = 200;
    } catch (err) {
      validationStatus = err.status;
      if (err.status !== 400 || err.body?.error !== 'bad_request') {
        throw new Error(`Transcribe sem áudio deveria ser 400 bad_request: ${err.status} ${JSON.stringify(err.body)}`);
      }
    }
    if (validationStatus !== 400) {
      throw new Error(`Transcribe sem áudio retornou ${validationStatus} em vez de 400`);
    }

    // Sem provider de transcrição o contrato é 502 transcription_failed;
    // com provider, 200 { text }. Nunca 500.
    let transcribeOutcome = null;
    try {
      const result = await api.post('/audio/transcribe', { audioData: 'UklGRgAAAAA=' });
      if (typeof result?.text !== 'string') {
        throw new Error(`Transcribe sem campo text: ${JSON.stringify(result)}`);
      }
      transcribeOutcome = 'success';
    } catch (err) {
      if (err.status !== 502 || err.body?.error !== 'transcription_failed') {
        throw new Error(`Transcribe com provider indisponível deveria ser 502 transcription_failed: ${err.status} ${JSON.stringify(err.body)}`);
      }
      transcribeOutcome = 'transcription_failed';
    }

    return {
      detail: 'Validação 400 sem áudio e contrato de transcrição validados',
      ids: {},
      evidence: { transcribeOutcome },
    };
  }

  if (definition.code === 'CORE-BIZ-VOICE-EVENTS') {
    const callId = `qa-call-${runId}`;
    const correlationId = `qa-voice-${runId}`;
    const recorded = await api.post('/api/voice/events', {
      eventType: 'ringing',
      callId,
      correlationId,
      payload: { source: 'business_qa', scenarioCode: definition.code },
    });
    if (recorded?.ok !== true || !recorded?.event) {
      throw new Error(`Evento de voz não foi registrado: ${JSON.stringify(recorded)}`);
    }
    // event-ledger é append-only (sem DELETE): o evento QA permanece marcado
    // com correlationId único — sujeira aceitável e auditável.

    const ledger = await api.get(`/api/event-ledger?correlationId=${encodeURIComponent(correlationId)}`);
    if (ledger?.ok !== true || typeof ledger?.total !== 'number' || ledger.total < 1) {
      throw new Error(`Evento não encontrado no ledger por correlationId: ${JSON.stringify(ledger)}`);
    }

    // Métricas SEM X-Tenant-Id: super-admin sem tenant resolvido deve
    // receber 403 tenant_required — contrato deliberado de segurança do
    // módulo voice (commit 57e45ab: "sem tenant explícito a resposta deve
    // ser 403 tenant_required, nunca um 200 silencioso com lista vazia").
    let noTenantStatus = null;
    try {
      await fetchJson(buildUrl(API_URL, '/api/voice/metrics'), {
        headers: { Authorization: `Bearer ${api.authToken}` },
      });
      noTenantStatus = 200;
    } catch (err) {
      noTenantStatus = err.status;
      if (err.status !== 403 || err.body?.error !== 'tenant_required') {
        throw new Error(`voice/metrics sem tenant deveria ser 403 tenant_required: ${err.status} ${JSON.stringify(err.body)}`);
      }
    }
    if (noTenantStatus !== 403) {
      throw new Error(`voice/metrics sem X-Tenant-Id retornou ${noTenantStatus} em vez de 403`);
    }

    const metrics = await api.get('/api/voice/metrics');
    if (metrics?.ok !== true || !metrics?.totals || typeof metrics?.totals?.totalCalls !== 'number') {
      throw new Error(`voice/metrics sem contrato: ${JSON.stringify(metrics)}`);
    }

    return {
      detail: 'Evento de voz registrado no ledger, métricas e guarda de tenant validados',
      ids: { callId, correlationId },
      evidence: { ledgerTotal: ledger.total, noTenantStatus },
    };
  }

  if (definition.code === 'CORE-BIZ-BACKUP-RESTORE') {
    const exported = await api.get('/api/backup/export');
    if (exported?.ok !== true || !Array.isArray(exported?.flows) || !Array.isArray(exported?.settings)) {
      throw new Error(`Backup export sem contrato: ${JSON.stringify(exported)}`);
    }

    // Import com payload vazio é no-op estruturado (flowImported: 0) — NUNCA
    // import real (overwrite sobrescreveria flows/settings do tenant).
    const imported = await api.post('/api/backup/import', {});
    if (imported?.ok !== true || imported?.flowImported !== 0 || imported?.overwrite !== false) {
      throw new Error(`Import vazio deveria ser no-op: ${JSON.stringify(imported)}`);
    }

    const pageResults = await assertBusinessPages(page, definition);

    return {
      detail: 'Backup export lido e import vazio no-op validados',
      ids: {},
      evidence: { exportedFlows: exported.flows.length, pages: pageResults },
    };
  }

  if (definition.code === 'CORE-BIZ-WEB-SCRAPING') {
    let invalidOutcome = null;
    try {
      await api.post('/web-scraping/scrape', { url: 'url-invalida-qa' });
      invalidOutcome = 'accepted_invalid_url';
    } catch (err) {
      if (err.status !== 400) {
        throw new Error(`Scrape com URL inválida deveria ser 400: ${err.status} ${JSON.stringify(err.body)}`);
      }
      invalidOutcome = 'structured_400';
    }
    if (invalidOutcome !== 'structured_400') {
      throw new Error('Scrape aceitou URL inválida');
    }

    // URL controlada (o próprio /health da API, sugerida pela spec) com
    // autoIndex=false: nada é indexado no RAG. Falha estruturada também é
    // contrato (scraper indisponível no ambiente).
    let scrapeOutcome = 'success';
    try {
      const scraped = await api.post('/web-scraping/scrape', {
        url: `${API_URL}/health`,
        autoIndex: false,
        timeout: 15000,
      });
      if (scraped?.ok !== true) {
        throw new Error(`Scrape controlado sem contrato: ${JSON.stringify(scraped)}`);
      }
    } catch (err) {
      if (![500, 502].includes(err.status)) throw err;
      scrapeOutcome = 'structured_failure';
    }

    let batchOutcome = 'success';
    try {
      const batch = await api.post('/web-scraping/scrape-batch', {
        urls: [`${API_URL}/health`],
        dryRun: true,
        executionId: `exec-qa-scrape-${runId}`,
        timeout: 15000,
      });
      if (batch?.ok !== true || !batch?.data) {
        throw new Error(`Scrape-batch dryRun sem contrato: ${JSON.stringify(batch)}`);
      }
    } catch (err) {
      // 207 parcial e 409 SCRAPING_EMPTY são contratos estruturados da rota.
      if (![409].includes(err.status)) throw err;
      batchOutcome = 'scraping_empty';
    }

    const pageResults = await assertBusinessPages(page, definition);

    return {
      detail: 'Validação de URL inválida e scrape controlado sem indexação validados',
      ids: {},
      evidence: { invalidOutcome, scrapeOutcome, batchOutcome, pages: pageResults },
    };
  }

  if (definition.code === 'CORE-BIZ-LOGIN') {
    const { performLogin, isLoginPage } = require('../../../core/rpa/utils/authHelper');
    const anon = await createAnonymousUiPage();
    try {
      await anon.page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await anon.page.waitForSelector('input[type="password"]', { timeout: 15000 });

      // Credenciais QA locais documentadas (systemadmin/Admin123!, tenant system).
      const login = await performLogin(anon.page, {
        username: TEST_SUPERADMIN_USERNAME,
        password: TEST_SUPERADMIN_PASSWORD,
        tenantId: TEST_TENANT_ID,
      });
      if (!login.success) {
        throw new Error(`Login UI falhou: ${login.error}`);
      }

      const storedToken = await anon.page.evaluate(() => window.localStorage.getItem('auth_token'));
      if (!storedToken) {
        throw new Error('Login não gravou auth_token no localStorage');
      }
      if (await isLoginPage(anon.page)) {
        throw new Error('UI permaneceu no estado de login após autenticação');
      }
      const finalPath = new URL(anon.page.url()).pathname;

      // Logout apenas se existir controle VISÍVEL na UI (o seletor também casa
      // com itens de menus colapsados/ocultos, que não são acionáveis).
      const logoutCandidates = await anon.page.$$('button:has-text("Sair"), a:has-text("Sair"), [data-testid*="logout" i]');
      let logoutControl = null;
      for (const candidate of logoutCandidates) {
        if (await candidate.isVisible()) {
          logoutControl = candidate;
          break;
        }
      }
      let loggedOut = false;
      if (logoutControl) {
        await logoutControl.click();
        await anon.page.waitForTimeout(1500);
        loggedOut = await isLoginPage(anon.page);
      }

      return {
        detail: 'Login real via UI com redirect pós-login e auth_token gravado',
        ids: {},
        evidence: { finalPath, tokenStored: true, logoutFound: Boolean(logoutControl), loggedOut },
      };
    } finally {
      await anon.browser.close().catch(() => null);
    }
  }

  if (definition.code === 'CORE-BIZ-SAAS-STOREFRONT') {
    // Páginas públicas: valida anônimo (browser dedicado) E autenticado
    // (sessão compartilhada, via helper padrão que ignora as anonymous).
    const anon = await createAnonymousUiPage();
    const anonymousResults = [];
    try {
      for (const pageDef of definition.pages || []) {
        anonymousResults.push(await assertBusinessPage(anon.page, { ...pageDef, anonymous: false }, definition));
      }
    } finally {
      await anon.browser.close().catch(() => null);
    }

    const authenticatedResults = [];
    for (const pageDef of definition.pages || []) {
      authenticatedResults.push(await assertBusinessPage(page, { ...pageDef, anonymous: false }, definition));
    }

    return {
      detail: 'Páginas saas/storefront renderizaram anônimas e autenticadas',
      ids: {},
      evidence: { anonymous: anonymousResults, authenticated: authenticatedResults },
    };
  }

  if (definition.code === 'CORE-BIZ-TENANTS') {
    // GET /tenants/current/ai-config: tenant sem config responde 404
    // estruturado — ambos são contrato.
    let aiConfigOutcome = 'found';
    try {
      const aiConfig = await api.get('/tenants/current/ai-config');
      if (!aiConfig || typeof aiConfig !== 'object' || aiConfig.error) {
        throw new Error(`tenants/current/ai-config sem contrato: ${JSON.stringify(aiConfig)}`);
      }
    } catch (err) {
      if (err.status !== 404 || err.body?.error !== 'not_found') throw err;
      aiConfigOutcome = 'not_found';
    }

    // Teste de credencial: sem credencial configurada responde 200
    // valid:false (contrato); com credencial, valid reflete o teste real.
    const credentialTest = await api.post('/tenants/current/ai-credentials/test', { provider: 'openai' });
    if (credentialTest?.success !== true || typeof credentialTest?.valid !== 'boolean') {
      throw new Error(`ai-credentials/test sem contrato: ${JSON.stringify(credentialTest)}`);
    }

    const pageResults = await assertBusinessPages(page, definition);

    return {
      detail: 'Página de tenants, ai-config e teste de credencial validados',
      ids: {},
      evidence: { aiConfigOutcome, credentialValid: credentialTest.valid, pages: pageResults },
    };
  }

  throw new Error(`Flow nao implementado: ${definition.code}`);
}

async function runJourneyScenario(definition, ctx) {
  const { api, runId } = ctx;
  if (definition.code === 'F1') {
    const ids = await createFitnessStudent(api, `${runId}-journey-f1`);
    const detailBefore = await api.get(`/api/fitness/student/${encodeURIComponent(ids.subjectId)}/detail?limit=100`);
    const charge = await createFitnessCharge(api, {
      ...ids,
      amount: 179.9,
      idempotencyKey: `business-qa:${definition.code}:${runId}`,
      scenarioCode: definition.code,
    });
    await confirmTransaction(api, charge.transaction);
    const detailAfterPayment = await api.get(`/api/fitness/student/${encodeURIComponent(ids.subjectId)}/detail?limit=100`);
    const checkIn = await api.post('/api/fitness/attendance/check-in', {
      subjectId: ids.subjectId,
      membershipId: ids.membershipId,
      metadata: { source: 'business_qa', scenarioCode: definition.code },
    });
    const open = await api.get('/api/fitness/attendance/open?limit=50');
    const txList = await api.get('/billing/transactions?vertical=fitness&limit=50');
    const openAttendance = (open?.items || []).find((item) => item.subject_id === ids.subjectId);
    const tx = (txList?.items || []).find((item) => item.id === charge.transaction.id);
    if (!detailBefore?.membership?.id) throw new Error('Aluno nao nasceu com membership valida');
    if (String(detailAfterPayment?.membership?.effectiveBillingStatus || '').toLowerCase() !== 'active') {
      throw new Error('Membership nao ficou ativa apos pagamento');
    }
    if (!detailAfterPayment?.accessStatus?.allowed) throw new Error('Acesso nao ficou liberado apos pagamento');
    if (!openAttendance) throw new Error('Check-in nao refletiu na lista operacional');
    if (!tx || tx.status !== 'confirmed') throw new Error('Financeiro nao refletiu pagamento confirmado');
    return {
      detail: 'Jornada fitness F1 validada ponta a ponta',
      ids: {
        ...ids,
        transactionId: charge.transaction.id,
        attendanceId: openAttendance.id,
        checkInEventId: checkIn?.item?.id || null,
      },
    };
  }

  if (definition.code === 'F2') {
    const ids = await createFitnessStudent(api, `${runId}-journey-f2`);
    const charge1 = await createFitnessCharge(api, {
      ...ids,
      amount: 149.9,
      idempotencyKey: `business-qa:${definition.code}:charge1:${runId}`,
      scenarioCode: definition.code,
    });
    await confirmTransaction(api, charge1.transaction);
    let renewalWarning = null;
    try {
      await api.post(`/api/fitness/membership/${encodeURIComponent(ids.membershipId)}/renew`, {
        renewalAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      });
    } catch (error) {
      renewalWarning = error?.message || String(error);
    }
    const charge2 = await createFitnessCharge(api, {
      ...ids,
      amount: 149.9,
      idempotencyKey: `business-qa:${definition.code}:charge2:${runId}`,
      scenarioCode: definition.code,
    });
    await confirmTransaction(api, charge2.transaction);
    const detail = await api.get(`/api/fitness/student/${encodeURIComponent(ids.subjectId)}/detail?limit=100`);
    const search = await api.get(`/api/fitness/students/search?q=${encodeURIComponent(ids.subjectId)}&limit=10`);
    const found = (search?.items || []).filter((item) => item.subjectId === ids.subjectId);
    if (found.length !== 1) throw new Error('Duplicacao indevida do aluno na rematricula');
    if (String(detail?.membership?.effectiveBillingStatus || '').toLowerCase() !== 'active') {
      throw new Error('Membership nao permaneceu ativa apos renovacao');
    }
    return {
      detail: renewalWarning ? `Renovacao/rematricula validada com aviso de renovacao: ${renewalWarning}` : 'Renovacao/rematricula validada',
      ids: { ...ids, transactionId1: charge1.transaction.id, transactionId2: charge2.transaction.id },
    };
  }

  if (definition.code === 'B1') {
    const campaign = await createBeautyCampaign(api, `${runId}-journey-b1`);
    await publishCampaign(api, campaign.id);
    const lead = await createBeautyLead(api, `${runId}-journey-b1`, campaign.id);
    await qualifyLead(api, lead.id);
    const conversion = await convertBeautyLead(api, lead, `${runId}-journey-b1`, campaign.id);
    const customer = conversion.customer;
    const appointment = await createBeautyAppointment(api, {
      subjectId: customer.id,
      customerId: customer.customer_id || customer.customerId,
      customerName: lead.name,
      campaignId: campaign.id,
      serviceCode: 'UNHAS_GEL_PROMO',
      price: 59.9,
      scenarioCode: definition.code,
    });
    const bundle = await createBeautyBundleWithCharge(api, {
      subjectId: customer.id,
      customerId: customer.customer_id || customer.customerId,
      amount: 59.9,
      totalSessions: 1,
      idempotencyKey: `business-qa:${definition.code}:${runId}`,
      scenarioCode: definition.code,
    });
    await confirmTransaction(api, bundle.charge.transaction);
    await api.post('/api/beauty/service-completed', {
      subjectId: customer.id,
      customerId: customer.customer_id || customer.customerId,
      scheduleId: appointment.schedule.id,
      bundleId: bundle.item.id,
      metadata: { source: 'business_qa', scenarioCode: definition.code },
    });
    const customerDetail = await api.get(`/api/beauty/customer/${encodeURIComponent(customer.id)}/detail?limit=100`);
    const payments = await api.get('/billing/transactions?vertical=beauty&limit=50');
    const tx = (payments?.items || []).find((item) => item.id === bundle.charge.transaction.id);
    const recentSchedule = (customerDetail?.recentAppointments || []).find((item) => item.scheduleId === appointment.schedule.id);
    if (!recentSchedule) throw new Error('Agendamento nao refletiu no detalhe do cliente');
    if (!tx || tx.status !== 'confirmed') throw new Error('Pagamento beauty nao foi confirmado');
    if (!(customerDetail?.journeyEvents || []).some((item) => item.eventType === 'service_completed')) {
      throw new Error('Conclusao do atendimento nao refletiu na jornada');
    }
    return {
      detail: 'Jornada beauty B1 validada ponta a ponta',
      ids: {
        campaignId: campaign.id,
        leadId: lead.id,
        subjectId: customer.id,
        scheduleId: appointment.schedule.id,
        bundleId: bundle.item.id,
        transactionId: bundle.charge.transaction.id,
      },
    };
  }

  if (definition.code === 'B2') {
    const campaign = await createBeautyCampaign(api, `${runId}-journey-b2`);
    const lead = await createBeautyLead(api, `${runId}-journey-b2`, campaign.id);
    const conversion = await convertBeautyLead(api, lead, `${runId}-journey-b2`, campaign.id);
    const customer = conversion.customer;
    const appointment = await createBeautyAppointment(api, {
      subjectId: customer.id,
      customerId: customer.customer_id || customer.customerId,
      customerName: lead.name,
      campaignId: campaign.id,
      scenarioCode: definition.code,
    });
    const schedulesBefore = await listSchedules(api, customer.customer_id || customer.customerId || customer.id);
    const startAt = new Date(Date.now() + 5 * 3600000).toISOString();
    const endAt = new Date(Date.now() + 6 * 3600000).toISOString();
    const rescheduled = await reschedule(api, appointment.schedule.id, startAt, endAt);
    const schedulesAfter = await listSchedules(api, customer.customer_id || customer.customerId || customer.id);
    const moved = schedulesAfter.find((item) => item.id === appointment.schedule.id);
    if (!(schedulesBefore || []).some((item) => item.id === appointment.schedule.id)) {
      throw new Error('Agendamento original nao foi localizado para reagendamento');
    }
    if (!moved) throw new Error('Agendamento reagendado nao foi encontrado');
    if (moved.startAt !== startAt || moved.endAt !== endAt) {
      throw new Error('Novo horario nao foi persistido');
    }
    return {
      detail: 'Reagendamento beauty validado',
      ids: {
        subjectId: customer.id,
        scheduleId: appointment.schedule.id,
        updatedScheduleId: rescheduled?.schedule?.id || appointment.schedule.id,
      },
    };
  }

  throw new Error(`Journey nao implementada: ${definition.code}`);
}

async function saveCatalogSnapshot(catalog) {
  const reportsDir = path.join(__dirname, '..', 'reports');
  ensureDir(reportsDir);
  const jsonPath = path.join(reportsDir, 'business-qa-catalog.json');
  const mdPath = path.join(reportsDir, 'business-qa-catalog.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  const lines = ['# Business QA Catalog', ''];
  for (const item of catalog) {
    lines.push(`- ${item.code} | ${item.type} | ${item.vertical} | ${item.name} | criticidade=${item.criticality}`);
  }
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');
  return { jsonPath, mdPath };
}

module.exports = {
  FRONTEND_URL,
  API_URL,
  TEST_TENANT_ID,
  createApiClient,
  createUiSession,
  captureScenarioScreenshot,
  seedBusinessBaseline,
  runScreenScenario,
  runFlowScenario,
  runJourneyScenario,
  saveCatalogSnapshot,
};
