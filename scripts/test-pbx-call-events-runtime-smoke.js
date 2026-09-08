#!/usr/bin/env node
'use strict';

/**
 * Smoke L-04: PBX call events (cdr scanner) -> event trigger -> flow runtime.
 *
 * Estratégia determinística no stack de teste:
 * - cria flow com metadata.eventTriggers para CallEnded (source=pbx.cdr)
 * - injeta 1 linha em pbx_cdr via container API (DB do compose de teste)
 * - aguarda scanner/dispatcher executarem
 * - valida execução em /api/executions (correlationId=uniqueid)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getOrCreateRpaToken } = require('../core/rpa/utils/rpaTokenManager');
const { runtimeAwarePath, resolveWorkspacePath } = require('../tools/system/lib/runtime-paths');

const ROOT = path.join(__dirname, '..');

function apiBaseUrl() {
  return String(process.env.TEST_BASE_URL || process.env.TEST_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

// Tenant default do smoke: STRICT_TENANT_MODE exige X-Tenant-Id explícito
// para super_admin; definido após o login e aplicado a todas as chamadas.
let smokeTenantId = null;

async function reqJson(url, { method = 'GET', token = null, body = null, tenantId = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  // STRICT_TENANT_MODE: super_admin precisa declarar o tenant explicitamente
  const effectiveTenantId = tenantId || smokeTenantId;
  if (effectiveTenantId) headers['X-Tenant-Id'] = String(effectiveTenantId);
  const retries = Math.max(1, Number(process.env.L04_HTTP_RETRIES || 3));
  const timeoutMs = Math.max(3000, Number(process.env.L04_HTTP_TIMEOUT_MS || 20000));
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
        // eslint-disable-next-line no-await-in-loop
        await sleep(250 * attempt);
        continue;
      }
    }
  }
  throw lastErr || new Error('request_failed');
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function syntheticCdrCalldate() {
  // Data levemente futura para garantir que a linha seja vista após o cursor atual
  // sem depender do volume completo de CDRs históricos do ambiente.
  return new Date(Date.now() + 60000);
}

function insertMode() {
  return String(process.env.PBX_CALL_EVENTS_RUNTIME_INSERT_MODE || 'compose_exec').toLowerCase();
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function assertDirectModeDbIntent() {
  if (insertMode() !== 'direct') return;
  const hasExplicitTestDb = Boolean(String(process.env.TEST_DATABASE_URL || '').trim());
  const allowFallback = isTruthy(process.env.PBX_CALL_EVENTS_RUNTIME_ALLOW_DB_FALLBACK);
  if (hasExplicitTestDb || allowFallback) return;

  throw new Error(
    'direct_mode_requires_explicit_db_intent:set_TEST_DATABASE_URL_or_PBX_CALL_EVENTS_RUNTIME_ALLOW_DB_FALLBACK=1',
  );
}

function extractJsonObjects(text) {
  const src = String(text || '');
  const out = [];
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] !== '{') continue;
    let inString = false;
    let escaped = false;
    let depth = 0;
    for (let j = i; j < src.length; j += 1) {
      const ch = src[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = src.slice(i, j + 1);
          try {
            out.push(JSON.parse(candidate));
          } catch (_) {
            // ignora trechos que não são JSON válido.
          }
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

function evidencePath() {
  return resolveWorkspacePath(
    ROOT,
    runtimeAwarePath(ROOT, 'qa/l04-pbx-call-events-runtime-evidence.json', 'PBX_CALL_EVENTS_RUNTIME_EVIDENCE_PATH'),
  );
}

function writeEvidence(payload) {
  const out = evidencePath();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return out;
}

async function login(baseUrl) {
  const username = String(
    process.env.TEST_SUPERADMIN_USERNAME
    || process.env.TEST_USERNAME
    || process.env.TEST_ADMIN_USERNAME
    || process.env.TEST_USER_USERNAME
    || 'systemadmin'
  );
  const password = String(
    process.env.TEST_SUPERADMIN_PASSWORD
    || process.env.TEST_PASSWORD
    || process.env.TEST_ADMIN_PASSWORD
    || process.env.TEST_USER_PASSWORD
    || 'Admin123!'
  );
  const adminLogin = await reqJson(`${baseUrl}/auth/login`, {
    method: 'POST',
    body: { username, password },
  });
  if (adminLogin.ok && adminLogin.payload?.token) {
    const adminTenantId = String(adminLogin.payload?.agent?.tenantId || process.env.TEST_TENANT_ID || 'system');
    const explicitTenant = String(process.env.TEST_PBX_TENANT_ID || process.env.TEST_TENANT_ID || '').trim();
    let operationalTenantId = explicitTenant && explicitTenant.toLowerCase() !== 'system' ? explicitTenant : adminTenantId;

    if (!explicitTenant || explicitTenant.toLowerCase() === 'system') {
      const tenants = await reqJson(`${baseUrl}/super-admin/tenants`, {
        method: 'GET',
        token: adminLogin.payload.token,
      });
      if (tenants.ok && Array.isArray(tenants.payload?.tenants)) {
        const candidate = tenants.payload.tenants.find((tenant) => {
          const id = String(tenant?.id || '').trim();
          return id && id.toLowerCase() !== 'system';
        });
        if (candidate?.id) {
          operationalTenantId = String(candidate.id);
        }
      }
    }

    if (operationalTenantId && operationalTenantId !== adminTenantId) {
      const rpaToken = getOrCreateRpaToken();
      const scopedRpaLogin = await reqJson(`${baseUrl}/auth/rpa/login`, {
        method: 'POST',
        body: { token: rpaToken, tenantId: operationalTenantId },
      });
      if (scopedRpaLogin.ok && scopedRpaLogin.payload?.token) {
        return {
          token: scopedRpaLogin.payload.token,
          tenantId: scopedRpaLogin.payload?.agent?.tenantId || operationalTenantId,
          mode: 'rpa_scoped',
        };
      }
    }

    return {
      token: adminLogin.payload.token,
      tenantId: adminTenantId,
      mode: 'admin',
    };
  }

  const fallbackTenantId = String(process.env.TEST_PBX_TENANT_ID || process.env.TEST_TENANT_ID || 'system').trim() || 'system';
  const rpaToken = getOrCreateRpaToken();
  const rpaLogin = await reqJson(`${baseUrl}/auth/rpa/login`, {
    method: 'POST',
    body: { token: rpaToken, tenantId: fallbackTenantId },
  });
  expect(rpaLogin.ok && rpaLogin.payload?.token, `login_failed:admin=${adminLogin.status}:rpa=${rpaLogin.status}`);
  return {
    token: rpaLogin.payload.token,
    tenantId: rpaLogin.payload?.agent?.tenantId || fallbackTenantId,
    mode: 'rpa',
  };
}

function buildEventTriggerFlow(flowId, tenantId, uniqueid) {
  return {
    id: flowId,
    tenantId,
    name: `PBX CallEvents Runtime Smoke ${uniqueid}`,
    description: 'Smoke L-04',
    nodes: [
      { id: 'start-1', type: 'start', position: { x: 80, y: 100 }, next: 'set-1' },
      {
        id: 'set-1',
        type: 'set_variable',
        position: { x: 260, y: 100 },
        next: 'end-1',
        config: {
          assignments: {
            l04_marker: uniqueid,
            l04_source: 'pbx.cdr',
            l04_trigger: 'CallEnded',
          },
        },
      },
      { id: 'end-1', type: 'end', position: { x: 460, y: 100 } },
    ],
    connections: [
      { from: 'start-1', to: 'set-1' },
      { from: 'set-1', to: 'end-1' },
    ],
    metadata: {
      environment: 'dev',
      createdBy: 'system-smoke',
      eventTriggers: [
        {
          type: 'CallEnded',
          source: 'pbx.cdr',
          subjectType: 'pbx_call',
          subjectId: uniqueid,
        },
      ],
    },
  };
}

async function upsertFlow(baseUrl, token, flow) {
  const create = await reqJson(`${baseUrl}/flows`, {
    method: 'POST',
    token,
    body: flow,
    tenantId: flow.tenantId,
  });
  if (create.ok) return create.payload?.id || flow.id;
  if (create.status !== 409) throw new Error(`flow_create_failed:${create.status}`);

  const update = await reqJson(`${baseUrl}/flows/${encodeURIComponent(flow.id)}`, {
    method: 'PUT',
    token,
    body: flow,
    tenantId: flow.tenantId,
  });
  if (!update.ok) throw new Error(`flow_update_failed:${update.status}`);
  return update.payload?.id || flow.id;
}

async function ensureFlowPersistedForDirectRuntime(flow) {
  if (insertMode() !== 'direct') return;

  // Em modo direct, o runtime lê flows direto do PostgreSQL local.
  // A API pode responder antes de o persistFlowBestEffort tornar o flow visível
  // no banco, então garantimos explicitamente a persistência usada pelo runtime.
  // eslint-disable-next-line global-require
  const { connect, getSequelize, close } = require('../api/db/sequelize');

  try {
    await connect();
    const sq = getSequelize();
    // eslint-disable-next-line global-require
    const { Flow } = require('../api/db/models');
    const FlowModel = Flow();
    const now = new Date();

    const existing = await FlowModel.findByPk(flow.id);
    const payload = {
      id: flow.id,
      tenant_key: flow.tenantId,
      name: flow.name || null,
      data: flow,
      updated_at: now,
    };

    if (existing) {
      await existing.update(payload);
    } else {
      await FlowModel.create({ ...payload, created_at: now });
    }

    const deadline = Date.now() + Math.max(3000, Number(process.env.L04_FLOW_PERSIST_TIMEOUT_MS || 15000));

    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const [rows] = await sq.query(
        'SELECT id, tenant_key, data FROM flows WHERE id = :id LIMIT 1',
        { replacements: { id: flow.id } },
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      const triggers = row?.data?.metadata?.eventTriggers;
      if (row && Array.isArray(triggers) && triggers.length > 0) {
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(200);
    }

    throw new Error(`flow_persistence_timeout:${flow.id}`);
  } finally {
    await close().catch(() => {});
  }
}

async function insertSyntheticCdr({ tenantId, uniqueid, cdrId }) {
  const mode = insertMode();
  const calldate = syntheticCdrCalldate();
  if (mode === 'direct') {
    // Execução dentro do container API: acesso direto ao Sequelize local.
    // eslint-disable-next-line global-require
    const { connect, getSequelize, close } = require('../api/db/sequelize');
    return await (async () => {
      await connect();
      const sq = getSequelize();
      await sq.query(
        "INSERT INTO pbx_cdr (id, tenant_key, uniqueid, calldate, src, dst, disposition, duration, billsec, accountcode, userfield, extra, created_at, updated_at) VALUES (:id, :tenant, :uniqueid, :calldate, :src, :dst, :disp, :dur, :bill, :accountcode, :userfield, '{}'::jsonb, NOW(), NOW()) ON CONFLICT (id) DO NOTHING",
        {
          replacements: {
            id: cdrId,
            tenant: tenantId,
            uniqueid,
            calldate,
            src: '1000',
            dst: '2000',
            disp: 'ANSWERED',
            dur: 12,
            bill: 9,
            accountcode: tenantId,
            userfield: 'smoke_l04',
          },
        },
      );
      await close();
    })();
  }

  const js = `
const { connect, getSequelize, close } = require('./api/db/sequelize');
(async () => {
  await connect();
  const sq = getSequelize();
  await sq.query(
    "INSERT INTO pbx_cdr (id, tenant_key, uniqueid, calldate, src, dst, disposition, duration, billsec, accountcode, userfield, extra, created_at, updated_at) VALUES (:id, :tenant, :uniqueid, :calldate, :src, :dst, :disp, :dur, :bill, :accountcode, :userfield, '{}'::jsonb, NOW(), NOW()) ON CONFLICT (id) DO NOTHING",
    {
      replacements: {
        id: process.argv[1],
        tenant: process.argv[2],
        uniqueid: process.argv[3],
        calldate: process.argv[4],
        src: '1000',
        dst: '2000',
        disp: 'ANSWERED',
        dur: 12,
        bill: 9,
        accountcode: process.argv[2],
        userfield: 'smoke_l04',
      },
    }
  );
  await close();
  process.stdout.write('ok');
})().catch(async (e) => {
  try { await close(); } catch (_) {}
  console.error(e);
  process.exit(1);
});
`.trim();

  const out = spawnSync(
    'docker',
    ['compose', '-f', 'docker-compose.test.yml', 'exec', '-T', 'api', 'node', '-e', js, cdrId, tenantId, uniqueid, calldate.toISOString()],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  if (out.status !== 0) {
    throw new Error(`synthetic_cdr_insert_failed:${out.status}:${(out.stderr || '').trim()}`);
  }
}

async function runPbxEventPipeline({ tenantId, uniqueid, flow }) {
  const mode = insertMode();
  if (mode === 'direct') {
    // eslint-disable-next-line global-require
    const { connect, getSequelize, close } = require('../api/db/sequelize');
    // eslint-disable-next-line global-require
    const { scanPbxCdrAndEmitEvents } = require('../api/services/pbx/pbxCallEventsService');
    // eslint-disable-next-line global-require
    const { executeFlowForEvent } = require('../api/services/flowEventTriggerService');
    await connect();
    const sq = getSequelize();
    const consumer = `pbx_cdr_l04_${Date.now()}`;
    let scan = null;
    let evIds = [];

    for (let attempt = 0; attempt < 20; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      scan = await scanPbxCdrAndEmitEvents({ consumer, batchSize: 1000 });
      // eslint-disable-next-line no-await-in-loop
      const [events] = await sq.query(
        "SELECT id FROM event_ledger WHERE source = 'pbx.cdr' AND correlation_id = :cid ORDER BY received_at ASC",
        { replacements: { cid: uniqueid } },
      );
      evIds = (Array.isArray(events) ? events : []).map((r) => String(r.id || '')).filter(Boolean);
      if (evIds.length > 0) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(250);
    }

    expect(evIds.length > 0, 'pbx_events_not_emitted');


    const exec = await executeFlowForEvent({
      tenantId,
      flow,
      event: {
        id: evIds[0],
        type: 'CallEnded',
        source: 'pbx.cdr',
        correlationId: uniqueid,
        subject: { type: 'pbx_call', id: uniqueid },
        actor: { type: 'system', id: 'pbx_cdr_scanner' },
        payload: { uniqueid, cdrId: `cdr-${uniqueid}` },
      },
    });
    expect(exec && exec.ok, 'event_trigger_execution_failed');
    await close();
    return { scan, eventIds: evIds, execution: exec };
  }

  const marker = '__L04_PIPELINE_JSON__';
  const js = `
const { connect, getSequelize, close } = require('./api/db/sequelize');
const { scanPbxCdrAndEmitEvents } = require('./api/services/pbx/pbxCallEventsService');
const { dispatchOne } = require('./api/services/eventLedgerTriggerDispatcher');
(async () => {
  await connect();
  const sq = getSequelize();
  const tenant = process.argv[1];
  const cid = process.argv[2];
  const pbxConsumer = 'pbx_cdr_l04_' + Date.now();
  let scan = null;
  let evIds = [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    scan = await scanPbxCdrAndEmitEvents({ consumer: pbxConsumer, batchSize: 1000 });
    const [events] = await sq.query(
      "SELECT id FROM event_ledger WHERE source = 'pbx.cdr' AND correlation_id = :cid ORDER BY received_at ASC",
      { replacements: { cid } }
    );
    evIds = (Array.isArray(events) ? events : []).map((r) => String(r.id || '')).filter(Boolean);
    if (evIds.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    for (const eventId of evIds) {
      // eslint-disable-next-line no-await-in-loop
      await dispatchOne({ tenantId: tenant, consumer: 'pbx_call_events_l04_' + Date.now(), eventId, dispatchTargets: ['flows'] });
    }
    const [execRows] = await sq.query(
      "SELECT id, status, flow_id FROM flow_executions WHERE correlation_id = :cid ORDER BY started_at DESC LIMIT 5",
      { replacements: { cid } }
    );
    const executions = Array.isArray(execRows) ? execRows : [];
    const relevantExec = executions.find((r) => String(r?.flow_id || '').includes('flow-pbx-call-events-runtime-smoke-')) || executions[0] || null;
    if (relevantExec) {
      process.stdout.write('${marker}' + JSON.stringify({ scan, eventIds: evIds, execution: relevantExec }));
      await close();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  process.stdout.write('${marker}' + JSON.stringify({ scan, eventIds: evIds, execution: null }));
  await close();
})().catch(async (e) => {
  try { await close(); } catch (_) {}
  console.error(e);
  process.exit(1);
});
`.trim();
  const out = spawnSync(
    'docker',
    ['compose', '-f', 'docker-compose.test.yml', 'exec', '-T', 'api', 'node', '-e', js, tenantId, uniqueid],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  if (out.status !== 0) {
    throw new Error(`pipeline_exec_failed:${out.status}:${(out.stderr || '').trim()}`);
  }
  const txt = String(out.stdout || '').trim();
  const stderrTxt = String(out.stderr || '').trim();
  try {
    const idx = txt.lastIndexOf(marker);
    if (idx >= 0) {
      const payload = txt.slice(idx + marker.length).trim();
      const parsed = extractJsonObjects(payload).find((obj) => Array.isArray(obj?.eventIds));
      if (parsed) return parsed;
    }
    const fallback = extractJsonObjects(txt).find((obj) => Array.isArray(obj?.eventIds));
    if (fallback) return fallback;
    throw new Error('payload_not_found');
  } catch (_) {
    throw new Error(
      `pipeline_output_parse_failed:stdout=${txt.slice(0, 280)}:stderr=${stderrTxt.slice(0, 180)}`,
    );
  }
}

function parseStartedAtMs(execution) {
  const raw = execution?.started_at || execution?.startedAt || null;
  if (!raw) return 0;
  const t = new Date(String(raw)).getTime();
  return Number.isFinite(t) ? t : 0;
}

function findExecutionCandidate(items, flowId, minStartedAtMs) {
  const list = Array.isArray(items) ? items : [];
  const filtered = list
    .filter((it) => String(it?.flow_id || it?.flowId || '') === flowId)
    .filter((it) => parseStartedAtMs(it) >= Math.max(0, Number(minStartedAtMs || 0) - 15000));
  if (!filtered.length) return null;
  filtered.sort((a, b) => parseStartedAtMs(b) - parseStartedAtMs(a));
  return filtered[0];
}

async function waitExecution({ baseUrl, token, tenantId, correlationId, flowId, minStartedAtMs = 0 }) {
  if (insertMode() === 'direct') {
    // Em modo direct, o runtime escreve no banco de teste local; validar via HTTP
    // pode olhar para outro runtime/banco. A leitura precisa usar o ledger real.
    // eslint-disable-next-line global-require
    const { connect, getSequelize, close } = require('../api/db/sequelize');

    try {
      await connect();
      const sq = getSequelize();
      const startedAt = Date.now();
      let lastSeen = null;

      for (let i = 0; i < 120; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const [rows] = await sq.query(
          `SELECT id, flow_id, status, started_at, finished_at
             FROM flow_executions
            WHERE tenant_key = :tenant
              AND correlation_id = :correlationId
              AND flow_id = :flowId
            ORDER BY started_at DESC
            LIMIT 5`,
          {
            replacements: {
              tenant: tenantId,
              correlationId,
              flowId,
            },
          },
        );
        const item = findExecutionCandidate(Array.isArray(rows) ? rows : [], flowId, minStartedAtMs);
        if (item) {
          const execId = String(item.id || '');
          // eslint-disable-next-line no-await-in-loop
          const [nodes] = await sq.query(
            `SELECT id, node_id, status, step_index, created_at
               FROM node_executions
              WHERE tenant_key = :tenant
                AND execution_id = :executionId
              ORDER BY step_index ASC, created_at ASC`,
            {
              replacements: {
                tenant: tenantId,
                executionId: execId,
              },
            },
          );
          const nodeItems = Array.isArray(nodes) ? nodes : [];
          const status = String(item?.status || '').toLowerCase();
          lastSeen = {
            executionId: execId,
            status,
            nodesCount: nodeItems.length,
          };
          if ((status === 'done' || status === 'failed') && nodeItems.length > 0) {
            return {
              found: true,
              latencyMs: Date.now() - startedAt,
              execution: item,
              nodes: nodeItems,
              lastSeen,
            };
          }
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(1000);
      }

      return { found: false, latencyMs: Date.now() - startedAt, execution: null, nodes: [], lastSeen };
    } finally {
      await close().catch(() => {});
    }
  }

  const startedAt = Date.now();
  let lastSeen = null;
  for (let i = 0; i < 120; i += 1) {
    const execListByCorrelation = await reqJson(
      `${baseUrl}/api/executions?correlationId=${encodeURIComponent(correlationId)}&limit=20`,
      { method: 'GET', token, tenantId },
    );
    expect(
      execListByCorrelation.ok && Array.isArray(execListByCorrelation.payload?.items),
      `executions_list_failed:${execListByCorrelation.status}`,
    );
    let item = findExecutionCandidate(execListByCorrelation.payload.items, flowId, minStartedAtMs);
    if (!item) {
      const execListFallback = await reqJson(
        `${baseUrl}/api/executions?limit=200`,
        { method: 'GET', token, tenantId },
      );
      expect(
        execListFallback.ok && Array.isArray(execListFallback.payload?.items),
        `executions_list_fallback_failed:${execListFallback.status}`,
      );
      item = findExecutionCandidate(execListFallback.payload.items, flowId, minStartedAtMs);
    }
    if (item) {
      const execId = String(item.id || '');
      const details = await reqJson(`${baseUrl}/api/executions/${encodeURIComponent(execId)}`, {
        method: 'GET',
        token,
        tenantId,
      });
      expect(details.ok && details.payload?.ok === true, `execution_detail_failed:${details.status}`);
      const execution = details.payload?.execution || item;
      const nodes = Array.isArray(details.payload?.nodes) ? details.payload.nodes : [];
      const status = String(execution?.status || '').toLowerCase();
      lastSeen = {
        executionId: String(execution?.id || execId),
        status,
        nodesCount: nodes.length,
      };
      if ((status === 'done' || status === 'failed') && nodes.length > 0) {
        return {
          found: true,
          latencyMs: Date.now() - startedAt,
          execution,
          nodes,
          lastSeen,
        };
      }
    }
    await sleep(1000);
  }
  return { found: false, latencyMs: Date.now() - startedAt, execution: null, nodes: [], lastSeen };
}

async function main() {
  assertDirectModeDbIntent();
  const baseUrl = apiBaseUrl();
  const auth = await login(baseUrl);
  smokeTenantId = auth.tenantId || null;
  const ts = Date.now();
  const uniqueid = `l04-${ts}`;
  const cdrId = `cdr-${uniqueid}`;
  const flowId = `flow-pbx-call-events-runtime-smoke-${ts}`;

  const flow = buildEventTriggerFlow(flowId, auth.tenantId, uniqueid);
  await upsertFlow(baseUrl, auth.token, flow);
  await ensureFlowPersistedForDirectRuntime(flow);
  await insertSyntheticCdr({ tenantId: auth.tenantId, uniqueid, cdrId });

  const pipeline = await runPbxEventPipeline({
    tenantId: auth.tenantId,
    uniqueid,
    flow,
  });
  expect(Array.isArray(pipeline.eventIds) && pipeline.eventIds.length > 0, 'pbx_events_not_emitted');
  if (pipeline.queue && typeof pipeline.queue === 'object') {
    expect(Number(pipeline.queue.jobsDone || 0) >= pipeline.eventIds.length, `dispatch_jobs_not_done:${JSON.stringify(pipeline.queue)}`);
    expect(Number(pipeline.queue.jobsDead || 0) === 0, `dispatch_jobs_dead:${JSON.stringify(pipeline.queue)}`);
  }

  const waited = await waitExecution({
    baseUrl,
    token: auth.token,
    tenantId: auth.tenantId,
    correlationId: uniqueid,
    flowId,
    minStartedAtMs: ts,
  });
  expect(waited.found, `event_trigger_execution_not_found:${JSON.stringify(waited.lastSeen || {})}`);
  expect(waited.nodes.length > 0, `execution_nodes_missing:${JSON.stringify(waited.lastSeen || {})}`);

  const metrics = await reqJson(`${baseUrl}/api/ops/event-ledger/metrics?windowMinutes=30`, {
    method: 'GET',
    token: auth.token,
    tenantId: auth.tenantId,
  });
  const hasMetrics = metrics.ok && metrics.payload?.ok === true;

  const evidence = {
    smoke: 'L-04',
    generatedAt: new Date().toISOString(),
    ok: true,
    authMode: auth.mode,
    tenantId: auth.tenantId,
    cdr: {
      id: cdrId,
      uniqueid,
      source: 'synthetic_insert',
    },
    trigger: {
      type: 'CallEnded',
      source: 'pbx.cdr',
    },
    pipeline: {
      scan: pipeline.scan || null,
      eventIds: pipeline.eventIds,
      queue: pipeline.queue || null,
    },
    flow: {
      flowId,
      executionId: String(waited.execution?.id || ''),
      status: String(waited.execution?.status || ''),
      latencyMs: waited.latencyMs,
      nodesCount: waited.nodes.length,
    },
    dispatch: {
      metricsAvailable: hasMetrics,
      doneRecent: Number(metrics.payload?.dispatch?.summary?.doneRecent || 0),
      deadRecent: Number(metrics.payload?.dispatch?.summary?.deadRecent || 0),
      flowTriggerFailuresRecent: Number(metrics.payload?.dispatch?.summary?.flowTriggerFailuresRecent || 0),
    },
  };
  const evPath = writeEvidence(evidence);
  // eslint-disable-next-line no-console
  console.log(
    `[pbx-call-events-runtime-smoke] OK auth=${auth.mode} flowId=${flowId} executionId=${evidence.flow.executionId} latencyMs=${evidence.flow.latencyMs} evidence=${evPath}`,
  );
}

if (require.main === module) {
  main().then(() => {
    // CLI smoke: encerra explicitamente após o sucesso — módulos do runtime
    // (pollers/intervalos internos) podem manter o event loop vivo e travar
    // o meshRunner, que aguarda o 'close' do processo filho.
    process.exit(0);
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[pbx-call-events-runtime-smoke] FAIL', err?.message || err);
    process.exit(1);
  });
}

module.exports = { main };
