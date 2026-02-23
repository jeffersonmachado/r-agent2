#!/usr/bin/env node
'use strict';

/**
 * Smoke do CRM Operacional Integrado (L-06)
 *
 * Valida:
 * - autenticação admin
 * - upsert de pipeline/account/contact/lead/opportunity
 * - mudança de estágio da oportunidade
 * - log de atividade
 * - timeline unificada com eventos
 */

const fs = require('fs');
const path = require('path');

function apiBaseUrl() {
  return String(process.env.TEST_BASE_URL || process.env.TEST_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

function evidencePath() {
  return String(process.env.CRM_SMOKE_EVIDENCE_PATH || 'qa/l06-crm-operational-evidence.json');
}

function writeEvidence(payload) {
  const out = evidencePath();
  const abs = path.resolve(process.cwd(), out);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return out;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function reqJson(url, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const timeoutMs = Math.max(3000, Number(process.env.L06_HTTP_TIMEOUT_MS || 20000));
  const retries = Math.max(1, Number(process.env.L06_HTTP_RETRIES || 2));
  let lastErr = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
        body: body == null ? undefined : JSON.stringify(body),
      });
      const txt = await res.text().catch(() => '');
      let payload = {};
      try {
        payload = txt ? JSON.parse(txt) : {};
      } catch (_) {
        payload = { raw: txt };
      }
      clearTimeout(timeout);
      return { ok: res.ok, status: res.status, payload };
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }

  throw lastErr || new Error('request_failed');
}

async function loginAdmin(baseUrl) {
  const username = String(process.env.TEST_ADMIN_USERNAME || process.env.TEST_USERNAME || 'admin');
  const candidates = [
    process.env.TEST_ADMIN_PASSWORD,
    process.env.TEST_USER_PASSWORD,
    'Admin123!',
    'admin123',
  ].filter(Boolean);

  for (const password of candidates) {
    const login = await reqJson(`${baseUrl}/auth/login`, {
      method: 'POST',
      body: { username, password: String(password) },
    });
    if (login.ok && login.payload?.token) {
      return { token: login.payload.token, username, passwordUsed: String(password) };
    }
  }

  throw new Error('admin_login_failed');
}

