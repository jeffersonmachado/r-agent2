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

function apiBaseUrl() {
  return String(process.env.TEST_BASE_URL || process.env.TEST_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

async function reqJson(url, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
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

function insertMode() {
  return String(process.env.PBX_CALL_EVENTS_RUNTIME_INSERT_MODE || 'compose_exec').toLowerCase();
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
  return String(process.env.PBX_CALL_EVENTS_RUNTIME_EVIDENCE_PATH || 'qa/l04-pbx-call-events-runtime-evidence.json');
}

function writeEvidence(payload) {
  const out = evidencePath();
  const abs = path.resolve(process.cwd(), out);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return out;
}

async function login(baseUrl) {
  const username = String(process.env.TEST_ADMIN_USERNAME || process.env.TEST_USERNAME || 'admin');
  const password = String(process.env.TEST_ADMIN_PASSWORD || process.env.TEST_USER_PASSWORD || 'admin123');
  const adminLogin = await reqJson(`${baseUrl}/auth/login`, {
    method: 'POST',
    body: { username, password },
  });
  if (adminLogin.ok && adminLogin.payload?.token) {
    return {
      token: adminLogin.payload.token,
      tenantId: adminLogin.payload?.agent?.tenantId || process.env.TEST_TENANT_ID || 'system',
      mode: 'admin',
    };
  }

  const rpaToken = getOrCreateRpaToken();
  const rpaLogin = await reqJson(`${baseUrl}/auth/rpa/login`, {
    method: 'POST',
    body: { token: rpaToken, tenantId: process.env.TEST_TENANT_ID || 'system' },
  });
  expect(rpaLogin.ok && rpaLogin.payload?.token, `login_failed:admin=${adminLogin.status}:rpa=${rpaLogin.status}`);
  return {
    token: rpaLogin.payload.token,
    tenantId: rpaLogin.payload?.agent?.tenantId || process.env.TEST_TENANT_ID || 'system',
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
  });
  if (create.ok) return create.payload?.id || flow.id;
  if (create.status !== 409) throw new Error(`flow_create_failed:${create.status}`);

  const update = await reqJson(`${baseUrl}/flows/${encodeURIComponent(flow.id)}`, {
    method: 'PUT',
    token,
    body: flow,
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
  if (mode === 'direct') {
    // Execução dentro do container API: acesso direto ao Sequelize local.
    // eslint-disable-next-line global-require
    const { connect, getSequelize, close } = require('../api/db/sequelize');
    return await (async () => {
      await connect();
      const sq = getSequelize();
      await sq.query(
        "INSERT INTO pbx_cdr (id, tenant_key, uniqueid, calldate, src, dst, disposition, duration, billsec, accountcode, userfield, extra, created_at, updated_at) VALUES (:id, :tenant, :uniqueid, NOW(), :src, :dst, :disp, :dur, :bill, :accountcode, :userfield, '{}'::jsonb, NOW(), NOW()) ON CONFLICT (id) DO NOTHING",
        {
          replacements: {
            id: cdrId,
            tenant: tenantId,
            uniqueid,
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
    "INSERT INTO pbx_cdr (id, tenant_key, uniqueid, calldate, src, dst, disposition, duration, billsec, accountcode, userfield, extra, created_at, updated_at) VALUES (:id, :tenant, :uniqueid, NOW(), :src, :dst, :disp, :dur, :bill, :accountcode, :userfield, '{}'::jsonb, NOW(), NOW()) ON CONFLICT (id) DO NOTHING",
    {
      replacements: {
        id: process.argv[1],
        tenant: process.argv[2],
        uniqueid: process.argv[3],
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
    ['compose', '-f', 'docker-compose.test.yml', 'exec', '-T', 'api', 'node', '-e', js, cdrId, tenantId, uniqueid],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  if (out.status !== 0) {
    throw new Error(`synthetic_cdr_insert_failed:${out.status}:${(out.stderr || '').trim()}`);
  }
}

async function runPbxEventPipeline({ tenantId, uniqueid }) {
  const mode = insertMode();
  if (mode === 'direct') {
    // eslint-disable-next-line global-require
    const { connect, getSequelize, close } = require('../api/db/sequelize');
    // eslint-disable-next-line global-require
    const { scanPbxCdrAndEmitEvents } = require('../api/services/pbx/pbxCallEventsService');
    // eslint-disable-next-line global-require
    const { dispatchOne } = require('../api/services/eventLedgerTriggerDispatcher');
    await connect();
    const sq = getSequelize();
    const scan = await scanPbxCdrAndEmitEvents({ consumer: `pbx_cdr_l04_${Date.now()}`, batchSize: 1000 });
    const [events] = await sq.query(
      "SELECT id FROM event_ledger WHERE tenant_key = :tenant AND source = 'pbx.cdr' AND correlation_id = :cid ORDER BY received_at ASC",
      { replacements: { tenant: tenantId, cid: uniqueid } },
    );
    const evIds = (Array.isArray(events) ? events : []).map((r) => String(r.id || '')).filter(Boolean);
    for (const eventId of evIds) {
      // eslint-disable-next-line no-await-in-loop
      await dispatchOne({ tenantId, consumer: `webhooks_l04_${Date.now()}`, eventId, dispatchTargets: ['flows'] });
    }
    await close();
    return { scan, eventIds: evIds };
  }

  const marker = '__L04_PIPELINE_JSON__';
  const js = `
const { connect, getSequelize, close } = require('./api/db/sequelize');
const { scanPbxCdrAndEmitEvents } = require('./api/services/pbx/pbxCallEventsService');
const { scanAndEnqueue } = require('./api/services/eventLedgerTriggerDispatcher');
(async () => {
  await connect();
  const sq = getSequelize();
  const tenant = process.argv[1];
  const cid = process.argv[2];
  const scan = await scanPbxCdrAndEmitEvents({ consumer: 'pbx_cdr_l04_' + Date.now(), batchSize: 1000 });
  const [events] = await sq.query(
    "SELECT id FROM event_ledger WHERE tenant_key = :tenant AND source = 'pbx.cdr' AND correlation_id = :cid ORDER BY received_at ASC",
    { replacements: { tenant, cid } }
  );
  const evIds = (Array.isArray(events) ? events : []).map((r) => String(r.id || '')).filter(Boolean);
  const consumer = 'webhooks_l04_' + Date.now();
  const enqueue = await scanAndEnqueue({ consumer, batchSize: 1000, dispatchTargets: ['flows'] });
  const deadline = Date.now() + 45000;
  let jobs = [];
  while (Date.now() < deadline) {
    const [rows] = await sq.query(
      "SELECT id, status, attempts, last_error, payload FROM execution_jobs WHERE kind = 'dispatch_event_trigger' AND payload->>'eventId' IN (:ids) ORDER BY created_at ASC",
      { replacements: { ids: evIds } }
    );
    jobs = Array.isArray(rows) ? rows : [];
    const relevant = jobs.filter((j) => evIds.includes(String(j?.payload?.eventId || '')));
    const done = relevant.filter((j) => String(j.status) === 'done').length;
    const dead = relevant.filter((j) => String(j.status) === 'dead').length;
    if (relevant.length >= evIds.length && (done + dead) >= evIds.length) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const relevantJobs = jobs.filter((j) => evIds.includes(String(j?.payload?.eventId || '')));
  const queue = {
    consumer,
    enqueue: enqueue || null,
    jobsTotal: relevantJobs.length,
    jobsDone: relevantJobs.filter((j) => String(j.status) === 'done').length,
    jobsDead: relevantJobs.filter((j) => String(j.status) === 'dead').length,
    jobsPending: relevantJobs.filter((j) => String(j.status) === 'pending' || String(j.status) === 'processing').length,
    lastErrors: relevantJobs.filter((j) => j && j.last_error).map((j) => String(j.last_error)).slice(-5),
  };
  process.stdout.write('${marker}' + JSON.stringify({ scan, eventIds: evIds, queue }));
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

async function waitExecution({ baseUrl, token, correlationId, flowId, minStartedAtMs = 0 }) {
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
              tenant: 'system',
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
                tenant: 'system',
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
      { method: 'GET', token },
    );
    expect(
      execListByCorrelation.ok && Array.isArray(execListByCorrelation.payload?.items),
      `executions_list_failed:${execListByCorrelation.status}`,
    );
    let item = findExecutionCandidate(execListByCorrelation.payload.items, flowId, minStartedAtMs);
    if (!item) {
      const execListFallback = await reqJson(
        `${baseUrl}/api/executions?limit=200`,
        { method: 'GET', token },
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
  const baseUrl = apiBaseUrl();
  const auth = await login(baseUrl);
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
  });
  expect(Array.isArray(pipeline.eventIds) && pipeline.eventIds.length > 0, 'pbx_events_not_emitted');
  if (pipeline.queue && typeof pipeline.queue === 'object') {
    expect(Number(pipeline.queue.jobsDone || 0) >= pipeline.eventIds.length, `dispatch_jobs_not_done:${JSON.stringify(pipeline.queue)}`);
    expect(Number(pipeline.queue.jobsDead || 0) === 0, `dispatch_jobs_dead:${JSON.stringify(pipeline.queue)}`);
  }

  const waited = await waitExecution({
    baseUrl,
    token: auth.token,
    correlationId: uniqueid,
    flowId,
    minStartedAtMs: ts,
  });
  expect(waited.found, `event_trigger_execution_not_found:${JSON.stringify(waited.lastSeen || {})}`);
  expect(waited.nodes.length > 0, `execution_nodes_missing:${JSON.stringify(waited.lastSeen || {})}`);

  const metrics = await reqJson(`${baseUrl}/api/ops/event-ledger/metrics?windowMinutes=30`, {
    method: 'GET',
    token: auth.token,
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
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[pbx-call-events-runtime-smoke] FAIL', err?.message || err);
    process.exit(1);
  });
}

module.exports = { main };
