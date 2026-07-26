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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
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
  const authToken = await loginApi();

  async function request(method, pathname, payload = null, extraHeaders = {}) {
    return fetchJson(buildUrl(API_URL, pathname), {
      method,
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Tenant-Id': TEST_TENANT_ID,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
  }

  return {
    authToken,
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

async function runFlowScenario(definition, ctx) {
  const { api, runId } = ctx;
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
      detail: 'Node publicado e visivel no marketplace do tenant',
      ids: { nodeId },
      evidence: { catalogBefore: initialTotal, catalogAfter: finalTotal },
    };
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
    const orderService = require('../../../api/services/orderService');
    const created = await orderService.createOrder({
      tenantId: TEST_TENANT_ID,
      source: 'business_qa',
      customerName: `Cliente QA Food ${runId}`,
      customerPhone: '+5511999997000',
      items: [{ name: 'Prato QA Lifecycle', qty: 1, price: 32.9 }],
      totalAmount: 32.9,
      context: { idempotencyKey: `business-qa:${definition.code}:${runId}` },
    });
    const orderId = created?.id;
    if (!orderId) {
      throw new Error('Pedido food nao retornou ID');
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
      detail: 'Pedido percorreu o ciclo completo, transicao invalida rejeitada e incidente idempotente',
      ids: { orderId, ticketId },
      evidence: { finalStatus: 'delivered', invalidTransitionRejected: true },
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