async function main() {
  const baseUrl = apiBaseUrl();
  const auth = await loginAdmin(baseUrl);
  const token = auth.token;
  const ts = Date.now();

  const evidence = {
    smoke: 'L-06',
    generatedAt: new Date().toISOString(),
    ok: false,
    auth: {
      mode: 'admin',
      username: auth.username,
      passwordHint: auth.passwordUsed === 'Admin123!' ? 'bootstrap_default' : 'custom_env',
    },
    entities: {
      pipelineId: null,
      accountId: null,
      contactId: null,
      leadId: null,
      opportunityId: null,
      activityId: null,
    },
    transitions: {
      movedToStage: null,
    },
    checks: {
      timelineStatus: null,
      timelineItems: 0,
      listAccountsStatus: null,
      listPipelinesStatus: null,
      listOpportunitiesStatus: null,
    },
  };

  const pipelineRes = await reqJson(`${baseUrl}/api/crm/pipelines`, {
    method: 'POST',
    token,
    body: {
      name: `Pipeline CRM Smoke ${ts}`,
      isDefault: true,
      stages: [
        { id: 'qualificacao', name: 'Qualificação' },
        { id: 'proposta', name: 'Proposta' },
        { id: 'fechamento', name: 'Fechamento' },
      ],
    },
  });
  expect(pipelineRes.ok && pipelineRes.payload?.pipeline?.id, `crm_pipeline_upsert_failed:${pipelineRes.status}`);
  const pipelineId = pipelineRes.payload.pipeline.id;
  evidence.entities.pipelineId = pipelineId;

  const accountRes = await reqJson(`${baseUrl}/api/crm/accounts`, {
    method: 'POST',
    token,
    body: {
      name: `Conta CRM Smoke ${ts}`,
      status: 'active',
    },
  });
  expect(accountRes.ok && accountRes.payload?.account?.id, `crm_account_upsert_failed:${accountRes.status}`);
  const accountId = accountRes.payload.account.id;
  evidence.entities.accountId = accountId;

  const contactRes = await reqJson(`${baseUrl}/api/crm/contacts`, {
    method: 'POST',
    token,
    body: {
      name: `Contato CRM Smoke ${ts}`,
      accountId,
      email: `crm-smoke-${ts}@example.com`,
      phone: '+5511999990000',
    },
  });
  expect(contactRes.ok && contactRes.payload?.contact?.id, `crm_contact_upsert_failed:${contactRes.status}`);
  const contactId = contactRes.payload.contact.id;
  evidence.entities.contactId = contactId;

  const leadRes = await reqJson(`${baseUrl}/api/crm/leads`, {
    method: 'POST',
    token,
    body: {
      accountId,
      contactId,
      source: 'smoke',
      status: 'new',
      score: 50,
    },
  });
  expect(leadRes.ok && leadRes.payload?.lead?.id, `crm_lead_upsert_failed:${leadRes.status}`);
  const leadId = leadRes.payload.lead.id;
  evidence.entities.leadId = leadId;

  const oppRes = await reqJson(`${baseUrl}/api/crm/opportunities`, {
    method: 'POST',
    token,
    body: {
      pipelineId,
      stageId: 'qualificacao',
      title: `Oportunidade CRM Smoke ${ts}`,
      accountId,
      contactId,
      leadId,
      valueCents: 123000,
      currency: 'BRL',
    },
  });
  expect(oppRes.ok && oppRes.payload?.opportunity?.id, `crm_opportunity_upsert_failed:${oppRes.status}`);
  const opportunityId = oppRes.payload.opportunity.id;
  evidence.entities.opportunityId = opportunityId;

  const moveRes = await reqJson(`${baseUrl}/api/crm/opportunities/${encodeURIComponent(opportunityId)}/move`, {
    method: 'POST',
    token,
    body: { toStageId: 'proposta' },
  });
  expect(moveRes.ok && moveRes.payload?.opportunity?.stage_id === 'proposta', `crm_opportunity_move_failed:${moveRes.status}`);
  evidence.transitions.movedToStage = moveRes.payload.opportunity.stage_id;

  const activityRes = await reqJson(`${baseUrl}/api/crm/activities`, {
    method: 'POST',
    token,
    body: {
      type: 'follow_up',
      status: 'open',
      subjectType: 'crm_opportunity',
      subjectId: opportunityId,
      opportunityId,
      payload: { note: 'L06 smoke activity' },
    },
  });
  expect(activityRes.ok && activityRes.payload?.activity?.id, `crm_activity_log_failed:${activityRes.status}`);
  evidence.entities.activityId = activityRes.payload.activity.id;

  const timelineRes = await reqJson(`${baseUrl}/api/crm/timeline?subjectType=crm_opportunity&subjectId=${encodeURIComponent(opportunityId)}&limit=20`, {
    method: 'GET',
    token,
  });
  evidence.checks.timelineStatus = timelineRes.status;
  evidence.checks.timelineItems = Array.isArray(timelineRes.payload?.items) ? timelineRes.payload.items.length : 0;
  expect(timelineRes.ok, `crm_timeline_failed:${timelineRes.status}`);
  expect(evidence.checks.timelineItems >= 3, 'crm_timeline_items_insufficient');

  const listAccounts = await reqJson(`${baseUrl}/api/crm/accounts?limit=5`, { token });
  evidence.checks.listAccountsStatus = listAccounts.status;
  expect(listAccounts.ok, `crm_list_accounts_failed:${listAccounts.status}`);

  const listPipelines = await reqJson(`${baseUrl}/api/crm/pipelines`, { token });
  evidence.checks.listPipelinesStatus = listPipelines.status;
  expect(listPipelines.ok, `crm_list_pipelines_failed:${listPipelines.status}`);

  const listOpps = await reqJson(`${baseUrl}/api/crm/opportunities?limit=5`, { token });
  evidence.checks.listOpportunitiesStatus = listOpps.status;
  expect(listOpps.ok, `crm_list_opportunities_failed:${listOpps.status}`);

  // Add gate-level metrics
  evidence.opportunityId = opportunityId;
  evidence.opportunitiesCount = 1; // We created one opportunity in this smoke test
  evidence.stagesMovedCount = 1; // We moved the opportunity once
  evidence.timelineItemsCount = evidence.checks.timelineItems;

  evidence.ok = true;
  const out = writeEvidence(evidence);
  console.log(`[crm-smoke] OK opportunityId=${opportunityId} timelineItems=${evidence.checks.timelineItems} evidence=${out}`);
}

if (require.main === module) {
  main().catch((err) => {
    try {
      const out = writeEvidence({
        smoke: 'L-06',
        generatedAt: new Date().toISOString(),
        ok: false,
        error: err?.message || String(err),
      });
      console.error(`[crm-smoke] evidence=${out}`);
    } catch (_) {}
    console.error('[crm-smoke] FAIL', err?.message || err);
    process.exit(1);
  });
}

module.exports = { main };
